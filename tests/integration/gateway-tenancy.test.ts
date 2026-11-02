import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createLogger } from '@crm/shared';
import { handleSend, sweepPendingWork } from '../../apps/gateway/src/work.js';
import { tenantDatabase } from '../../apps/gateway/src/tenant.js';

/**
 * The gateway runs inside the owning org's tenant (D-41).
 *
 * It used to query as the connecting role, so only each query's own `WHERE org_id` stood
 * between a job for one org and another org's rows. These tests run it as the restricted
 * role with the org set, and check that Postgres itself refuses the crossing.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
interface Tenant { orgId: string; senderId: string; contactId: string; conversationId: string }
let a: Tenant;
let b: Tenant;

/** Builds one org with a number, a contact and a conversation, and returns their ids. */
async function makeTenant(label: string): Promise<Tenant> {
  const orgId = randomUUID();
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId}, ${label}, ${label + '-' + orgId.slice(0, 8)})`);
  const s = await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'baileys', ${label}, ${'+1202555' + String(Math.floor(Math.random() * 9000) + 1000)}, 'active')
    RETURNING id`);
  const senderId = (s as unknown as Array<{ id: string }>)[0]!.id;
  const c = await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, ${label + ' contact'}, 'test') RETURNING id`);
  const contactId = (c as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity(org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${contactId}, 'phone', ${'+1202555' + String(Math.floor(Math.random() * 9000) + 1000)}, true)`);
  const v = await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId})
    RETURNING id`);
  return { orgId, senderId, contactId, conversationId: (v as unknown as Array<{ id: string }>)[0]!.id };
}

/** Queues an outbound message in the given org and conversation. */
async function queue(orgId: string, conversationId: string, body: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO message(org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by)
    VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, 'api')
    RETURNING id`);
  return (r as unknown as Array<{ id: string }>)[0]!.id;
}

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });
beforeEach(async () => {
  a = await makeTenant('org-a');
  b = await makeTenant('org-b');
});

/** A gateway context with a connected fake number for every sender given, running as `crm_app`. */
async function ctxFor(...senderIds: string[]) {
  const provider = new FakeChannelProvider();
  for (const id of senderIds) await provider.connect({ id, phoneE164: '+910000000000' });
  return {
    ctx: {
      db, provider, logger, tenantRole: 'crm_app',
      decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c))
    },
    provider
  };
}

describe('a tenant-scoped gateway handle', () => {
  it('sees only its own org’s rows', async () => {
    const scoped = tenantDatabase(db, a.orgId, 'crm_app');
    const rows = await scoped.execute(sql`SELECT DISTINCT org_id AS "orgId" FROM contact`);
    expect((rows as unknown as Array<{ orgId: string }>).map((r) => r.orgId)).toEqual([a.orgId]);
  });

  it('cannot update another org’s rows, even by naming them', async () => {
    const id = await queue(b.orgId, b.conversationId, 'belongs to b');
    const scoped = tenantDatabase(db, a.orgId, 'crm_app');
    const hit = await scoped.execute(sql`UPDATE message SET status = 'failed' WHERE id = ${id} RETURNING id`);
    expect(hit as unknown as unknown[]).toHaveLength(0);
    const after = await db.execute(sql`SELECT status FROM message WHERE id = ${id}`);
    expect((after as unknown as Array<{ status: string }>)[0]!.status).toBe('queued');
  });

  it('refuses to be used any way other than execute or transaction', () => {
    const scoped = tenantDatabase(db, a.orgId, 'crm_app') as unknown as Record<string, unknown>;
    expect(() => scoped.select).toThrow(/not available/);
  });
});

describe('gateway jobs cannot cross orgs', () => {
  it('does not send a message whose conversation points at another org’s number', async () => {
    // Corrupt on purpose: a message in org A whose conversation uses org B's sender. Foreign keys
    // do not carry the org, so the database would accept it; row-level security must not let the
    // job see B's sender at all.
    const crossed = await db.execute(sql`
      INSERT INTO conversation(org_id, contact_id, sender_identity_id)
      VALUES (${a.orgId}, ${a.contactId}, ${b.senderId}) RETURNING id`);
    const conversationId = (crossed as unknown as Array<{ id: string }>)[0]!.id;
    const id = await queue(a.orgId, conversationId, 'must not use b’s number');
    const { ctx, provider } = await ctxFor(a.senderId, b.senderId);

    await handleSend(ctx, id);

    expect(provider.sent).toHaveLength(0);
    const row = await db.execute(sql`SELECT status FROM message WHERE id = ${id}`);
    expect((row as unknown as Array<{ status: string }>)[0]!.status).toBe('queued');
  });

  it('sends each org’s queued message from its own number in one sweep', async () => {
    const ma = await queue(a.orgId, a.conversationId, 'from a');
    const mb = await queue(b.orgId, b.conversationId, 'from b');
    const { ctx, provider } = await ctxFor(a.senderId, b.senderId);

    await sweepPendingWork(ctx);

    expect(provider.sent.map((m) => m.senderId).sort()).toEqual([a.senderId, b.senderId].sort());
    const rows = await db.execute(sql`SELECT id, status FROM message WHERE id IN (${ma}, ${mb})`);
    expect((rows as unknown as Array<{ status: string }>).map((r) => r.status)).toEqual(['sent', 'sent']);
  });
});
