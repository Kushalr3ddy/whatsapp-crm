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
  /** The key version `encrypt` writes. A rotation is finished when no stored value carries another. */
  readonly keyVersion: number;
  /** Every key version this driver can still decrypt: the current one plus any retired-but-needed. */
  knownKeyVersions(): number[];
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
  /** Retired keys kept only to read data not yet re-encrypted onto the current key, by version. */
  readonly #previous = new Map<number, Buffer>();

  /**
   * Takes the 32-byte encryption key and the separate blind-index key, both as hex.
   * Rejects anything short: a weak key here silently weakens every encrypted column.
   */
  constructor(options: {
    keyHex: string; indexKeyHex: string; keyVersion?: number;
    /** Retired keys still needed to read old data, from `parsePreviousKeys`. Never used to encrypt. */
    previousKeys?: ReadonlyArray<{ version: number; keyHex: string }>;
  }) {
    this.#key = decodeKey(options.keyHex, 'ENCRYPTION_KEY');
    this.#indexKey = decodeKey(options.indexKeyHex, 'ENCRYPTION_INDEX_KEY');
    this.#keyVersion = options.keyVersion ?? 1;
    if (!Number.isInteger(this.#keyVersion) || this.#keyVersion < 1 || this.#keyVersion > 255) {
      throw new Error(`ENCRYPTION_KEY_VERSION must be a whole number from 1 to 255; got ${String(this.#keyVersion)}`);
    }
    if (this.#key.equals(this.#indexKey)) {
      throw new Error('ENCRYPTION_KEY and ENCRYPTION_INDEX_KEY must differ: reusing one key for both encryption and deterministic indexing leaks equality of plaintexts.');
    }
    for (const prev of options.previousKeys ?? []) {
      const key = decodeKey(prev.keyHex, `ENCRYPTION_KEYS_PREVIOUS (version ${String(prev.version)})`);
      if (prev.version === this.#keyVersion) {
        throw new Error(`ENCRYPTION_KEYS_PREVIOUS lists version ${String(prev.version)}, which is the current key version; a retired key needs its own, older version number.`);
      }
      if (this.#previous.has(prev.version)) {
        throw new Error(`ENCRYPTION_KEYS_PREVIOUS lists key version ${String(prev.version)} twice.`);
      }
      if (key.equals(this.#key) || key.equals(this.#indexKey)) {
        throw new Error(`ENCRYPTION_KEYS_PREVIOUS version ${String(prev.version)} is the same key as the current or index key; a rotation needs a genuinely new key.`);
      }
      this.#previous.set(prev.version, key);
    }
  }

  /** The key version new data is written under. */
  get keyVersion(): number {
    return this.#keyVersion;
  }

  /** Current version first, then retired ones that can still be read. */
  knownKeyVersions(): number[] {
    return [this.#keyVersion, ...[...this.#previous.keys()].sort((a, b) => b - a)];
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
    const key = keyVersion === this.#keyVersion ? this.#key : this.#previous.get(keyVersion ?? -1);
    if (key === undefined) {
      // Deliberately explicit: this is "the key for that version is missing", not a corruption.
      // A generic "decrypt failed" would send someone hunting the wrong bug.
      throw new Error(`envelope was encrypted with key version ${String(keyVersion)}, which is not in this key ring (known versions: ${this.knownKeyVersions().join(', ')}). Add it to ENCRYPTION_KEYS_PREVIOUS as ${String(keyVersion)}:<64-hex-chars>.`);
    }

    const iv = buf.subarray(2, 2 + IV_BYTES);
    const tag = buf.subarray(2 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
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

/**
 * Parses `ENCRYPTION_KEYS_PREVIOUS`: a comma-separated list of `version:64-hex` pairs, e.g.
 * `1:ab12…,2:cd34…`. Empty or absent means no retired keys. Throws on anything malformed so a
 * typo fails at boot rather than as an unreadable message later.
 */
export function parsePreviousKeys(spec: string | undefined): Array<{ version: number; keyHex: string }> {
  if (spec === undefined || spec.trim() === '') return [];
  return spec.split(',').map((part) => {
    const m = /^\s*(\d{1,3})\s*:\s*([0-9a-fA-F]{64})\s*$/.exec(part);
    if (m === null) {
      throw new Error('ENCRYPTION_KEYS_PREVIOUS must be a comma-separated list of <version>:<64 hex characters> pairs, e.g. 1:ab12…');
    }
    return { version: Number(m[1]), keyHex: m[2]! };
  });
}

/** The key-related settings, as they appear in validated configuration. */
export interface LocalKmsConfig {
  readonly ENCRYPTION_KEY: string;
  readonly ENCRYPTION_INDEX_KEY: string;
  readonly ENCRYPTION_KEY_VERSION?: number;
  readonly ENCRYPTION_KEYS_PREVIOUS?: string | undefined;
}

/** Builds the driver from configuration: the single place the key ring is assembled. */
export function localKmsFromConfig(config: LocalKmsConfig): LocalKms {
  return new LocalKms({
    keyHex: config.ENCRYPTION_KEY,
    indexKeyHex: config.ENCRYPTION_INDEX_KEY,
    keyVersion: config.ENCRYPTION_KEY_VERSION ?? 1,
    previousKeys: parsePreviousKeys(config.ENCRYPTION_KEYS_PREVIOUS)
  });
}
