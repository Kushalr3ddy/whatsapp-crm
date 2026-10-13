import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { KmsDriver } from '@crm/kms-local';

/**
 * Key rotation (D-31): moving every encrypted value from an old key onto the current one, a few
 * rows at a time, while the app keeps running.
 *
 * Every encrypted value is an envelope whose second byte is the key version that wrote it, so
 * "which rows are still on an old key" is a plain query over that byte, and "re-encrypt" is
 * decrypt-with-whichever-key-it-names then encrypt-with-the-current-one. Nothing here knows
 * about orgs: the caller hands in a database handle, and row-level security (the gateway's
 * tenant handle) decides which rows that handle can see.
 *
 * Only two columns carry ciphertext today: `message.body_enc` and `channel_auth_state.value_enc`.
 */

/** Anything with `execute`: a database, a transaction, or the gateway's tenant-scoped handle. */
export interface SqlExecutor {
  execute: (query: SQL) => PromiseLike<unknown>;
}

/** How many encrypted values sit on each key version, per column. */
export interface KeyVersionCounts {
  readonly message: Record<number, number>;
  readonly authState: Record<number, number>;
}

/** The result of one re-encryption pass. */
export interface ReencryptResult {
  /** Rows moved onto the current key. */
  readonly reencrypted: number;
  /** Rows that could not be read (corrupt, or on a key version that is not in the key ring). */
  readonly unreadable: number;
}

/** Reads the key-version counts for one encrypted column into a version → count map. */
async function countsFor(db: SqlExecutor, table: 'message' | 'channel_auth_state'): Promise<Record<number, number>> {
  const rows = (await (table === 'message'
    ? db.execute(sql`
        SELECT envelope_key_version(body_enc) AS v, count(*)::int AS n
        FROM message WHERE body_enc IS NOT NULL GROUP BY 1`)
    : db.execute(sql`
        SELECT envelope_key_version(value_enc) AS v, count(*)::int AS n
        FROM channel_auth_state GROUP BY 1`))) as unknown as Array<{ v: number | null; n: number }>;
  const out: Record<number, number> = {};
  // A value too short to be an envelope has no key version (null): it is not data any key could
  // ever open, so it is not counted as sitting on some version, and cannot trip the startup guard.
  for (const r of rows) if (r.v !== null) out[r.v] = r.n;
  return out;
}

/**
 * How many values are on each key version. With a tenant-scoped handle this is that org's rows;
 * with the plain pool it is the whole instance (what startup and the CLI want).
 */
export async function keyVersionCounts(db: SqlExecutor): Promise<KeyVersionCounts> {
  return { message: await countsFor(db, 'message'), authState: await countsFor(db, 'channel_auth_state') };
}

/** Key versions present in the data that the key ring cannot decrypt. Empty means safe to run. */
export function versionsMissingFromKeyRing(counts: KeyVersionCounts, kms: KmsDriver): number[] {
  const known = new Set(kms.knownKeyVersions());
  const present = new Set([...Object.keys(counts.message), ...Object.keys(counts.authState)].map(Number));
  return [...present].filter((v) => !known.has(v)).sort((a, b) => a - b);
}

/** The retired versions this driver can still read, which is what a re-encryption pass looks for. */
function oldVersions(kms: KmsDriver): number[] {
  return kms.knownKeyVersions().filter((v) => v !== kms.keyVersion);
}

