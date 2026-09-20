import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, setTenant, type Database, inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { createLogger, type Config } from '@crm/shared';
import {
  createOrgWithAdmin, addUserToOrg, setPassword, writeAudit, writeAuditInTenant,
  SYSTEM_ACTOR, AUDIT
} from '@crm/core';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const hasher = new BuiltinPasswordHasher();
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;

const bootstrap = () => ['Authorization', `Bearer ${API_KEY}`] as const;
const freshEmail = () => `u${randomBytes(6).toString('hex')}@example.com`;

/** Provisions an org to act within. */
async function provision(email = freshEmail(), password = 'a-long-enough-password') {
  const { orgId, userId } = await createOrgWithAdmin(db, hasher, {
    orgName: 'Audit Org', slug: `o${randomBytes(6).toString('hex')}`,
    email, password, displayName: 'Admin'
  });
  return { orgId, userId, email, password };
}

/** Reads the trail for one org, newest first. */
async function trail(orgId: string) {
  const rows = await db.execute(sql`
    SELECT action, actor_type AS "actorType", actor_id AS "actorId",
           target_type AS "targetType", target_id AS "targetId", before, after,
           request_id AS "requestId"
    FROM audit_log WHERE org_id = ${orgId} ORDER BY at DESC, action DESC`);
  return rows as unknown as Array<{
    action: string; actorType: string; actorId: string; targetType: string | null;
    targetId: string | null; before: unknown; after: unknown; requestId: string | null;
  }>;
}

/** Pulls one cookie out of a Set-Cookie list. */
function cookieValue(setCookie: string[] | undefined, name: string): string {
  for (const c of setCookie ?? []) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(';')[0]!;
  }
  return '';
}

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => { await db.execute(sql`DELETE FROM org`); });

