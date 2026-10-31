import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { FakeChannelProvider } from '@crm/channel-fake';
import { storeInboundMessage } from '@crm/core';
import { kickLane, type WorkContext } from '../../apps/gateway/src/work.js';

/**
 * What the anti-ban v2 integration tests share: a database with one org and one connected fake number, a clock the test moves itself,
 * a gateway context wired to that clock (sleep advances it, schedule records what the lane asked to be woken for), and a logger that
 * keeps what was logged so the decisions can be read back.
 */
export const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
export const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });

/** A clock the test moves by hand. It starts at the real time, so rows the database stamps itself are not in the future. */
export function fakeClock(start: Date = new Date()) {
  let t = start.getTime();
  return {
    now: (): Date => new Date(t),
    advance: (ms: number): void => { t += ms; },
    set: (d: Date): void => { t = d.getTime(); }
  };
}
export type FakeClock = ReturnType<typeof fakeClock>;

/** A pino logger whose lines can be read back. */
export function capturingLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      for (const line of chunk.toString('utf8').split('\n')) if (line.trim() !== '') lines.push(JSON.parse(line) as Record<string, unknown>);
      done();
    }
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

export interface Lane {
  readonly db: Database;
  readonly orgId: string;
  readonly senderId: string;
  readonly phone: string;
  readonly provider: FakeChannelProvider;
  readonly clock: FakeClock;
  readonly slept: number[];
  readonly scheduled: Array<{ ms: number; run: () => void }>;
  readonly logs: Array<Record<string, unknown>>;
  /** The gateway context, pinned to this clock. */
  ctx(over?: Partial<WorkContext>): WorkContext;
  /** A contact with one phone number and a conversation on this number; `inbound` makes it a known contact (it has written to us). */
  contact(opts?: { phone?: string; name?: string; inbound?: boolean | 'old'; inboundAt?: Date }): Promise<{ contactId: string; conversationId: string; phone: string }>;
  /** Queues an outbound message the way the API / AI / a campaign would. */
  queue(conversationId: string, body: string, how?: { sentBy?: string; campaignId?: string; mediaId?: string; createdAt?: Date; gapMs?: number }): Promise<string>;
  /** Runs the lane, moving the clock to each wake-up it asks for, until it has nothing more to say. Returns the order messages were sent in. */
  drain(over?: Partial<WorkContext>, maxWakes?: number): Promise<string[]>;
  one<T>(query: ReturnType<typeof sql>): Promise<T>;
  row(id: string): Promise<{ status: string; hold: string | null; holdUntil: string | null; code: string | null; detail: string | null; gap: number | null }>;
  sentBodies(): string[];
  close(): Promise<void>;
}

let counter = 0;
let phoneSeq = 0;