/** `IN (…)` list over a set of numbers, as a SQL fragment (numbers only, so safe to inline). */
function inList(values: number[]): SQL {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

/**
 * Re-encrypts up to `limit` rows from each encrypted column onto the current key.
 *
 * Each update is a compare-and-swap on the old ciphertext, so a row that changed in the meantime
 * is left alone rather than overwritten with a stale value; it simply shows up again next pass.
 * A row that cannot be read is counted and skipped, and the scan moves past it, so a few bad
 * rows can never wedge the job at the front of the queue.
 */
export async function reencryptBatch(
  db: SqlExecutor, kms: KmsDriver, limit: number
): Promise<ReencryptResult> {
  const old = oldVersions(kms);
  if (old.length === 0 || limit <= 0) return { reencrypted: 0, unreadable: 0 };
  let reencrypted = 0;
  let unreadable = 0;

  // message.body_enc, keyset-paged by id
  let cursor = '00000000-0000-0000-0000-000000000000';
  while (reencrypted < limit) {
    const page = (await db.execute(sql`
      SELECT id, body_enc AS enc FROM message
      WHERE body_enc IS NOT NULL AND envelope_key_version(body_enc) IN (${inList(old)}) AND id > ${cursor}::uuid
      ORDER BY id LIMIT ${limit}`)) as unknown as Array<{ id: string; enc: Uint8Array }>;
    if (page.length === 0) break;
    for (const row of page) {
      cursor = row.id;
      try {
        const next = Buffer.from(kms.encrypt(kms.decrypt(row.enc)));
        const done = (await db.execute(sql`
          UPDATE message SET body_enc = ${next}
          WHERE id = ${row.id} AND body_enc = ${Buffer.from(row.enc)} RETURNING id`)) as unknown as unknown[];
        if (done.length > 0) reencrypted += 1;
      } catch {
        unreadable += 1;
      }
      if (reencrypted >= limit) break;
    }
  }

  // channel_auth_state.value_enc, keyset-paged by (sender, key)
  let cursorSender = '00000000-0000-0000-0000-000000000000';
  let cursorKey = '';
  let authDone = 0;
  while (authDone < limit) {
    const page = (await db.execute(sql`
      SELECT sender_identity_id AS "senderId", key, value_enc AS enc FROM channel_auth_state
      WHERE envelope_key_version(value_enc) IN (${inList(old)})
        AND (sender_identity_id, key) > (${cursorSender}::uuid, ${cursorKey})
      ORDER BY sender_identity_id, key LIMIT ${limit}`)) as unknown as
      Array<{ senderId: string; key: string; enc: Uint8Array }>;
    if (page.length === 0) break;
    for (const row of page) {
      cursorSender = row.senderId;
      cursorKey = row.key;
      try {
        const next = Buffer.from(kms.encrypt(kms.decrypt(row.enc)));
        const done = (await db.execute(sql`
          UPDATE channel_auth_state SET value_enc = ${next}
          WHERE sender_identity_id = ${row.senderId}::uuid AND key = ${row.key}
            AND value_enc = ${Buffer.from(row.enc)} RETURNING key`)) as unknown as unknown[];
        if (done.length > 0) { authDone += 1; reencrypted += 1; }
      } catch {
        unreadable += 1;
      }
      if (authDone >= limit) break;
    }
  }
  return { reencrypted, unreadable };
}

/** What a verification pass found. */
export interface VerifyResult {
  readonly checked: number;
  readonly failed: number;
  /** Values still on a version other than the current one (found among the sampled rows). */
  readonly onOldKey: number;
}

/**
 * Decrypts a random sample from each encrypted column and reports how many could not be read.
 * The honest check that "the new key really opens what was written": it exercises the same
 * decrypt the app uses, rather than trusting the version byte.
 */
export async function verifySample(db: SqlExecutor, kms: KmsDriver, sample = 200): Promise<VerifyResult> {
  const msgs = (await db.execute(sql`
    SELECT body_enc AS enc FROM message WHERE body_enc IS NOT NULL ORDER BY random() LIMIT ${sample}`
  )) as unknown as Array<{ enc: Uint8Array }>;
  const auth = (await db.execute(sql`
    SELECT value_enc AS enc FROM channel_auth_state ORDER BY random() LIMIT ${sample}`
  )) as unknown as Array<{ enc: Uint8Array }>;
  let failed = 0;
  let onOldKey = 0;
  for (const { enc } of [...msgs, ...auth]) {
    try {
      kms.decrypt(enc);
      if (enc[1] !== kms.keyVersion) onOldKey += 1;
    } catch {
      failed += 1;
    }
  }
  return { checked: msgs.length + auth.length, failed, onOldKey };
}

/**
 * Refuses to start when the data holds a key version the key ring cannot read.
 *
 * Without this a dropped key looks like working software that quietly cannot open some of its
 * own messages. Called at boot, on the instance-wide pool, so it sees every org. Cheap: it reads
 * a handful of grouped counts through the key-version indexes.
 */
export async function assertKeyRingCoversData(db: SqlExecutor, kms: KmsDriver): Promise<void> {
  const missing = versionsMissingFromKeyRing(await keyVersionCounts(db), kms);
  if (missing.length === 0) return;
  throw new Error(
    `the database holds data encrypted with key version(s) ${missing.join(', ')}, which this process `
    + `cannot decrypt (it knows version(s) ${kms.knownKeyVersions().join(', ')}). `
    + `Add the missing key(s) to ENCRYPTION_KEYS_PREVIOUS as <version>:<64 hex chars> and restart. `
    + 'Do not start without them: those messages and sessions would be unreadable.'
  );
}
