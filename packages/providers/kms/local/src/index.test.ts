import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { LocalKms, blindIndexMatches } from './index.js';

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
