import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createLogger } from '@crm/shared';
import { applyConnectionEvent } from '../../apps/gateway/src/work.js';

/**
 * X-006 (2026-11-10, found by: live run L9, one organisation with two numbers).
 *
 * The owner scanned the QR of a second entry with the phone that was already linked as the first. The CRM accepted it: both entries showed active and
 * open, the second kept no phone number, and every send from the second left from the first's number. A phone already linked in the organisation must
 * not be linked again as another entry: the second is unlinked and says why.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

describe('[X-006] one phone cannot be linked twice in one organisation', () => {
  let db: Database;
  beforeAll(() => { db = createDatabase(url, { max: 4 }); });
  afterAll(async () => { await db.$client.end(); });

  async function open(provider: FakeChannelProvider, senderId: string, phoneE164: string): Promise<void> {
    await applyConnectionEvent(
      { db, provider, logger, tenantRole: 'crm_app', decrypt: () => '' } as never,
      { senderId, state: 'open', reason: null, at: new Date(), phoneE164 }
    );
  }
  async function org(): Promise<{ orgId: string; ids: string[] }> {
    const orgId = randomUUID();
    await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'x6',${'x6-' + orgId.slice(0, 8)})`);
    const ids: string[] = [];
    for (const label of ['first', 'second']) {
      const s = await db.execute(sql`INSERT INTO sender_identity(org_id,provider,label,status) VALUES (${orgId},'baileys',${label},'linking') RETURNING id`);
      ids.push((s as unknown as Array<{ id: string }>)[0]!.id);
    }
    return { orgId, ids };
  }
  async function row(id: string) {
    return (await db.execute(sql`
      SELECT si.status, si.phone_e164 AS phone, cs.connection_state AS state, cs.link_error AS "linkError"
      FROM sender_identity si JOIN channel_session cs ON cs.sender_identity_id = si.id WHERE si.id = ${id}`) as unknown as Array<{
      status: string; phone: string | null; state: string; linkError: string | null }>)[0]!;
  }

  it('the second entry that opens as the same phone is unlinked again, with a reason, and the first is untouched', async () => {
    const { ids } = await org();
    const provider = new FakeChannelProvider();
    const logouts: string[] = [];
    const logout = provider.logout.bind(provider);
    provider.logout = async (id: string) => { logouts.push(id); await logout(id); };
    await open(provider, ids[0]!, '+919964122631');
    await open(provider, ids[1]!, '+919964122631');
    expect(await row(ids[0]!)).toMatchObject({ status: 'active', phone: '+919964122631', state: 'open' });
    const second = await row(ids[1]!);
    expect(second).toMatchObject({ status: 'linking', phone: null, state: 'closed' });
    expect(JSON.parse(second.linkError!).code).toBe('number_already_linked');
    expect(logouts).toEqual([ids[1]]);
  });

  it('a different phone on the second entry links normally', async () => {
    const { ids } = await org();
    const provider = new FakeChannelProvider();
    await open(provider, ids[0]!, '+919964122631');
    await open(provider, ids[1]!, '+919876500002');
    expect(await row(ids[1]!)).toMatchObject({ status: 'active', phone: '+919876500002', state: 'open' });
  });

  it('the same phone in ANOTHER organisation is not a duplicate', async () => {
    const a = await org();
    const b = await org();
    const provider = new FakeChannelProvider();
    await open(provider, a.ids[0]!, '+919964122631');
    await open(provider, b.ids[0]!, '+919964122631');
    expect(await row(b.ids[0]!)).toMatchObject({ status: 'active', phone: '+919964122631', state: 'open' });
  });
});