/** One org, one active number connected on the fake provider, a clock and a context. Quiet hours are off unless `quietHours: true`. */
export async function makeLane(opts: { clock?: FakeClock; quietHours?: boolean } = {}): Promise<Lane> {
  const db = createDatabase(url, { max: 6 });
  const clock = opts.clock ?? fakeClock();
  const { logger, lines } = capturingLogger();
  const orgId = randomUUID();
  const phone = `+9190${String(Date.now()).slice(-6)}${String(++counter).padStart(2, '0')}`;
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'lane',${'lane-' + orgId.slice(0, 8)})`);
  // Quiet hours are off unless a test asks for them: they depend on the time of day the suite happens to run at.
  if (opts.quietHours !== true) await db.execute(sql`INSERT INTO antiban_setting (org_id, quiet_hours_enabled) VALUES (${orgId}, false)`);
  const one = async <T>(query: ReturnType<typeof sql>): Promise<T> => ((await db.execute(query)) as unknown as T[])[0]!;
  const senderId = (await one<{ id: string }>(sql`
    INSERT INTO sender_identity(org_id,provider,label,phone_e164,status)
    VALUES (${orgId},'fake','lane',${phone},'active') RETURNING id`)).id;
  const provider = new FakeChannelProvider({ clock: clock.now });
  await provider.connect({ id: senderId, phoneE164: phone });
  const slept: number[] = [];
  const scheduled: Array<{ ms: number; run: () => void }> = [];

  const ctx = (over: Partial<WorkContext> = {}): WorkContext => ({
    db, provider, logger, kms, tenantRole: 'crm_app',
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
    typingSimulation: true,
    now: clock.now,
    sleep: (ms: number) => { slept.push(ms); clock.advance(ms); return Promise.resolve(); },
    schedule: (ms: number, run: () => void) => { scheduled.push({ ms, run }); },
    random: () => 0.5,
    ...over
  });

  const lane: Lane = {
    db, orgId, senderId, phone, provider, clock, slept, scheduled, logs: lines, ctx, one,
    async contact(o = {}) {
      const contactPhone = o.phone ?? `+9198${String(Date.now()).slice(-4)}${String(++phoneSeq).padStart(4, '0')}`;
      if (o.inbound === undefined || o.inbound === false) {
        const contactId = (await one<{ id: string }>(sql`
          INSERT INTO contact (org_id, display_name, source) VALUES (${orgId}, ${o.name ?? 'Person'}, 'test') RETURNING id`)).id;
        await db.execute(sql`
          INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
          VALUES (${orgId}, ${contactId}, 'phone', ${contactPhone}, true)`);
        const conversationId = (await one<{ id: string }>(sql`
          INSERT INTO conversation (org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${contactId}, ${senderId}) RETURNING id`)).id;
        return { contactId, conversationId, phone: contactPhone };
      }
      const stored = await storeInboundMessage(db, kms, {
        orgId, senderIdentityId: senderId, providerMessageId: `wamid.${randomUUID()}`,
        fromPhoneE164: contactPhone, fromProviderAddress: `${contactPhone.replace(/\D/g, '')}@s.whatsapp.net`,
        body: 'hi', contentType: 'text', receivedAt: o.inboundAt ?? (o.inbound === 'old' ? new Date(Date.now() - 3 * 24 * 3_600_000) : new Date())
      });
      const contactId = (await one<{ id: string }>(sql`SELECT contact_id AS id FROM conversation WHERE id = ${stored.conversationId}`)).id;
      if (o.name !== undefined) await db.execute(sql`UPDATE contact SET display_name = ${o.name} WHERE id = ${contactId}`);
      return { contactId, conversationId: stored.conversationId, phone: contactPhone };
    },
    async queue(conversationId, body, how = {}) {
      const rows = await db.execute(sql`
        INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, campaign_id, media_id,
                             created_at, planned_gap_ms)
        VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', ${how.mediaId === undefined ? 'text' : 'image'},
                ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, ${how.sentBy ?? 'api'},
                ${how.campaignId ?? null}, ${how.mediaId ?? null}, ${(how.createdAt ?? new Date()).toISOString()}, ${how.gapMs ?? null})
        RETURNING id`);
      return (rows as unknown as Array<{ id: string }>)[0]!.id;
    },
    async drain(over = {}, maxWakes = 3000) {
      const order: string[] = [];
      const c = ctx(over);
      for (let i = 0; i < maxWakes; i++) {
        const before = provider.sent.length;
        const result = await kickLane(c, senderId);
        for (const m of provider.sent.slice(before)) order.push((m.content as { body: string }).body);
        if (result.nextWakeAt === null) return order;
        clock.set(new Date(Math.max(clock.now().getTime(), result.nextWakeAt.getTime())));
      }
      throw new Error('the lane kept asking to be woken');
    },
    row: (id) => one(sql`
      SELECT status, hold_reason AS hold, hold_until AS "holdUntil", error_code AS code, error_detail AS detail, planned_gap_ms AS gap
      FROM message WHERE id = ${id}`),
    sentBodies: () => provider.sent.map((m) => (m.content as { body: string }).body),
    // Removes the org (everything under it cascades), so the shared test database does not fill up with one org per test.
    close: async () => { await db.execute(sql`DELETE FROM org WHERE id = ${orgId}`).catch(() => undefined); await db.$client.end(); }
  };
  return lane;
}
