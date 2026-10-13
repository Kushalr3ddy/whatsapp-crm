import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { LocalKms, blindIndexMatches, parsePreviousKeys, localKmsFromConfig } from './index.js';

const keyA = randomBytes(32).toString('hex');
const keyB = randomBytes(32).toString('hex');
const kms = () => new LocalKms({ keyHex: keyA, indexKeyHex: keyB });
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('LocalKms', () => {
  it('round-trips a value', () => {
    const k = kms();
    expect(text(k.decrypt(k.encrypt(bytes('hello whatsapp'))))).toBe('hello whatsapp');
  });

  it('produces different ciphertext for identical plaintext', () => {
    // A fresh IV per encryption. Without this, an observer could tell which rows hold the
    // same message body just by comparing bytes.
    const k = kms();
    const a = Buffer.from(k.encrypt(bytes('same')));
    const b = Buffer.from(k.encrypt(bytes('same')));
    expect(a.equals(b)).toBe(false);
    expect(text(k.decrypt(a))).toBe(text(k.decrypt(b)));
  });

  it('refuses to decrypt a tampered envelope', () => {
    // GCM authenticates: flipping a byte must fail loudly rather than return plausible junk.
    const k = kms();
    const env = Buffer.from(k.encrypt(bytes('important')));
    const last = env.length - 1;
    env.writeUInt8(env.readUInt8(last) ^ 0xff, last);
    expect(() => k.decrypt(env)).toThrow();
  });

  it('refuses to decrypt with the wrong key', () => {
    const env = kms().encrypt(bytes('secret'));
    const other = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: keyB });
    expect(() => other.decrypt(env)).toThrow();
  });

  it('names the key version when it does not match, instead of a generic failure', () => {
    // During a rotation this is the difference between "reach for the old key" and an hour
    // spent hunting a corruption bug that does not exist.
    const v1 = new LocalKms({ keyHex: keyA, indexKeyHex: keyB, keyVersion: 1 });
    const v2 = new LocalKms({ keyHex: keyA, indexKeyHex: keyB, keyVersion: 2 });
    expect(() => v2.decrypt(v1.encrypt(bytes('x')))).toThrow(/key version 1/);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new LocalKms({ keyHex: 'abcd', indexKeyHex: keyB })).toThrow(/32 bytes/);
  });

  it('refuses to reuse one key for both encryption and indexing', () => {
    // Deterministic indexing under the same key as encryption leaks which plaintexts are equal.
    expect(() => new LocalKms({ keyHex: keyA, indexKeyHex: keyA })).toThrow(/must differ/);
  });

  it('blind-indexes deterministically, so a value can be looked up without decrypting', () => {
    const k = kms();
    expect(k.blindIndex('+919876543210')).toBe(k.blindIndex('+919876543210'));
    expect(k.blindIndex('+919876543210')).not.toBe(k.blindIndex('+919876543211'));
    expect(blindIndexMatches(k.blindIndex('a'), k.blindIndex('a'))).toBe(true);
    expect(blindIndexMatches(k.blindIndex('a'), k.blindIndex('b'))).toBe(false);
  });

  it('handles empty and large values', () => {
    const k = kms();
    expect(text(k.decrypt(k.encrypt(bytes(''))))).toBe('');
    const big = 'x'.repeat(200_000);
    expect(text(k.decrypt(k.encrypt(bytes(big))))).toBe(big);
  });
});

describe('key rotation (D-31)', () => {
  const oldKey = randomBytes(32).toString('hex');
  const newKey = randomBytes(32).toString('hex');
  const v1 = () => new LocalKms({ keyHex: oldKey, indexKeyHex: keyB, keyVersion: 1 });
  const v2 = () => new LocalKms({
    keyHex: newKey, indexKeyHex: keyB, keyVersion: 2, previousKeys: [{ version: 1, keyHex: oldKey }]
  });

  it('reads data written under a retired key and writes under the new one', () => {
    const old = v1().encrypt(bytes('written before the rotation'));
    const k = v2();
    expect(text(k.decrypt(old))).toBe('written before the rotation');
    expect(Buffer.from(k.encrypt(bytes('x')))[1]).toBe(2);
    expect(k.keyVersion).toBe(2);
    expect(k.knownKeyVersions()).toEqual([2, 1]);
  });

  it('says exactly which key is missing when a retired key was dropped too early', () => {
    const old = v1().encrypt(bytes('still on version 1'));
    const without = new LocalKms({ keyHex: newKey, indexKeyHex: keyB, keyVersion: 2 });
    expect(() => without.decrypt(old)).toThrow(/key version 1, which is not in this key ring/);
  });

  it('refuses a malformed key ring', () => {
    const base = { keyHex: newKey, indexKeyHex: keyB, keyVersion: 2 };
    expect(() => new LocalKms({ ...base, previousKeys: [{ version: 2, keyHex: oldKey }] })).toThrow(/current key version/);
    expect(() => new LocalKms({ ...base, previousKeys: [{ version: 1, keyHex: oldKey }, { version: 1, keyHex: oldKey }] })).toThrow(/twice/);
    expect(() => new LocalKms({ ...base, previousKeys: [{ version: 1, keyHex: newKey }] })).toThrow(/genuinely new key/);
    expect(() => new LocalKms({ ...base, keyVersion: 0 })).toThrow(/1 to 255/);
  });

  it('parses ENCRYPTION_KEYS_PREVIOUS and rejects a typo at boot', () => {
    expect(parsePreviousKeys(undefined)).toEqual([]);
    expect(parsePreviousKeys('')).toEqual([]);
    expect(parsePreviousKeys(`1:${oldKey}, 3:${newKey}`).map((k) => k.version)).toEqual([1, 3]);
    expect(() => parsePreviousKeys('1:nothex')).toThrow(/version>:<64 hex/);
    expect(localKmsFromConfig({
      ENCRYPTION_KEY: newKey, ENCRYPTION_INDEX_KEY: keyB,
      ENCRYPTION_KEY_VERSION: 2, ENCRYPTION_KEYS_PREVIOUS: `1:${oldKey}`
    }).knownKeyVersions()).toEqual([2, 1]);
  });
});
