import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';
import { writeAudit, AUDIT, SYSTEM_ACTOR, type AuditActor } from './audit.js';
import type { PasswordHasher } from '@crm/auth-builtin';

/** What provisioning produced. */
export interface ProvisionedOrg {
  readonly orgId: string;
  readonly userId: string;
}

/** Raised when the requested org or person already exists, so the caller can say which. */
export class AlreadyExistsError extends Error {
  /** `field` names what collided, so a CLI can print something useful. */
  constructor(readonly field: 'slug' | 'email') {
    super(`${field} is already taken`);
    this.name = 'AlreadyExistsError';
  }
}

/**
 * Creates an organisation and its first admin, as one transaction.
 *
 * **The single provisioning seam.** A future self-serve `/signup` is a thin caller of this, as
 * is the admin CLI and any setup wizard (D-8) — so there is exactly one code path that can
 * bring an org into existence, and no more rows that nothing can reproduce.
 *
 * Note the ordering, which row-level security forces: the `org` policy has no `WITH CHECK`, so
 * Postgres reuses its `USING` clause for inserts and will only accept a row whose `id` matches
 * `app.org_id`. The id is therefore generated here and the tenant context set to it *before*
 * the insert. Done the other way round this fails under a correctly configured role while
 * appearing to work as a table owner, which is the trap `inspectDatabaseSecurity()` warns about.
 */
export async function createOrgWithAdmin(
  db: Database,
  hasher: PasswordHasher,
  input: { orgName: string; slug: string; email: string; password: string; displayName: string },
  /** Who provisioned this. The CLI and the bootstrap key are both the system acting. */
  actor: AuditActor = SYSTEM_ACTOR
): Promise<ProvisionedOrg> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hasher.hash(input.password);
  const orgId = randomUUID();

  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);

    const orgRows = await tx.execute(sql`
      INSERT INTO org (id, name, slug) VALUES (${orgId}, ${input.orgName}, ${input.slug})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id`);
    if ((orgRows as unknown as unknown[]).length === 0) throw new AlreadyExistsError('slug');

    // app_user is deliberately not tenant-scoped — a person may belong to several orgs, and
    // authentication has to find them before any org context exists.
    const userRows = await tx.execute(sql`
      INSERT INTO app_user (email, password_hash, display_name)
      VALUES (${email}, ${passwordHash}, ${input.displayName})
      ON CONFLICT (email) DO NOTHING
      RETURNING id`);
    if ((userRows as unknown as unknown[]).length === 0) throw new AlreadyExistsError('email');
    const userId = (userRows as unknown as Array<{ id: string }>)[0]!.id;

    await tx.execute(sql`
      INSERT INTO org_membership (org_id, user_id, role)
      VALUES (${orgId}, ${userId}, 'admin')`);

    // Same transaction as the change: if either of these fails, nothing happened at all.
    // Note what is absent from `after` — the password hash. An audit log holding secrets is a
    // second copy of the problem it exists to detect.
    await writeAudit(tx, {
      orgId, actor, action: AUDIT.orgCreated, targetType: 'org', targetId: orgId,
      after: { name: input.orgName, slug: input.slug }
    });
    await writeAudit(tx, {
      orgId, actor, action: AUDIT.userAdded, targetType: 'app_user', targetId: userId,
      after: { email, role: 'admin' }
    });

    return { orgId, userId };
  });
}

/**
 * Adds a person to an existing org. The invite path.
 *
 * Creates the `app_user` row if this email is new, and attaches a membership either way — the
 * same person can be an admin in one org and an agent in another, which is why the role lives
 * on the membership rather than the user.
 */
export async function addUserToOrg(
  db: Database,
  hasher: PasswordHasher,
  input: { orgId: string; email: string; password: string; displayName: string; role: 'admin' | 'agent' },
  actor: AuditActor = SYSTEM_ACTOR
): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hasher.hash(input.password);

  return db.transaction(async (tx) => {
    await setTenant(tx, input.orgId);

    const existing = await tx.execute(sql`SELECT id FROM app_user WHERE email = ${email}`);
    let userId = (existing as unknown as Array<{ id: string }>)[0]?.id;

    if (userId === undefined) {
      const created = await tx.execute(sql`
        INSERT INTO app_user (email, password_hash, display_name)
        VALUES (${email}, ${passwordHash}, ${input.displayName})
        RETURNING id`);
      userId = (created as unknown as Array<{ id: string }>)[0]!.id;
    }

    const membership = await tx.execute(sql`
      INSERT INTO org_membership (org_id, user_id, role)
      VALUES (${input.orgId}, ${userId}, ${input.role})
      ON CONFLICT (org_id, user_id) DO NOTHING
      RETURNING id`);
    if ((membership as unknown as unknown[]).length === 0) throw new AlreadyExistsError('email');

    await writeAudit(tx, {
      orgId: input.orgId, actor, action: AUDIT.userAdded,
      targetType: 'app_user', targetId: userId, after: { email, role: input.role }
    });

    return { userId };
  });
}

/**
 * Sets a new password and ends every session that person holds.
 *
 * The two belong together: changing a password without evicting existing sessions does not
 * actually remove whoever the change was meant to remove (docs/09-security.md).
 */
export async function setPassword(
  db: Database, hasher: PasswordHasher, email: string, newPassword: string,
  actor: AuditActor = SYSTEM_ACTOR
): Promise<{ userId: string; sessionsRevoked: number }> {
  const passwordHash = await hasher.hash(newPassword);
  const normalised = email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE app_user SET password_hash = ${passwordHash}, updated_at = now()
      WHERE email = ${normalised}
      RETURNING id`);
    const userId = (rows as unknown as Array<{ id: string }>)[0]?.id;
    if (userId === undefined) throw new Error(`no user with email ${email}`);

    const revoked = await tx.execute(sql`
      UPDATE session SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
      RETURNING id`);
    const sessionsRevoked = (revoked as unknown as unknown[]).length;

    // A person may belong to several orgs; the change is recorded in each, because each of
    // them has a legitimate interest in knowing that this account's password changed.
    const orgs = await tx.execute(sql`
      SELECT org_id AS "orgId" FROM org_membership WHERE user_id = ${userId}`);
    for (const m of orgs as unknown as Array<{ orgId: string }>) {
      await setTenant(tx, m.orgId);
      await writeAudit(tx, {
        orgId: m.orgId, actor, action: AUDIT.passwordChanged,
        targetType: 'app_user', targetId: userId,
        after: { sessionsRevoked }
      });
    }

    return { userId, sessionsRevoked };
  });
}
