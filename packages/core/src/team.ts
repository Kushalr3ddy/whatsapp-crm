import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';
import type { PasswordHasher } from '@crm/auth-builtin';
import { AUDIT, SYSTEM_ACTOR, writeAudit, type AuditActor } from './audit.js';
import { setPassword } from './provisioning.js';

/** One person in an org, as the Team page shows them. Never carries the password hash. */
export interface Member {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'admin' | 'agent';
  readonly status: 'active' | 'disabled';
  readonly lastLoginAt: string | null;
}

/** The person is not in this org (or does not exist). Never says which, so ids cannot be probed. */
export class MemberNotFoundError extends Error {
  /** Builds the error. */
  constructor() { super('member not found'); this.name = 'MemberNotFoundError'; }
}

/** A change that would break a rule of the team: leaving no admin, or an admin locking themselves out. */
export class MemberRuleError extends Error {
  /** Builds the error with a plain-words reason the page can show as it is. */
  constructor(readonly reason: string) { super(reason); this.name = 'MemberRuleError'; }
}

/** Lists everyone in the org, admins first, then by name. */
export async function listMembers(db: Database, orgId: string): Promise<Member[]> {
  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    const rows = await tx.execute(sql`
      SELECT u.id AS "userId", u.email, u.display_name AS "displayName", m.role, u.status,
             u.last_login_at AS "lastLoginAt"
      FROM org_membership m
      JOIN app_user u ON u.id = m.user_id
      WHERE m.org_id = ${orgId}
      ORDER BY (m.role = 'admin') DESC, u.display_name ASC`);
    return rows as unknown as Member[];
  });
}

/**
 * Changes someone's role, or disables or re-enables their account.
 *
 * Rules, because both mistakes lock a team out of its own CRM: nobody may demote or disable
 * themselves, and the org may never be left without an active admin. Disabling also ends every
 * session the person holds, so it takes effect at once instead of at their next login.
 */
export async function changeMember(
  db: Database, orgId: string, userId: string,
  change: { role?: 'admin' | 'agent' | undefined; status?: 'active' | 'disabled' | undefined },
  actor: AuditActor = SYSTEM_ACTOR
): Promise<Member> {
  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    const found = await tx.execute(sql`
      SELECT m.role, u.status, u.email FROM org_membership m JOIN app_user u ON u.id = m.user_id
      WHERE m.org_id = ${orgId} AND m.user_id = ${userId} FOR UPDATE OF m`);
    const current = (found as unknown as Array<{ role: 'admin' | 'agent'; status: 'active' | 'disabled'; email: string }>)[0];
    if (current === undefined) throw new MemberNotFoundError();

    const newRole = change.role ?? current.role;
    const newStatus = change.status ?? current.status;
    const losesAdmin = current.role === 'admin' && current.status === 'active'
      && (newRole !== 'admin' || newStatus !== 'active');

    if (losesAdmin && actor.id === userId) {
      throw new MemberRuleError('You cannot remove your own admin access. Ask another admin to do it.');
    }
    if (losesAdmin) {
      const others = await tx.execute(sql`
        SELECT count(*)::int AS n FROM org_membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.org_id = ${orgId} AND m.role = 'admin' AND u.status = 'active' AND m.user_id <> ${userId}`);
      if (((others as unknown as Array<{ n: number }>)[0]?.n ?? 0) === 0) {
        throw new MemberRuleError('That would leave the team with no active admin. Make someone else an admin first.');
      }
    }

    if (newRole !== current.role) {
      await tx.execute(sql`UPDATE org_membership SET role = ${newRole} WHERE org_id = ${orgId} AND user_id = ${userId}`);
      await writeAudit(tx, {
        orgId, actor, action: AUDIT.userRoleChanged, targetType: 'app_user', targetId: userId,
        before: { role: current.role }, after: { role: newRole }
      });
    }
    if (newStatus !== current.status) {
      await tx.execute(sql`UPDATE app_user SET status = ${newStatus}, updated_at = now() WHERE id = ${userId}`);
      if (newStatus === 'disabled') {
        await tx.execute(sql`UPDATE session SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`);
      }
      await writeAudit(tx, {
        orgId, actor, action: newStatus === 'disabled' ? AUDIT.userDisabled : AUDIT.userEnabled,
        targetType: 'app_user', targetId: userId, before: { status: current.status }, after: { status: newStatus }
      });
    }

    const row = await tx.execute(sql`
      SELECT u.id AS "userId", u.email, u.display_name AS "displayName", m.role, u.status,
             u.last_login_at AS "lastLoginAt"
      FROM org_membership m JOIN app_user u ON u.id = m.user_id
      WHERE m.org_id = ${orgId} AND m.user_id = ${userId}`);
    return (row as unknown as Member[])[0]!;
  });
}

/**
 * Sets a new password for someone in the org and ends their sessions. The admin picks the
 * password and hands it over; email-based reset links do not exist yet.
 */
export async function resetMemberPassword(
  db: Database, hasher: PasswordHasher, orgId: string, userId: string, newPassword: string,
  actor: AuditActor = SYSTEM_ACTOR
): Promise<{ sessionsRevoked: number }> {
  const email = await db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    const rows = await tx.execute(sql`
      SELECT u.email FROM org_membership m JOIN app_user u ON u.id = m.user_id
      WHERE m.org_id = ${orgId} AND m.user_id = ${userId}`);
    return (rows as unknown as Array<{ email: string }>)[0]?.email;
  });
  if (email === undefined) throw new MemberNotFoundError();
  const result = await setPassword(db, hasher, email, newPassword, actor);
  return { sessionsRevoked: result.sessionsRevoked };
}
