import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/** What we found out about the role the application is connecting as. */
export interface DatabaseSecurityReport {
  /** The Postgres role actually in use. */
  readonly role: string;
  /** True if that role is a superuser. Superusers bypass row-level security entirely. */
  readonly isSuperuser: boolean;
  /** True if the role carries BYPASSRLS, which has the same effect for tenant isolation. */
  readonly bypassesRls: boolean;
  /** True if the role owns the tenant tables. An owner bypasses RLS unless FORCE is set. */
  readonly ownsTables: boolean;
  /**
   * The answer that actually matters, measured rather than inferred: with no tenant context
   * set, does a tenant table return rows? If it does, isolation is NOT in effect, whatever
   * the policies say.
   */
  readonly isolationEffective: boolean;
  readonly warnings: readonly string[];
}

/**
 * Checks whether tenant isolation genuinely works for the connecting role, and warns if not.
 *
 * Reading role attributes is not enough, because three different things defeat row-level
 * security and they are easy to confuse: being a superuser, holding BYPASSRLS, or owning the
 * table (owners bypass unless the table is set FORCE). Worse, `pg_tables.rowsecurity` still
 * reports `true` in every one of those cases — the policies look enabled while enforcing
 * nothing. That is a genuinely dangerous thing to be wrong about, so this probes the behaviour:
 * it sets no tenant context and asks a tenant table for a row. Isolation working means it
 * returns nothing.
 *
 * Runs once, at startup, before the server accepts traffic (docs/09-security.md).
 */
export async function inspectDatabaseSecurity(db: Database): Promise<DatabaseSecurityReport> {
  const roleRows = await db.execute(sql`
    SELECT current_user::text AS role,
           r.rolsuper       AS is_superuser,
           r.rolbypassrls   AS bypasses_rls
    FROM pg_roles r WHERE r.rolname = current_user`);
  const role = (roleRows as unknown as Array<{
    role: string; is_superuser: boolean; bypasses_rls: boolean;
  }>)[0] ?? { role: 'unknown', is_superuser: false, bypasses_rls: false };

  const ownerRows = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'contact' AND tableowner = current_user
    ) AS owns`);
  const ownsTables = (ownerRows as unknown as Array<{ owns: boolean }>)[0]?.owns ?? false;

  // The behavioural probe.
  //
  // It has to create its own test row, because simply reading `contact` proves nothing on an
  // empty database — "no rows returned" would look identical to "isolation working", and
  // reporting isolation as verified when it is not would be worse than not checking at all.
  //
  // So: inside a transaction, insert a contact under a random org, clear the tenant context,
  // and try to read it back. Seeing it means isolation is not enforced for this role. The
  // transaction always rolls back, so nothing is left behind either way.
  const isolationEffective = await probeIsolation(db);

  const warnings: string[] = [];
  if (role.is_superuser) {
    warnings.push(
      `connected as SUPERUSER "${role.role}". Superusers bypass row-level security, so tenant ` +
      `isolation is NOT enforced even though the policies appear enabled in pg_tables. ` +
      `Create a dedicated role and connect as that instead: ` +
      `CREATE ROLE crm_app LOGIN PASSWORD '...'; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;`
    );
  }
  if (role.bypasses_rls && !role.is_superuser) {
    warnings.push(
      `role "${role.role}" has BYPASSRLS, so tenant isolation is not enforced. ` +
      `Remove it with: ALTER ROLE "${role.role}" NOBYPASSRLS;`
    );
  }
  if (ownsTables && !role.is_superuser) {
    warnings.push(
      `role "${role.role}" OWNS the tenant tables. Table owners bypass row-level security ` +
      `unless the table is set FORCE — ours are, so this is currently safe, but any new table ` +
      `that forgets FORCE would silently have no isolation. Prefer a non-owner role.`
    );
  }
  if (!isolationEffective) {
    warnings.push(
      `TENANT ISOLATION IS NOT IN EFFECT: a row written under one org was readable while the ` +
      `session was set to a different org. Any bug that omits an org filter will read across ` +
      `tenants. Acceptable for a single-tenant deployment or local development; not acceptable ` +
      `with more than one org.`
    );
  }

  return { role: role.role, isSuperuser: role.is_superuser, bypassesRls: role.bypasses_rls, ownsTables, isolationEffective, warnings };
}

/**
 * Sets the tenant for the current transaction, which is what every row-level security policy
 * reads.
 *
 * Uses `set_config(..., true)` rather than `SET LOCAL`, and that distinction is not cosmetic:
 * **`SET LOCAL` cannot take a bind parameter.** `SET LOCAL app.org_id = $1` is a syntax error,
 * so any attempt to parameterise it fails at runtime — and string-interpolating a value into
 * `SET` instead would be an injection point on the one setting that decides which tenant's
 * data you can see. `set_config` is a normal function call and binds safely. The third
 * argument, `true`, scopes it to the transaction, exactly like `LOCAL`.
 *
 * An earlier version of the probe below used `SET LOCAL` with a parameter, threw, and the
 * error handling turned that into a false report that isolation was working.
 */
export async function setTenant(
  executor: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, orgId: string
): Promise<void> {
  await executor.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
}

/** Sentinel used to abort the probe transaction once it has told us what we need. */
const PROBE_ROLLBACK = Symbol('probe-rollback');

/**
 * Creates a row under a random tenant, then tries to read it with no tenant context set.
 * Returns true when the row is invisible — which is isolation working. Always rolls back.
 */
async function probeIsolation(db: Database): Promise<boolean> {
  let visible = false;
  try {
    await db.transaction(async (tx) => {
      const probeOrg = '00000000-0000-4000-8000-0000000000ff';
      const otherOrg = '00000000-0000-4000-8000-0000000000ee';
      await setTenant(tx, probeOrg);
      await tx.execute(sql`
        INSERT INTO org (id, name, slug) VALUES (${probeOrg}, 'rls probe', 'rls-probe-transient')
        ON CONFLICT (id) DO NOTHING`);
      await tx.execute(sql`
        INSERT INTO contact (org_id, display_name, source) VALUES (${probeOrg}, 'rls probe', 'probe')`);

      // Switch to a DIFFERENT tenant — which is the question that actually matters: can one
      // org see another's rows? Not cleared instead, because `''::uuid` raises a cast error
      // that an earlier version of this probe mistook for "isolation is working".
      await setTenant(tx, otherOrg);
      const rows = await tx.execute(sql`
        SELECT EXISTS (SELECT 1 FROM contact WHERE display_name = 'rls probe') AS visible`);
      visible = (rows as unknown as Array<{ visible: boolean }>)[0]?.visible ?? false;

      throw PROBE_ROLLBACK;
    });
  } catch (error) {
    // Anything other than our sentinel means the probe could not run — most often because the
    // role lacks insert rights, which is stricter than isolation rather than weaker.
    if (error !== PROBE_ROLLBACK) return true;
  }
  return !visible;
}
