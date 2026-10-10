/**
 * Administrative commands, for setting a deployment up and for support.
 *
 *   npm run admin org      --name "Hiring Studios" --slug hiring-studios --email a@b.com
 *   npm run admin user     --org <uuid> --email c@d.com --role agent
 *   npm run admin password --email a@b.com
 *   npm run admin billing --slug acme --status exempt --note "beta tester"   (unpaid | paid | exempt)
 *   npm run admin key      --org <uuid> --name "job portal" --scopes messages:send,contacts:read
 *   npm run admin keys     --org <uuid>
 *
 * Passwords are **generated and printed** rather than taken as an argument: an argument ends
 * up in shell history and in the process list, where anyone on the box can read it. Pass
 * `--password` only if you have a reason to.
 *
 * Anyone who can run this can mint an administrator, which is the same thing as saying that
 * shell access to the server is total access. That is already true of a machine holding the
 * database credentials and ENCRYPTION_KEY; this changes nothing about it.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { loadConfig, createLogger } from '@crm/shared';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import {
  createOrgWithAdmin, addUserToOrg, setPassword, setOrgBilling, issueApiKey, listApiKeys,
  API_SCOPES, AlreadyExistsError
} from '@crm/core';

/** Parses `--key value` pairs into a map. Unknown flags are the caller's problem, not ours. */
function flags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== undefined && a.startsWith('--')) out.set(a.slice(2), argv[i + 1] ?? '');
  }
  return out;
}

/** A password nobody has to invent, and which never passes through a shell. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

/** Prints a line. This is a CLI: stdout is the interface, so the lint rule is off here. */
function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Requires a flag, exiting with a readable message rather than a stack trace. */
function need(f: Map<string, string>, name: string): string {
  const v = f.get(name);
  if (v === undefined || v === '') {
    say(`missing --${name}`);
    process.exit(1);
  }
  return v;
}

/** Runs one subcommand. */
async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const config = loadConfig();
  const logger = createLogger({ ...config, LOG_LEVEL: 'warn' });
  const db = createDatabase(config.DATABASE_URL, { max: 2 });
  const hasher = new BuiltinPasswordHasher();

  try {
    switch (command) {
      case 'org': {
        const password = f.get('password') ?? generatePassword();
        const result = await createOrgWithAdmin(db, hasher, {
          orgName: need(f, 'name'), slug: need(f, 'slug'), email: need(f, 'email'),
          displayName: f.get('display') ?? need(f, 'email'), password
        });
        say('  organisation created');
        say(`  org id   ${result.orgId}`);
        say(`  admin    ${need(f, 'email')}`);
        say(`  password ${password}`);
        say();
        say('  Save the password now — it is hashed immediately and cannot be shown again.');
        break;
      }

      case 'billing': {
        // The payment override: `npm run admin -- billing --slug acme --status exempt --note "beta tester"`.
        const status = need(f, 'status');
        if (status !== 'unpaid' && status !== 'paid' && status !== 'exempt') {
          say('--status must be unpaid, paid or exempt'); process.exit(1);
        }
        const rows = (await db.execute(sql`SELECT id FROM org WHERE slug = ${need(f, 'slug')}`)) as unknown as
          Array<{ id: string }>;
        if (rows[0] === undefined) { say(`no organisation with slug ${need(f, 'slug')}`); process.exit(1); }
        const { previous } = await setOrgBilling(db, rows[0].id, status, need(f, 'note'));
        say(`  ${need(f, 'slug')}: ${previous} → ${status}`);
        break;
      }

      case 'user': {
        const password = f.get('password') ?? generatePassword();
        const role = f.get('role') ?? 'agent';
        if (role !== 'admin' && role !== 'agent') { say('--role must be admin or agent'); process.exit(1); }
        await addUserToOrg(db, hasher, {
          orgId: need(f, 'org'), email: need(f, 'email'),
          displayName: f.get('display') ?? need(f, 'email'), password, role
        });
        say(`  ${need(f, 'email')} added as ${role}`);
        say(`  password ${password}`);
        break;
      }

      case 'password': {
        const password = f.get('password') ?? generatePassword();
        const result = await setPassword(db, hasher, need(f, 'email'), password);
        say(`  password reset for ${need(f, 'email')}`);
        say(`  password ${password}`);
        // Stated explicitly because it is the point: a reset that left sessions alive would
        // not actually remove whoever the reset was for.
        say(`  ${String(result.sessionsRevoked)} existing session(s) ended`);
        break;
      }

      case 'key': {
        const scopes = (f.get('scopes') ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '');
        if (scopes.length === 0) {
          say(`--scopes is required. Valid: ${API_SCOPES.join(', ')}`);
          process.exit(1);
        }
        const issued = await issueApiKey(db, { orgId: need(f, 'org'), name: need(f, 'name'), scopes });
        say('  key issued');
        say(`  ${issued.secret}`);
        say();
        say('  Copy it now. Only a hash is stored; it cannot be shown again.');
        break;
      }

      case 'keys': {
        const rows = await listApiKeys(db, need(f, 'org')) as Array<{
          id: string; name: string; prefix: string; scopes: string[]; revokedAt: string | null;
          lastUsedAt: string | null;
        }>;
        if (rows.length === 0) say('  no keys');
        for (const k of rows) {
          const state = k.revokedAt !== null ? 'revoked' : 'active';
          say(`  ${k.prefix}…  ${state.padEnd(8)} ${k.name}  [${k.scopes.join(' ')}]`);
        }
        break;
      }

      case 'whoami': {
        const rows = await db.execute(sql`
          SELECT o.id, o.name, o.slug, count(m.id)::int AS members
          FROM org o LEFT JOIN org_membership m ON m.org_id = o.id
          GROUP BY o.id ORDER BY o.created_at`);
        for (const o of rows as unknown as Array<{ id: string; name: string; slug: string; members: number }>) {
          say(`  ${o.id}  ${o.slug.padEnd(20)} ${o.name} (${String(o.members)} member(s))`);
        }
        break;
      }

      default:
        say('commands: org | user | password | key | keys | whoami');
        say('see the header of scripts/admin.ts for usage');
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof AlreadyExistsError) {
      say(`  refused: that ${error.field} is already taken`);
      process.exit(1);
    }
    logger.error({ err: error instanceof Error ? error.message : String(error) }, 'admin command failed');
    process.exit(1);
  } finally {
    await db.$client.end();
  }
}

await main();
