import { describe, expect, it } from 'vitest';
import { BuiltinPasswordHasher } from './index.js';

const hasher = new BuiltinPasswordHasher();

describe('password hashing', () => {
  it('produces an argon2id hash carrying its own parameters', async () => {
    const h = await hasher.hash('correct horse battery staple');
    // PHC format: the algorithm and cost parameters travel with the hash, which is what makes
    // raising them later possible without invalidating everything already stored.
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('never produces the same hash twice for the same password', async () => {
    const [a, b] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);
    // A fresh random salt each time. Without it, identical passwords would be visibly
    // identical in the table.
    expect(a).not.toBe(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hasher.hash('hunter2');
    expect(await hasher.verify(h, 'hunter2')).toBe(true);
    expect(await hasher.verify(h, 'hunter3')).toBe(false);
  });

  it('accepts a password longer than 72 bytes, which bcrypt would silently truncate', async () => {
    const long = 'a'.repeat(200);
    const h = await hasher.hash(long);
    expect(await hasher.verify(h, long)).toBe(true);
    // M16: bcrypt truncates at 72 bytes, so these two would be the same password to it.
    expect(await hasher.verify(h, 'a'.repeat(72))).toBe(false);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    // A corrupt hash must be indistinguishable from a wrong password to an unauthenticated
    // caller: the difference is not something a login attempt should be able to observe.
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
    expect(await hasher.verify('', 'anything')).toBe(false);
  });

  it('flags hashes weaker than current policy for rehashing', () => {
    expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$abc$def')).toBe(true);
    expect(hasher.needsRehash('$2b$12$somethingbcryptish')).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  });

  it('does not flag a hash made with current policy', async () => {
    expect(hasher.needsRehash(await hasher.hash('x'))).toBe(false);
  });
});
