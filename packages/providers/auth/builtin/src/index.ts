import { hash, verify } from '@node-rs/argon2';

/**
 * Turns a password into something safe to store, and checks one against it.
 *
 * One implementation of the auth port; `builtin` keeps credentials in our own database, which
 * is the free, self-hostable default. An OIDC driver plugs into the same shape later and
 * stores no password at all (docs/18-providers.md). **Authorisation never moves** with it —
 * roles stay in `org_membership` regardless of who authenticates.
 *
 * When that second driver arrives this interface should move to a shared port package; it
 * lives here for now to match how `KmsDriver` is declared.
 */
export interface PasswordHasher {
  /** Hashes a password for storage. Never returns the same output twice for the same input. */
  hash(password: string): Promise<string>;
  /** Checks a password against a stored hash. False on mismatch, never a throw. */
  verify(storedHash: string, password: string): Promise<boolean>;
  /** True when a stored hash was made with weaker settings than current policy. */
  needsRehash(storedHash: string): boolean;
}

/**
 * Argon2id parameters.
 *
 * Argon2id rather than bcrypt (M16): bcrypt silently truncates at 72 bytes and its work factor
 * only costs CPU, while Argon2id is memory-hard, which is what makes GPU cracking expensive.
 * These are OWASP's 2024 floor — 19 MiB, 2 passes, 1 lane. They are embedded in every hash in
 * PHC format, so raising them later leaves old hashes verifiable and `needsRehash` reports
 * which ones to upgrade on next successful login.
 */
// `Algorithm.Argon2id` is an ambient const enum, which `verbatimModuleSyntax` forbids
// importing. Its value is 2, asserted below against the algorithm name the library actually
// writes into the hash, so this cannot drift silently if the binding ever renumbers.
const ARGON2ID = 2;
const PARAMS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** Argon2id password hashing, backed by a prebuilt Rust binding — no compiler at install time. */
export class BuiltinPasswordHasher implements PasswordHasher {
  /** Hashes with a fresh random salt, which the library generates and embeds in the output. */
  async hash(password: string): Promise<string> {
    const digest = await hash(password, PARAMS);
    // Cheap guard on the numeric algorithm constant above: the PHC string names the algorithm
    // that was actually used, so a mismatch means the binding changed under us.
    if (!digest.startsWith('$argon2id$')) {
      throw new Error(`expected an argon2id hash, got "${digest.slice(0, 12)}"`);
    }
    return digest;
  }

  /**
   * Verifies, treating any malformed or unreadable stored hash as a failed login.
   *
   * A throw here would distinguish "corrupt hash" from "wrong password" to the caller, and the
   * difference is not one an unauthenticated request should be able to observe.
   */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password, PARAMS);
    } catch {
      return false;
    }
  }

  /** Reads the parameters out of the PHC string and compares them with current policy. */
  needsRehash(storedHash: string): boolean {
    const m = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
    if (m === null) return true;          // not ours, or not argon2id — replace it
    return Number(m[1]) < PARAMS.memoryCost
      || Number(m[2]) < PARAMS.timeCost
      || Number(m[3]) !== PARAMS.parallelism;
  }
}
