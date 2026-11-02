import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { FakeChannelProvider } from '@crm/channel-fake';
import {
  createOrgWithAdmin, addUserToOrg, createSession,
  keyVersionCounts, reencryptBatch, verifySample, assertKeyRingCoversData
} from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { sweepKeyRotation, sweepPendingWork } from '../../apps/gateway/src/work.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Key rotation (D-31): a second key version, re-encryption onto it, and the wizard's API.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const indexKey = randomBytes(32).toString('hex');
const key1 = randomBytes(32).toString('hex');
const key2 = randomBytes(32).toString('hex');
const kmsV1 = new LocalKms({ keyHex: key1, indexKeyHex: indexKey, keyVersion: 1 });
const kmsV2 = new LocalKms({
  keyHex: key2, indexKeyHex: indexKey, keyVersion: 2, previousKeys: [{ version: 1, keyHex: key1 }]
});
/** Version 2 with the old key dropped: what a rotation retired too early looks like. */
const kmsV2Alone = new LocalKms({ keyHex: key2, indexKeyHex: indexKey, keyVersion: 2 });
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });
const enc = (k: LocalKms, s: string) => Buffer.from(k.encrypt(new TextEncoder().encode(s)));
const dec = (k: LocalKms, b: Uint8Array) => new TextDecoder().decode(k.decrypt(b));

let db: Database;
let orgId: string;
let senderId: string;
let conversationId: string;

/** Inserts an outbound message whose body was encrypted by `k`, returning its id. */
async function insertMessage(k: LocalKms, body: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by)
    VALUES (${orgId}, ${conversationId}, 'outbound', 'sent', 'text', ${enc(k, body)},
            ${k.blindIndex(body)}, 'api') RETURNING id`);
  return (r as unknown as Array<{ id: string }>)[0]!.id;
}

/** Reads a message body's stored bytes. */
async function bodyOf(id: string): Promise<Buffer> {
  const r = await db.execute(sql`SELECT body_enc FROM message WHERE id = ${id}`);
  return Buffer.from((r as unknown as Array<{ body_enc: Uint8Array }>)[0]!.body_enc);
}

beforeAll(() => { db = createDatabase(url, { max: 6 }); });
afterAll(async () => { await db.$client.end(); });
beforeEach(async () => {
  // This suite owns every encrypted row in the test database for its duration.
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  await db.execute(sql`UPDATE key_rotation_state SET paused = false, reencrypted_total = 0, last_unreadable = 0 WHERE id = 1`);
  orgId = randomUUID();
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'k',${'k-' + orgId.slice(0, 8)})`);
  senderId = ((await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'baileys', 'k', '+12025550123', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  const c = ((await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'k', 'test') RETURNING id`
  )) as unknown as Array<{ id: string }>)[0]!.id;
  conversationId = ((await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${c}, ${senderId})
    RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
});

describe('re-encryption', () => {
  it('moves every old-key value onto the current key without changing what it says', async () => {
    const ids = [await insertMessage(kmsV1, 'one'), await insertMessage(kmsV1, 'two'), await insertMessage(kmsV1, 'three')];
    await db.execute(sql`
      INSERT INTO channel_auth_state(sender_identity_id, key, value_enc)
      VALUES (${senderId}, 'creds', ${enc(kmsV1, 'session secret')})`);
    expect((await keyVersionCounts(db)).message).toEqual({ 1: 3 });

    const r = await reencryptBatch(db, kmsV2, 100);

    expect(r).toEqual({ reencrypted: 4, unreadable: 0 });
    expect(await keyVersionCounts(db)).toEqual({ message: { 2: 3 }, authState: { 2: 1 } });
    expect(await Promise.all(ids.map(async (id) => dec(kmsV2Alone, await bodyOf(id)))))
      .toEqual(['one', 'two', 'three']);
    // The blind index is untouched, so duplicate detection keeps working across a rotation.
    const idx = await db.execute(sql`SELECT body_hmac FROM message WHERE id = ${ids[0]!}`);
    expect((idx as unknown as Array<{ body_hmac: string }>)[0]!.body_hmac).toBe(kmsV2.blindIndex('one'));
  });

  it('is resumable: a small limit does part of the work and the next pass finishes it', async () => {
    for (let i = 0; i < 5; i++) await insertMessage(kmsV1, `m${String(i)}`);
    expect((await reencryptBatch(db, kmsV2, 2)).reencrypted).toBe(2);
    expect((await keyVersionCounts(db)).message).toEqual({ 1: 3, 2: 2 });
    expect((await reencryptBatch(db, kmsV2, 100)).reencrypted).toBe(3);
    expect((await keyVersionCounts(db)).message).toEqual({ 2: 5 });
    expect((await reencryptBatch(db, kmsV2, 100)).reencrypted).toBe(0);
  });

  it('counts an unreadable row and carries on past it', async () => {
    const bad = await insertMessage(kmsV1, 'will be corrupted');
    await db.execute(sql`
      UPDATE message SET body_enc = set_byte(body_enc, 40, get_byte(body_enc, 40) # 255) WHERE id = ${bad}`);
    const good = await insertMessage(kmsV1, 'fine');

    const r = await reencryptBatch(db, kmsV2, 100);

    expect(r).toEqual({ reencrypted: 1, unreadable: 1 });
    expect(dec(kmsV2Alone, await bodyOf(good))).toBe('fine');
  });

  it('tolerates a value too short to be an envelope, in the index and in the job', async () => {
    // A bare get_byte() on one byte throws, and as an index expression it would make the insert fail.
    await db.execute(sql`
      INSERT INTO channel_auth_state(sender_identity_id, key, value_enc)
      VALUES (${senderId}, 'junk', ${Buffer.from('x')})`);
    await insertMessage(kmsV1, 'real');
    expect((await keyVersionCounts(db)).authState).toEqual({});
    expect(await reencryptBatch(db, kmsV2, 100)).toEqual({ reencrypted: 1, unreadable: 0 });
  });

  it('does nothing when no retired key is configured', async () => {
    await insertMessage(kmsV1, 'x');
    expect(await reencryptBatch(db, kmsV1, 100)).toEqual({ reencrypted: 0, unreadable: 0 });
  });
});

