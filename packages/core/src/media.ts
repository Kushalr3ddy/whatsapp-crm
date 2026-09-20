import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';
import { detectMediaType, safeFilename } from '@crm/shared';
import { mediaKey, type StorageDriver } from '@crm/storage';

/** An attachment as it arrived, before anything has been decided about it. */
export interface IncomingMedia {
  readonly orgId: string;
  /** The message it belongs to. Attaching to nothing is not a case worth supporting. */
  readonly messageId: string;
  readonly bytes: Uint8Array;
  /** What the sender's client called the file. Sanitised here, never trusted for its type. */
  readonly filename: string | null;
}

/** A stored attachment, as the rest of the system refers to it. */
export interface StoredMedia {
  readonly mediaId: string;
  /** Determined from magic bytes. `application/octet-stream` when unrecognised. */
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** True when an identical file was already stored for this org and was reused. */
  readonly deduplicated: boolean;
}

/**
 * Stores an attachment and attaches it to its message.
 *
 * Three decisions are made here, and each one is the reason this is a single function rather
 * than something a caller assembles:
 *
 * **The content type comes from the bytes.** Not from the filename, not from what the provider
 * declared — both are the sender's input, and a file called `cv.pdf` that contains HTML is
 * stored XSS against whoever opens it (docs/21-deferred.md, D-11). Anything unrecognised
 * becomes `application/octet-stream`, which downloads rather than renders.
 *
 * **The storage key is random and unguessable.** Row-level security protects the `media_asset`
 * row; it cannot protect a file on a filesystem Postgres cannot see. A guessable key would
 * turn one missed authorisation check into a public bucket, so the key is built from a fresh
 * UUID by `mediaKey()` and never from the filename.
 *
 * **Identical files are stored once.** `sha256` is the dedup key, scoped to the org — a CV
 * forwarded by five people is one file. Cross-tenant dedup is deliberately not done: it would
 * leak the existence of one org's file into another's storage bill and erasure path.
 *
 * Bytes are written before the row, on purpose. A failure between the two leaves an unreferenced
 * file, which is garbage for the retention job to collect; the other order leaves a row pointing
 * at nothing, which is a broken download for a user.
 */
export async function storeMedia(
  db: Database, storage: StorageDriver, incoming: IncomingMedia
): Promise<StoredMedia> {
  const sha256 = createHash('sha256').update(incoming.bytes).digest('hex');
  const type = detectMediaType(incoming.bytes);
  const filename = safeFilename(incoming.filename);

  const existing = await findByDigest(db, incoming.orgId, sha256);
  if (existing !== null) {
    await linkMessage(db, incoming.orgId, incoming.messageId, existing.id);
    return {
      mediaId: existing.id, contentType: existing.contentType,
      sizeBytes: existing.sizeBytes, sha256, deduplicated: true
    };
  }

  const mediaId = randomUUID();
  const key = mediaKey(incoming.orgId, mediaId, type.extension);
  await storage.put(key, incoming.bytes, { contentType: type.contentType });

  await db.transaction(async (tx) => {
    await setTenant(tx, incoming.orgId);
    await tx.execute(sql`
      INSERT INTO media_asset (id, org_id, storage_key, storage_driver, content_type,
                               size_bytes, sha256, filename)
      VALUES (${mediaId}, ${incoming.orgId}, ${key}, ${storage.name}, ${type.contentType},
              ${incoming.bytes.byteLength}, ${sha256}, ${filename})`);
    // Same transaction as the row it points at: a message referencing a media_asset that was
    // never written is the one state that would produce a broken download.
    await tx.execute(sql`
      UPDATE message SET media_id = ${mediaId}
      WHERE id = ${incoming.messageId} AND org_id = ${incoming.orgId}`);
  });

  return {
    mediaId, contentType: type.contentType, sizeBytes: incoming.bytes.byteLength,
    sha256, deduplicated: false
  };
}

/** What a download needs to know before it serves a byte. */
export interface ResolvedMedia {
  readonly mediaId: string;
  readonly storageKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Sanitised at write time; null when the sender supplied nothing usable. */
  readonly filename: string | null;
  /** The conversation the attachment hangs off, for the audit trail. */
  readonly conversationId: string;
}

/**
 * Resolves an attachment for a principal that is already known to act for `orgId`.
 *
 * **This is the only authorisation there is for a file.** Row-level security stops at the row;
 * the bytes sit on a filesystem it cannot reach, so the chain media → message → conversation →
 * org has to be walked deliberately, here, once (D-11). Returns null when the id names nothing
 * *this tenant can see* — which is also the answer for another tenant's file, because telling
 * the two apart would confirm the file exists.
 *
 * Runs inside the caller's tenant transaction so the policies apply to it as well; the join is
 * belt and braces, and the belt is the part written by hand.
 */
export async function resolveMedia(
  executor: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  orgId: string, mediaId: string
): Promise<ResolvedMedia | null> {
  const rows = await executor.execute(sql`
    SELECT ma.id, ma.storage_key AS "storageKey", ma.content_type AS "contentType",
           ma.size_bytes AS "sizeBytes", ma.filename, m.conversation_id AS "conversationId"
    FROM media_asset ma
    JOIN message m ON m.media_id = ma.id
    JOIN conversation c ON c.id = m.conversation_id
    WHERE ma.id = ${mediaId} AND ma.org_id = ${orgId} AND c.org_id = ${orgId}
    LIMIT 1`);

  const row = (rows as unknown as Array<{
    id: string; storageKey: string; contentType: string; sizeBytes: number;
    filename: string | null; conversationId: string;
  }>)[0];
  if (!row) return null;
  return {
    mediaId: row.id, storageKey: row.storageKey, contentType: row.contentType,
    sizeBytes: row.sizeBytes, filename: row.filename, conversationId: row.conversationId
  };
}

/** Looks for an identical file already stored for this org. */
async function findByDigest(
  db: Database, orgId: string, sha256: string
): Promise<{ id: string; contentType: string; sizeBytes: number } | null> {
  let found: { id: string; contentType: string; sizeBytes: number } | null = null;
  await db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    const rows = await tx.execute(sql`
      SELECT id, content_type AS "contentType", size_bytes AS "sizeBytes"
      FROM media_asset WHERE org_id = ${orgId} AND sha256 = ${sha256} LIMIT 1`);
    found = (rows as unknown as Array<{
      id: string; contentType: string; sizeBytes: number;
    }>)[0] ?? null;
  });
  return found;
}

/** Points a message at an already-stored attachment. */
async function linkMessage(
  db: Database, orgId: string, messageId: string, mediaId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    await tx.execute(sql`
      UPDATE message SET media_id = ${mediaId}
      WHERE id = ${messageId} AND org_id = ${orgId}`);
  });
}
