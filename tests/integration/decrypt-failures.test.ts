import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { DecryptFailureTracker, markDecryptBurst } from '@crm/core';
import { isDecryptFailure, tapDecryptFailures, failedFrameJid, failedFrameAuthor, failedFrameIsFromMe, retryRequestMessageId } from '../../packages/channels/baileys/src/decrypt-tap.js';

/**
 * The decrypt-failure signal: 3 "Bad MAC" in 60 s is a burst, and a burst is recorded on the session row.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
let db: Database;
let senderId: string;

beforeAll(() => { db = createDatabase(url, { max: 4 }); });
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const orgId = (await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('d','decrypt') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000009', 'active')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);
});

describe('recognising a decrypt failure in Baileys logging', () => {
  it('matches the message, the Bad MAC error, and the no-session error', () => {
    expect(isDecryptFailure({}, 'failed to decrypt message')).toBe(true);
    expect(isDecryptFailure({ err: new Error('Bad MAC') }, 'x')).toBe(true);
    expect(isDecryptFailure({ err: { message: 'No matching sessions found for message' } })).toBe(true);
    expect(isDecryptFailure({ err: new Error('timeout') }, 'connection error')).toBe(false);
    expect(isDecryptFailure(undefined, 'hello')).toBe(false);
  });

  it('taps warn/error (including child loggers) and passes every call through', () => {
    const calls: string[] = [];
    const base = {
      level: 'info',
      child: () => base, info: () => calls.push('info'), debug: () => calls.push('debug'),
      trace: () => calls.push('trace'), warn: () => calls.push('warn'), error: () => calls.push('error')
    };
    let fired = 0;
    const log = tapDecryptFailures(base, () => { fired++; });
    log.child({}).error({ err: new Error('Bad MAC') }, 'failed to decrypt message');
    log.info({}, 'unrelated');
    expect(fired).toBe(1);
    expect(calls).toEqual(['error', 'info']);
    // a throwing callback must never break logging
    const unsafe = tapDecryptFailures(base, () => { throw new Error('boom'); });
    expect(() => unsafe.error({}, 'failed to decrypt message')).not.toThrow();
  });
});

describe('what the tap reads out of Baileys logging (D-101, D-102)', () => {
  const base = () => {
    const b = { level: 'info', child: () => b, info: () => undefined, debug: () => undefined, trace: () => undefined, warn: () => undefined, error: () => undefined };
    return b;
  };

  it('names who an undecryptable frame was from', () => {
    expect(failedFrameJid({ key: { remoteJid: '78847127097458@lid' } })).toBe('78847127097458@lid');
    expect(failedFrameJid({ key: { participant: '1@lid' } })).toBe('1@lid');
    expect(failedFrameJid({})).toBeNull();
    expect(failedFrameJid(undefined)).toBeNull();
  });

  it('reads who wrote the frame and whether it is marked as from this account itself', () => {
    expect(failedFrameAuthor({ author: '78847127097458:12@lid' })).toBe('78847127097458:12@lid');
    expect(failedFrameAuthor({})).toBeNull();
    expect(failedFrameIsFromMe({ key: { fromMe: true } })).toBe(true);
    expect(failedFrameIsFromMe({ key: { fromMe: false } })).toBe(false);
    expect(failedFrameIsFromMe(undefined)).toBe(false);
  });

  it('recognises a recipient asking us to send a message again, and the id of the message', () => {
    const attrs = { from: '110762928373833@lid', type: 'retry', id: '3EB08CBD57CDF8128854E1', t: '1792744677' };
    expect(retryRequestMessageId({ attrs }, 'recv retry request')).toBe('3EB08CBD57CDF8128854E1');
    expect(retryRequestMessageId({ attrs }, 'something else')).toBeNull();
    expect(retryRequestMessageId({ attrs: {} }, 'recv retry request')).toBeNull();
    expect(retryRequestMessageId(undefined, 'recv retry request')).toBeNull();
  });

  it('tells its callbacks who failed and which message was asked for again, and still passes the call through', () => {
    const failures: Array<string | null> = [];
    const infos: Array<{ author: string | null; fromMe: boolean }> = [];
    const retried: string[] = [];
    const log = tapDecryptFailures(base(), (info) => { failures.push(info.jid); infos.push({ author: info.author, fromMe: info.fromMe }); }, (id) => retried.push(id));
    log.child({}).error({ key: { remoteJid: '78847127097458@lid', fromMe: true }, author: '78847127097458:12@lid', err: { message: 'No matching sessions found for message' } }, 'failed to decrypt message');
    log.debug({ attrs: { id: 'ABC', type: 'retry' } }, 'recv retry request');
    log.debug({ attrs: { id: 'IGNORED' } }, 'sent ack');
    expect(failures).toEqual(['78847127097458@lid']);
    expect(infos).toEqual([{ author: '78847127097458:12@lid', fromMe: true }]);
    expect(retried).toEqual(['ABC']);
    // a throwing retry callback must never break logging either
    const unsafe = tapDecryptFailures(base(), () => undefined, () => { throw new Error('boom'); });
    expect(() => unsafe.debug({ attrs: { id: 'X' } }, 'recv retry request')).not.toThrow();
  });
});

describe('the burst tracker', () => {
  it('trips on the 3rd failure inside 60 s, once, and not for slow drips', () => {
    const t = new DecryptFailureTracker();
    const at = (s: number) => new Date(1_000_000 + s * 1000);
    expect(t.record('a', at(0))).toBe(false);
    expect(t.record('a', at(10))).toBe(false);
    expect(t.record('a', at(20))).toBe(true);
    expect(t.record('a', at(21))).toBe(false);           // window cleared after a trip
    const slow = new DecryptFailureTracker();
    expect(slow.record('b', at(0))).toBe(false);
    expect(slow.record('b', at(40))).toBe(false);
    expect(slow.record('b', at(80))).toBe(false);        // first two aged out
  });

  it('counts each sender separately', () => {
    const t = new DecryptFailureTracker();
    const now = new Date();
    t.record('a', now); t.record('a', now);
    expect(t.record('b', now)).toBe(false);
  });
});

describe('recording a burst', () => {
  it('writes it onto the session row, where the composer reads it', async () => {
    const at = new Date();
    await markDecryptBurst(db, senderId, at);
    const row = (await db.execute(sql`
      SELECT decrypt_burst_at AS "at" FROM channel_session WHERE sender_identity_id = ${senderId}`
    ) as unknown as Array<{ at: string }>)[0]!;
    expect(new Date(row.at).getTime()).toBe(at.getTime());
  });
});
