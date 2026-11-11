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

/**
 * #114 (2026-11-11, found by: live run L9b). A number slot linked again by scanning its QR with a DIFFERENT phone kept the old phone's number: the
 * gateway only wrote the number into a blank. The Numbers page then showed the wrong number, a send to the old phone's number was refused as
 * "your own number", and the duplicate check (X-006) compared against the old number. WhatsApp says which phone answered, so the recorded number
 * follows it on every open.
 */
describe('[R-052] [#114] the recorded number follows the phone that is actually linked', () => {
  let db: Database;
  beforeAll(() => { db = createDatabase(url, { max: 4 }); });
  afterAll(async () => { await db.$client.end(); });

  const open = (provider: FakeChannelProvider, senderId: string, phoneE164: string | null): Promise<void> => applyConnectionEvent(
    { db, provider, logger, tenantRole: 'crm_app', decrypt: () => '' } as never,
    { senderId, state: 'open', reason: null, at: new Date(), ...(phoneE164 === null ? {} : { phoneE164 }) });
  async function slot(label = 'slot'): Promise<{ orgId: string; id: string }> {
    const orgId = randomUUID();
    await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'r114',${'r114-' + orgId.slice(0, 8)})`);
    const id = (await db.execute(sql`INSERT INTO sender_identity(org_id,provider,label,status) VALUES (${orgId},'baileys',${label},'linking') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    return { orgId, id };
  }
  const phoneOf = async (id: string): Promise<string | null> => (await db.execute(sql`SELECT phone_e164 AS p FROM sender_identity WHERE id = ${id}`) as unknown as Array<{ p: string | null }>)[0]!.p;

  it('[#114] linked again with another phone, the slot shows the new phone', async () => {
    const { id } = await slot();
    const provider = new FakeChannelProvider();
    await open(provider, id, '+919964122631');
    expect(await phoneOf(id)).toBe('+919964122631');
    await open(provider, id, '+918884478039');
    expect(await phoneOf(id)).toBe('+918884478039');
  });

  it('[#114] opening again with the same phone changes nothing, and an open without a number leaves the recorded one', async () => {
    const { id } = await slot();
    const provider = new FakeChannelProvider();
    await open(provider, id, '+919964122631');
    await open(provider, id, '+919964122631');
    await open(provider, id, null);
    expect(await phoneOf(id)).toBe('+919964122631');
  });

  it('[#114] a phone another number of the organisation already holds is not taken from it, and nothing crashes', async () => {
    const a = await slot('first');
    const b = (await db.execute(sql`INSERT INTO sender_identity(org_id,provider,label,status) VALUES (${a.orgId},'baileys','second','linking') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const provider = new FakeChannelProvider();
    await open(provider, a.id, '+919964122631');
    await open(provider, b, '+919964122631');
    expect(await phoneOf(a.id)).toBe('+919964122631');
    expect(await phoneOf(b)).toBeNull();
  });

  it('[#114] the stale number no longer blocks the real owner: slot one is relinked to another phone, then slot two links the first phone', async () => {
    const one = await slot('one');
    const two = (await db.execute(sql`INSERT INTO sender_identity(org_id,provider,label,status) VALUES (${one.orgId},'baileys','two','linking') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
    const provider = new FakeChannelProvider();
    await open(provider, one.id, '+919964122631');
    await open(provider, one.id, '+918884478039');      // the owner moved phones on slot one
    await open(provider, two, '+919964122631');          // slot two now links the first phone
    const rows = await db.execute(sql`SELECT label, status, phone_e164 AS phone FROM sender_identity WHERE org_id = ${one.orgId} ORDER BY label`) as unknown as Array<{ label: string; status: string; phone: string }>;
    expect(rows).toEqual([{ label: 'one', status: 'active', phone: '+918884478039' }, { label: 'two', status: 'active', phone: '+919964122631' }]);
  });
});