describe('startup guard and verification', () => {
  it('refuses to start when data is on a version the key ring cannot read', async () => {
    await insertMessage(kmsV1, 'still on version 1');
    await expect(assertKeyRingCoversData(db, kmsV2Alone)).rejects.toThrow(/key version\(s\) 1.*ENCRYPTION_KEYS_PREVIOUS/);
    await expect(assertKeyRingCoversData(db, kmsV2)).resolves.toBeUndefined();
  });

  it('verifies a sample, and reports values still on an old key and values it cannot read', async () => {
    await insertMessage(kmsV1, 'old');
    await insertMessage(kmsV2, 'new');
    const clean = await verifySample(db, kmsV2, 50);
    expect(clean).toEqual({ checked: 2, failed: 0, onOldKey: 1 });

    const blind = await verifySample(db, kmsV2Alone, 50);
    expect(blind.failed).toBe(1);
  });
});

describe('the gateway sweep', () => {
  /** A gateway context with the given key ring, running as the restricted role. */
  const ctxWith = (kms: LocalKms) => ({
    db, provider: new FakeChannelProvider(), logger, kms, tenantRole: 'crm_app',
    decrypt: (c: Uint8Array) => dec(kms, c)
  });

  it('re-encrypts every org’s values in the background, and stops when nothing is left', async () => {
    await insertMessage(kmsV1, 'org a');
    const other = randomUUID();
    await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${other},'k2',${'k2-' + other.slice(0, 8)})`);
    const otherSender = ((await db.execute(sql`
      INSERT INTO sender_identity(org_id, provider, label, phone_e164, status)
      VALUES (${other}, 'baileys', 'k2', '+12025550124', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO channel_auth_state(sender_identity_id, key, value_enc)
      VALUES (${otherSender}, 'creds', ${enc(kmsV1, 'org b secret')})`);

    const moved = await sweepKeyRotation(ctxWith(kmsV2));

    expect(moved).toBe(2);
    expect(await keyVersionCounts(db)).toEqual({ message: { 2: 1 }, authState: { 2: 1 } });
    expect(await sweepKeyRotation(ctxWith(kmsV2))).toBe(0);
    const state = await db.execute(sql`SELECT reencrypted_total AS n FROM key_rotation_state WHERE id = 1`);
    expect((state as unknown as Array<{ n: number }>)[0]!.n).toBe(2);
  });

  it('runs as part of the gateway’s ordinary sweep, not only when called directly', async () => {
    // The wiring itself: a rotation must progress with nobody calling it by hand.
    await insertMessage(kmsV1, 'moved by the normal sweep');
    await sweepPendingWork(ctxWith(kmsV2));
    expect((await keyVersionCounts(db)).message).toEqual({ 2: 1 });
  });

  it('honours the pause, and does nothing at all with a single key', async () => {
    await insertMessage(kmsV1, 'held back');
    await db.execute(sql`UPDATE key_rotation_state SET paused = true WHERE id = 1`);
    expect(await sweepKeyRotation(ctxWith(kmsV2))).toBe(0);
    expect((await keyVersionCounts(db)).message).toEqual({ 1: 1 });

    await db.execute(sql`UPDATE key_rotation_state SET paused = false WHERE id = 1`);
    expect(await sweepKeyRotation(ctxWith(kmsV1))).toBe(0);
    expect(await sweepKeyRotation(ctxWith(kmsV2))).toBe(1);
  });
});

describe('the wizard API', () => {
  const API_KEY = randomBytes(32).toString('hex');
  const config = {
    PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test', API_KEY, DEFAULT_COUNTRY: 'IN'
  } as unknown as Config;
  const hasher = new BuiltinPasswordHasher();
  let app: ReturnType<typeof buildApp>;
  let media: TempStorage;
  let adminToken: string;
  let agentToken: string;
  const as = (t: string) => ({ Cookie: `crm_session=${t}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' });

  beforeAll(async () => {
    media = tempStorage();
    const security = await inspectDatabaseSecurity(db);
    const tenantRole = await resolveTenantRole(db, security);
    app = buildApp({ config, logger, db, kms: kmsV2, hasher, tenantRole, storage: media.storage });
  });
  afterAll(() => { media.cleanup(); });

  beforeEach(async () => {
    const o = await createOrgWithAdmin(db, hasher, {
      orgName: 'kw', slug: `kw-${randomUUID().slice(0, 6)}`, email: `a-${randomUUID().slice(0, 6)}@kw.test`,
      password: 'x', displayName: 'Admin'
    });
    const agent = await addUserToOrg(db, hasher, {
      orgId: o.orgId, email: `g-${randomUUID().slice(0, 6)}@kw.test`, password: 'x', displayName: 'Agent', role: 'agent'
    });
    adminToken = (await createSession(db, { userId: o.userId, orgId: o.orgId })).token;
    agentToken = (await createSession(db, { userId: agent.userId, orgId: o.orgId })).token;
    orgId = o.orgId;
    senderId = ((await db.execute(sql`
      INSERT INTO sender_identity(org_id, provider, label, phone_e164, status)
      VALUES (${orgId}, 'baileys', 'w', '+12025550125', 'active') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    const c = ((await db.execute(sql`
      INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'w', 'test') RETURNING id`
    )) as unknown as Array<{ id: string }>)[0]!.id;
    conversationId = ((await db.execute(sql`
      INSERT INTO conversation(org_id, contact_id, sender_identity_id) VALUES (${orgId}, ${c}, ${senderId})
      RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  });

  it('is admin only', async () => {
    expect((await request(app).get('/api/v1/encryption').set(as(agentToken))).status).toBe(403);
    expect((await request(app).post('/api/v1/encryption/pause').set(as(agentToken))).status).toBe(403);
  });

  it('walks the stages: re-encrypting, then ready to retire', async () => {
    await insertMessage(kmsV1, 'a');
    await insertMessage(kmsV1, 'b');
    const mid = (await request(app).get('/api/v1/encryption').set(as(adminToken))).body.data;
    expect(mid).toMatchObject({
      stage: 'reencrypting', currentVersion: 2, retiredVersions: [1], total: 2, onCurrent: 0, onOld: 2
    });

    await reencryptBatch(db, kmsV2, 100);
    const done = (await request(app).get('/api/v1/encryption').set(as(adminToken))).body.data;
    expect(done).toMatchObject({ stage: 'ready_to_retire', onOld: 0, onCurrent: 2 });
  });

  it('pauses and resumes the job, and writes an audit row each time', async () => {
    await insertMessage(kmsV1, 'a');
    expect((await request(app).post('/api/v1/encryption/pause').set(as(adminToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/encryption').set(as(adminToken))).body.data.stage).toBe('paused');
    expect((await request(app).post('/api/v1/encryption/resume').set(as(adminToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/encryption').set(as(adminToken))).body.data.stage).toBe('reencrypting');
    const audit = await db.execute(sql`
      SELECT action FROM audit_log WHERE org_id = ${orgId} AND action LIKE 'encryption.%' ORDER BY at`);
    expect((audit as unknown as Array<{ action: string }>).map((a) => a.action))
      .toEqual(['encryption.rotation_paused', 'encryption.rotation_resumed']);
  });

  it('verifies a sample and says what it found', async () => {
    await insertMessage(kmsV1, 'old');
    const r = await request(app).post('/api/v1/encryption/verify').set(as(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ checked: 1, failed: 0, onOldKey: 1 });
  });
});
