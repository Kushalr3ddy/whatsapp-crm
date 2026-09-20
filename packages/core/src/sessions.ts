import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/** How long a session stays valid regardless of activity. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a session may sit idle before it stops being accepted. */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

/** Who a validated session belongs to, and which tenant it acts in. */
export interface SessionPrincipal {
  readonly sessionId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
  readonly email: string;
  readonly displayName: string;
}

/** A newly created session: the raw token goes to the browser, nothing else ever sees it. */
export interface IssuedSession {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

/**
 * Hashes a session token for storage and lookup.
 *
 * SHA-256 rather than Argon2 on purpose. Argon2 is slow *by design*, which is correct for a
 * human-chosen password and wrong for a 256-bit random token: there is nothing to brute-force,
 * and a deliberately slow hash on every single request would be a self-inflicted bottleneck.
 */
function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Creates a session and returns the token exactly once.
 *
 * Only the hash is stored, so a database leak yields no usable session — the same reasoning
 * that applies to API keys and password hashes.
 */
export async function createSession(
  db: Database,
  input: { userId: string; orgId: string; ip?: string | null; userAgent?: string | null }
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const rows = await db.execute(sql`
    INSERT INTO session (user_id, org_id, token_hash, expires_at, ip, user_agent)
    VALUES (${input.userId}, ${input.orgId}, ${tokenHash(token)}, ${expiresAt.toISOString()},
            ${input.ip ?? null}, ${input.userAgent ?? null})
    RETURNING id`);

  const id = (rows as unknown as Array<{ id: string }>)[0]!.id;
  return { token, sessionId: id, expiresAt };
}

/**
 * Resolves a token to the person and tenant it authorises, or null.
 *
 * Joins `org_membership` rather than trusting the session's own `org_id` alone: revoking
 * someone's membership must end their access immediately, not when their session happens to
 * expire. Touches `last_seen_at` so the idle timeout means something.
 */
export async function resolveSession(db: Database, token: string): Promise<SessionPrincipal | null> {
  if (token === '') return null;

  const rows = await db.execute(sql`
    UPDATE session s
    SET last_seen_at = now()
    FROM app_user u, org_membership m
    WHERE s.token_hash = ${tokenHash(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.last_seen_at > now() - ${`${String(IDLE_TIMEOUT_MS)} milliseconds`}::interval
      AND u.id = s.user_id
      AND u.status = 'active'
      AND m.user_id = s.user_id
      AND m.org_id = s.org_id
    RETURNING s.id AS "sessionId", s.user_id AS "userId", s.org_id AS "orgId",
              m.role, u.email, u.display_name AS "displayName"`);

  return (rows as unknown as SessionPrincipal[])[0] ?? null;
}

/** Ends one session. Used by logout. */
export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE session SET revoked_at = now() WHERE id = ${sessionId} AND revoked_at IS NULL`);
}

/**
 * Ends every session a person holds.
 *
 * Required on password change (docs/09-security.md): if changing a password left existing
 * sessions alive, it would not actually evict whoever the change was meant to evict.
 */
export async function revokeAllSessionsForUser(db: Database, userId: string): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE session SET revoked_at = now()
    WHERE user_id = ${userId} AND revoked_at IS NULL
    RETURNING id`);
  return (rows as unknown as unknown[]).length;
}

/** Constant-time comparison for CSRF tokens and similar fixed-length secrets. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