describe('the audit table itself', () => {
  it('records an entry with a non-null actor', async () => {
    const { orgId } = await provision();
    await writeAuditInTenant(db, {
      orgId, actor: SYSTEM_ACTOR, action: 'test.happened', targetType: 'thing',
      targetId: randomUUID(), after: { x: 1 }
    });

    const entry = (await trail(orgId)).find((e) => e.action === 'test.happened');
    expect(entry?.actorId).toBe(SYSTEM_ACTOR.id);
    expect(entry?.actorType).toBe('system');
  });

  it('refuses a row dated in the future', async () => {
    const { orgId } = await provision();
    // A future timestamp is always a bug — a clock problem, or a caller supplying its own —
    // and an audit trail that accepts them cannot be trusted to order events.
    await expect(db.transaction(async (tx) => {
      await setTenant(tx, orgId);
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_type, actor_id, action, at)
        VALUES (${orgId}, 'system', ${SYSTEM_ACTOR.id}, 'x', now() + interval '1 hour')`);
    })).rejects.toThrow();
  });

  it('keeps one org out of another org trail', async () => {
    const a = await provision();
    const b = await provision();

    const trailA = await trail(a.orgId);
    expect(trailA.length).toBeGreaterThan(0);
    // Nothing from the other provisioning may appear here.
    expect(trailA.every((e) => e.targetId !== b.userId)).toBe(true);
  });

  it('rolls the change back when the audit write fails', async () => {
    const { orgId } = await provision();
    const before = await db.execute(sql`SELECT count(*)::int AS n FROM app_user`);

    // Same transaction: a refused audit row must take the change with it, or an unaudited
    // change becomes possible, which is the one thing this table exists to prevent.
    await expect(db.transaction(async (tx) => {
      await setTenant(tx, orgId);
      await tx.execute(sql`
        INSERT INTO app_user (email, display_name) VALUES (${freshEmail()}, 'x')`);
      await writeAudit(tx, {
        orgId, actor: SYSTEM_ACTOR, action: 'x',
        // actor_type has no CHECK, so force the failure with a null action instead.
        targetId: 'not-a-uuid'
      });
    })).rejects.toThrow();

    const after = await db.execute(sql`SELECT count(*)::int AS n FROM app_user`);
    expect((after as unknown as Array<{ n: number }>)[0]!.n)
      .toBe((before as unknown as Array<{ n: number }>)[0]!.n);
  });
});

describe('what gets audited', () => {
  it('records the org and its first admin when provisioned', async () => {
    const { orgId, userId } = await provision();
    const actions = (await trail(orgId)).map((e) => e.action);

    expect(actions).toContain(AUDIT.orgCreated);
    expect(actions).toContain(AUDIT.userAdded);
    expect((await trail(orgId)).find((e) => e.action === AUDIT.userAdded)?.targetId).toBe(userId);
  });

  it('never records a password hash', async () => {
    const { orgId, email } = await provision();
    await setPassword(db, hasher, email, 'another-long-enough-password');

    const everything = JSON.stringify(await trail(orgId));
    // An audit log holding secrets is a second copy of the problem it exists to detect.
    expect(everything).not.toContain('$argon2id$');
  });

  it('records a successful sign-in against the session it created', async () => {
    const { orgId, email, password } = await provision();
    const r = await request(app).post('/api/v1/auth/login').send({ email, password });

    const entry = (await trail(orgId)).find((e) => e.action === AUDIT.loginSucceeded);
    expect(entry).toBeDefined();
    expect(entry?.actorType).toBe('user');
    // request_id is the seam between this row and the log lines from the same request.
    expect(entry?.requestId).not.toBeNull();
    expect(r.status).toBe(200);
  });

  it('records a failed sign-in for a real account, with the reason', async () => {
    const { orgId, email } = await provision();
    await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });

    const entry = (await trail(orgId)).find((e) => e.action === AUDIT.loginFailed);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.after)).toContain('wrong_password');
  });

  it('records nothing for an unknown email, having no tenant to record it against', async () => {
    const { orgId } = await provision();
    const beforeCount = (await trail(orgId)).length;

    await request(app).post('/api/v1/auth/login')
      .send({ email: freshEmail(), password: 'wrong-password' });

    // Inventing a tenant would leak into some org's log that a stranger typed an unknown
    // address at it.
    expect((await trail(orgId)).length).toBe(beforeCount);
  });

  it('records a sign-out', async () => {
    const { orgId, email, password } = await provision();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const cookies = login.headers['set-cookie'] as unknown as string[];

    await request(app).post('/api/v1/auth/logout')
      .set('Cookie', `crm_session=${cookieValue(cookies, 'crm_session')}; crm_csrf=${cookieValue(cookies, 'crm_csrf')}`)
      .set('x-csrf-token', cookieValue(cookies, 'crm_csrf'));

    expect((await trail(orgId)).map((e) => e.action)).toContain(AUDIT.logout);
  });

  it('records a password change, and how many sessions it ended', async () => {
    const { orgId, email } = await provision();
    const result = await setPassword(db, hasher, email, 'another-long-enough-password');

    const entry = (await trail(orgId)).find((e) => e.action === AUDIT.passwordChanged);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.after)).toContain(String(result.sessionsRevoked));
  });

  it('records an issued key by prefix, never by secret', async () => {
    const { orgId } = await provision();
    const r = await request(app).post('/api/v1/admin/keys').set(...bootstrap())
      .send({ name: 'portal', scopes: ['messages:send'], orgId });

    const entry = (await trail(orgId)).find((e) => e.action === AUDIT.apiKeyIssued);
    expect(entry).toBeDefined();
    // The bootstrap key is the deployment acting, not a person.
    expect(entry?.actorType).toBe('system');
    expect(JSON.stringify(entry?.after)).not.toContain(r.body.data.secret);
    expect(JSON.stringify(entry?.after)).toContain(r.body.data.prefix);
  });

  it('records a person added to an org, attributed to who added them', async () => {
    const { orgId, userId } = await provision();
    await addUserToOrg(db, hasher, {
      orgId, email: freshEmail(), password: 'a-long-enough-password',
      displayName: 'Agent', role: 'agent'
    }, { type: 'user', id: userId });

    const entries = (await trail(orgId)).filter((e) => e.action === AUDIT.userAdded);
    expect(entries.some((e) => e.actorId === userId)).toBe(true);
  });
});
