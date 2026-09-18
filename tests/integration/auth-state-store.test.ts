import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, PostgresAuthStateStore, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';

const url = process.env.DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_dev';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'),
  indexKeyHex: randomBytes(32).toString('hex')
});

let db: Database;
let senderId: string;
const orgId = '11111111-2222-3333-4444-555555555555';
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(async () => {
  db = createDatabase(url, { max: 2 });
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'auth-test','auth-test')
                       ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM org WHERE id = ${orgId}`);
  await db.$client.end();
});

beforeEach(async () => {
  const rows = await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label) VALUES (${orgId},'fake','test number')
    RETURNING id`);
  senderId = (rows as unknown as Array<{ id: string }>)[0]!.id;
});

describe('PostgresAuthStateStore', () => {
  it('round-trips a credential', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    await store.set(senderId, 'creds', bytes('{"me":{"id":"919876543210"}}'));
    expect(text((await store.get(senderId, 'creds'))!)).toBe('{"me":{"id":"919876543210"}}');
  });

  it('returns null for a key never written', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    expect(await store.get(senderId, 'nope')).toBeNull();
  });

  it('stores credentials ENCRYPTED, not as readable bytes', async () => {
    // The point of the table: a leaked dump must not hand over working sessions.
    const store = new PostgresAuthStateStore(db, kms);
    await store.set(senderId, 'creds', bytes('SUPER_SECRET_SESSION_KEY'));
    const raw = await db.execute(sql`
      SELECT encode(value_enc,'escape') AS v FROM channel_auth_state
      WHERE sender_identity_id = ${senderId} AND key = 'creds'`);
    const stored = (raw as unknown as Array<{ v: string }>)[0]!.v;
    expect(stored).not.toContain('SUPER_SECRET_SESSION_KEY');
  });

  it('overwrites on repeated writes without a gap', async () => {
    // Baileys rewrites keys constantly; a delete-then-insert would leave a window where the
    // session is unrecoverable if the process died between the two.
    const store = new PostgresAuthStateStore(db, kms);
    await store.set(senderId, 'k', bytes('v1'));
    await store.set(senderId, 'k', bytes('v2'));
    expect(text((await store.get(senderId, 'k'))!)).toBe('v2');
    expect(await store.keys(senderId)).toEqual(['k']);
  });

  it('SURVIVES A RESTART — a brand new store reads what the old one wrote', async () => {
    // This is the entire reason the table exists (M29/M30). Simulates the process dying and
    // coming back: different store instance, different connection, same credentials.
    const before = new PostgresAuthStateStore(db, kms);
    await before.set(senderId, 'creds', bytes('session-alpha'));
    await before.set(senderId, 'app-state-key-1', bytes('sync-data'));

    const reconnected = createDatabase(url, { max: 1 });
    try {
      const after = new PostgresAuthStateStore(reconnected, kms);
      expect(text((await after.get(senderId, 'creds'))!)).toBe('session-alpha');
      expect((await after.keys(senderId)).sort()).toEqual(['app-state-key-1', 'creds']);
    } finally {
      await reconnected.$client.end();
    }
  });

  it('removes one key without touching the others', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    await store.set(senderId, 'a', bytes('1'));
    await store.set(senderId, 'b', bytes('2'));
    await store.remove(senderId, 'a');
    expect(await store.get(senderId, 'a')).toBeNull();
    expect(text((await store.get(senderId, 'b'))!)).toBe('2');
  });

  it('removing an absent key is not an error', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    await expect(store.remove(senderId, 'never-existed')).resolves.toBeUndefined();
  });

  it('clear() wipes the sender, so a logout cannot leave a doomed reconnect loop', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    await store.set(senderId, 'a', bytes('1'));
    await store.set(senderId, 'b', bytes('2'));
    await store.clear(senderId);
    expect(await store.keys(senderId)).toEqual([]);
  });

  it('keeps senders isolated from each other', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    const other = await db.execute(sql`
      INSERT INTO sender_identity(org_id, provider, label) VALUES (${orgId},'fake','second')
      RETURNING id`);
    const otherId = (other as unknown as Array<{ id: string }>)[0]!.id;
    await store.set(senderId, 'creds', bytes('mine'));
    expect(await store.get(otherId, 'creds')).toBeNull();
  });

  it('deleting a sender cascades its credentials away', async () => {
    const store = new PostgresAuthStateStore(db, kms);
    await store.set(senderId, 'creds', bytes('x'));
    await db.execute(sql`DELETE FROM sender_identity WHERE id = ${senderId}`);
    expect(await store.keys(senderId)).toEqual([]);
  });
});
