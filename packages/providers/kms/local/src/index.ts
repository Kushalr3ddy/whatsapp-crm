import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Encrypts and decrypts values at rest. One implementation of the KMS port; `local` keeps the
 * key in configuration, which is the free, self-hostable default. AWS KMS, GCP KMS and
 * OpenBao plug into this same shape later (docs/18-providers.md).
 */
export interface KmsDriver {
  /** Encrypts plaintext, returning a self-describing envelope that records its key version. */
  encrypt(plaintext: Uint8Array): Uint8Array;
  /** Decrypts an envelope produced by `encrypt`, or throws if it has been tampered with. */
  decrypt(envelope: Uint8Array): Uint8Array;
  /**
   * Keyed hash for blind indexing — lets a value be looked up or deduplicated without
   * decrypting the column. Deterministic by design, and therefore uses a key that is NOT
   * rotated: rotating it would invalidate every lookup index (docs/05-data-model.md).
   */
  blindIndex(value: string): string;
}

/** Envelope layout: version(1) ‖ keyVersion(1) ‖ iv(12) ‖ authTag(16) ‖ ciphertext. */
const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 2 + IV_BYTES + TAG_BYTES;

/**
 * AES-256-GCM encryption with a key supplied by configuration.
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a tampered ciphertext
 * fails to decrypt instead of returning plausible garbage. The key version travels inside
 * every envelope so old and new keys can coexist during a rotation — the previous system had
 * a single key with no rotation path, and losing it made all data permanently unrecoverable
 * (docs/00-prior-art.md, M24).
 */
export class LocalKms implements KmsDriver {
  readonly #key: Buffer;
  readonly #indexKey: Buffer;
  readonly #keyVersion: number;

  /**
   * Takes the 32-byte encryption key and the separate blind-index key, both as hex.
   * Rejects anything short: a weak key here silently weakens every encrypted column.
   */
  constructor(options: { keyHex: string; indexKeyHex: string; keyVersion?: number }) {
    this.#key = decodeKey(options.keyHex, 'ENCRYPTION_KEY');
    this.#indexKey = decodeKey(options.indexKeyHex, 'ENCRYPTION_INDEX_KEY');
    this.#keyVersion = options.keyVersion ?? 1;
    if (this.#key.equals(this.#indexKey)) {
      throw new Error('ENCRYPTION_KEY and ENCRYPTION_INDEX_KEY must differ: reusing one key for both encryption and deterministic indexing leaks equality of plaintexts.');
    }
  }

  /** Encrypts with a fresh random IV, so identical plaintexts produce different ciphertexts. */
  encrypt(plaintext: Uint8Array): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from([ENVELOPE_VERSION, this.#keyVersion]), iv, cipher.getAuthTag(), body]);
  }

  /** Reverses `encrypt`. Throws on a wrong key, a wrong version, or any tampering. */
  decrypt(envelope: Uint8Array): Uint8Array {
    const buf = Buffer.from(envelope);
    if (buf.length < HEADER_BYTES) throw new Error('ciphertext is too short to be a valid envelope');

    const version = buf[0];
    if (version !== ENVELOPE_VERSION) throw new Error(`unsupported envelope version ${String(version)}`);
    const keyVersion = buf[1];
    if (keyVersion !== this.#keyVersion) {
      // Deliberately explicit: during a rotation this is the signal to reach for the old key,
      // not a corruption. A generic "decrypt failed" would send someone hunting the wrong bug.
      throw new Error(`envelope was encrypted with key version ${String(keyVersion)}, this driver holds version ${String(this.#keyVersion)}`);
    }

    const iv = buf.subarray(2, 2 + IV_BYTES);
    const tag = buf.subarray(2 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(HEADER_BYTES)), decipher.final()]);
  }

  /** HMAC-SHA256 under the separate index key. Same input always yields the same digest. */
  blindIndex(value: string): string {
    return createHmac('sha256', this.#indexKey).update(value, 'utf8').digest('hex');
  }
}

/** Parses a hex key and refuses anything that is not exactly 32 bytes. */
function decodeKey(hex: string, name: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(`${name} must be 32 bytes of hex (64 characters); got ${String(key.length)} bytes. Generate one with: openssl rand -hex 32`);
  }
  return key;
}

/** Constant-time comparison of two blind-index digests, for callers that compare in code. */
export function blindIndexMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
