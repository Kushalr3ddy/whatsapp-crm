import type { Readable } from 'node:stream';

/**
 * Where files live. One port, many backends — filesystem for `lean`, MinIO bundled, and any
 * S3-compatible endpoint beyond that (docs/18-providers.md).
 *
 * Two rules shape this interface, and both come from what stored files actually are here:
 * candidate CVs and photographs sent by strangers over WhatsApp.
 *
 * **Keys are provider-neutral paths**, so moving from a directory to a bucket is a copy rather
 * than a rewrite. Nothing filesystem-shaped (no absolute paths, no drive letters) and nothing
 * bucket-shaped (no URLs) appears in a key.
 *
 * **The port stores the content type alongside the bytes.** S3 does this natively and a
 * filesystem does not, so leaving it out would mean `stat()` answering differently depending
 * on the backend — exactly the inconsistency a contract suite exists to prevent. The
 * filesystem driver keeps a sidecar; callers never know.
 *
 * Deliberately **no signed-URL method.** Access has to be resolved through the database —
 * file → message → conversation → org → the requesting principal — because row-level security
 * does not reach the filesystem (docs/21-deferred.md, D-11). A URL that grants access on its
 * own would route around the only check there is.
 */
export interface StorageDriver {
  /** Which backend this is: `filesystem`, `s3`, `minio`. Recorded on stored objects. */
  readonly name: string;

  /** Stores bytes under a key, replacing anything already there. */
  put(key: string, data: Uint8Array, options: PutOptions): Promise<StoredObject>;

  /** Reads an object whole. Throws `ObjectNotFoundError` when the key names nothing. */
  get(key: string): Promise<Uint8Array>;

  /**
   * Reads an object as a stream, for serving without holding it in memory.
   *
   * WhatsApp permits documents up to ~100 MB. Buffering several of those to serve them would
   * be a denial of service against ourselves.
   */
  getStream(key: string): Promise<Readable>;

  /** Metadata without the bytes, or null when the key names nothing. */
  stat(key: string): Promise<StoredObject | null>;

  /** Removes an object. False when it was not there — deleting twice is not an error. */
  delete(key: string): Promise<boolean>;

  /** Every object under a prefix. Used by retention and by tenant erasure. */
  list(prefix: string): AsyncIterable<StoredObject>;
}

/** What `put` needs to know beyond the bytes. */
export interface PutOptions {
  /**
   * Determined from **magic bytes**, never from a filename (docs/09-security.md). A caller
   * trusting `document.pdf` is how an HTML file gets served as a document and becomes stored
   * XSS against a logged-in session.
   */
  readonly contentType: string;
}

/** One stored object. */
export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
}

/** Thrown when a key names nothing. Distinct from a failure, so callers can tell them apart. */
export class ObjectNotFoundError extends Error {
  /** Carries the key, because "not found" with no subject is an unhelpful log line. */
  constructor(readonly key: string) {
    super(`no object at key "${key}"`);
    this.name = 'ObjectNotFoundError';
  }
}

/** Thrown when a key is not legal. Never a "not found" — a malformed key is a caller bug. */
export class InvalidKeyError extends Error {
  /** Says what was wrong, since every rule below has a specific reason. */
  constructor(readonly key: string, reason: string) {
    super(`invalid storage key "${key}": ${reason}`);
    this.name = 'InvalidKeyError';
  }
}

/** Segments may hold letters, digits, dot, dash and underscore. Nothing else. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Generous, but bounded — some backends cap key length and all of them dislike surprises. */
const MAX_KEY_LENGTH = 512;

/**
 * Rejects anything that is not a legal key.
 *
 * This is a security boundary, not tidiness. A filesystem driver turns a key into a path, so
 * `../../etc/passwd` reads outside the store and `../../../home/user/.env` reads the
 * encryption key. Validating centrally means every driver inherits the same refusal instead of
 * each one re-deriving it — and the contract suite asserts that they do.
 */
export function assertValidKey(key: string): void {
  if (key === '') throw new InvalidKeyError(key, 'empty');
  if (key.length > MAX_KEY_LENGTH) throw new InvalidKeyError(key, `longer than ${String(MAX_KEY_LENGTH)}`);
  if (key.startsWith('/') || key.endsWith('/')) throw new InvalidKeyError(key, 'leading or trailing slash');
  if (key.includes('//')) throw new InvalidKeyError(key, 'empty path segment');
  if (key.includes('\0')) throw new InvalidKeyError(key, 'null byte');
  if (key.includes('\\')) throw new InvalidKeyError(key, 'backslash — keys use forward slashes on every backend');

  for (const segment of key.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new InvalidKeyError(key, 'relative path segment');
    }
    if (!SEGMENT.test(segment)) {
      throw new InvalidKeyError(key, `segment "${segment}" has characters outside [A-Za-z0-9._-]`);
    }
  }
}

/**
 * Builds the key for one piece of media.
 *
 * Org-prefixed so a tenant's files can be listed and erased as a unit, and so a stray listing
 * cannot span tenants. The id must be **random and unguessable** — never a filename, never
 * sequential — because row-level security does not reach the filesystem, so a guessable key
 * turns a single missed authorisation check into a public bucket (D-11).
 */
export function mediaKey(orgId: string, mediaId: string, extension?: string): string {
  const suffix = extension === undefined || extension === '' ? '' : `.${extension}`;
  const key = `org/${orgId}/media/${mediaId}${suffix}`;
  assertValidKey(key);
  return key;
}

export { createStorage, type StorageConfig } from './factory.js';
