import { randomBytes, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/** What a validated key authorises. */
export interface KeyPrincipal {
  readonly keyId: string;
  readonly orgId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly rateLimitPerMin: number;
}

/** A newly issued key. `secret` is returned once and never recoverable afterwards. */
export interface IssuedKey {
  readonly id: string;
  readonly secret: string;
  readonly prefix: string;
}

/**
 * The scopes a key may hold. Least privilege: a key that only reads contacts cannot send a
 * message (docs/15-api.md). Unknown scopes are rejected at issue time rather than ignored,
 * so a typo fails loudly instead of silently granting nothing.
 */
export const API_SCOPES = [
  'contacts:read', 'contacts:write',
  'conversations:read', 'conversations:write',
  'messages:send',
  'senders:read', 'senders:write'
] as const;

/** One of the permitted scope strings. */
export type ApiScope = typeof API_SCOPES[number];

/** Hashed the same way and for the same reason as a session token: it is a random secret. */
function keyHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Issues a key for one org, returning the secret exactly once.
 *
 * The visible `prefix` is stored in clear purely so a person can tell two keys apart in a list
 * without the system having to keep either secret.
 */
export async function issueApiKey(
  db: Database,
  input: {
    orgId: string; name: string; scopes: readonly string[]; expiresAt?: Date | null;
    /**
     * Requests per minute this key may make. Omitted takes the column default (120).
     * Settable at issue time because otherwise the limit could only ever be changed with a
     * hand-written UPDATE, which made the whole control unusable in practice.
     */
    rateLimitPerMin?: number | undefined;
  }
): Promise<IssuedKey> {
  const unknown = input.scopes.filter((s) => !(API_SCOPES as readonly string[]).includes(s));
  if (unknown.length > 0) {
    throw new Error(`unknown scope(s): ${unknown.join(', ')}. Valid: ${API_SCOPES.join(', ')}`);
  }

  const secret = `crm_live_${randomBytes(24).toString('base64url')}`;
  const prefix = secret.slice(0, 16);

  const rows = await db.execute(sql`
    INSERT INTO api_key (org_id, name, key_hash, prefix, scopes, expires_at,
                         rate_limit_per_min)
    VALUES (${input.orgId}, ${input.name}, ${keyHash(secret)}, ${prefix},
            ${sql.param(input.scopes as string[])}, ${input.expiresAt?.toISOString() ?? null},
            COALESCE(${input.rateLimitPerMin ?? null}, 120))
    RETURNING id`);

  return { id: (rows as unknown as Array<{ id: string }>)[0]!.id, secret, prefix };
}

/**
 * Resolves a key to the tenant it acts for, or null.
 *
 * This lookup is what replaced guessing the org from `SELECT id FROM org LIMIT 2` — a key now
 * names the tenant it belongs to, so more than one org stops being a hard failure.
 * `last_used_at` is touched here because it is the only place a key is ever seen in use, and
 * it is what identifies dormant keys worth revoking.
 */
export async function resolveApiKey(db: Database, secret: string): Promise<KeyPrincipal | null> {
  if (secret === '') return null;

  const rows = await db.execute(sql`
    UPDATE api_key
    SET last_used_at = now()
    WHERE key_hash = ${keyHash(secret)}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING id AS "keyId", org_id AS "orgId", name, scopes,
              rate_limit_per_min AS "rateLimitPerMin"`);

  return (rows as unknown as KeyPrincipal[])[0] ?? null;
}

/** Soft-revokes a key. The row stays so audit entries referencing it still resolve. */
export async function revokeApiKey(db: Database, keyId: string, orgId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE api_key SET revoked_at = now()
    WHERE id = ${keyId} AND org_id = ${orgId} AND revoked_at IS NULL
    RETURNING id`);
  return (rows as unknown as unknown[]).length > 0;
}

/** Lists an org's keys. Never returns a hash — only what is safe to display. */
export async function listApiKeys(db: Database, orgId: string): Promise<unknown[]> {
  const rows = await db.execute(sql`
    SELECT id, name, prefix, scopes, rate_limit_per_min AS "rateLimitPerMin",
           last_used_at AS "lastUsedAt", expires_at AS "expiresAt", revoked_at AS "revokedAt",
           created_at AS "createdAt"
    FROM api_key WHERE org_id = ${orgId} ORDER BY created_at DESC`);
  return rows as unknown as unknown[];
}
