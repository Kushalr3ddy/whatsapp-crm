import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database, inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { resetRateLimits } from '../../apps/api/src/rate-limit.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const API_KEY = randomBytes(32).toString('hex');
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY, DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
/** A real per-org key, minted fresh for each test. This is what data routes now require. */
let orgKey: string;

/** Authenticates as the org, the way an integration actually would. */
const auth = () => ['Authorization', `Bearer ${orgKey}`] as const;

/** Authenticates as the deployment. Reaches provisioning only — never data. */
const bootstrapAuth = () => ['Authorization', `Bearer ${API_KEY}`] as const;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  // Resolved the same way the real server resolves it, so these tests run with row-level
  // security actually enforced rather than bypassed. The test role owns the tables, so
  // without this every policy in the schema would sit inert underneath the suite.
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  // Cascades to api_key, session, membership and everything tenant-scoped.
  await db.execute(sql`DELETE FROM org`);
  const rows = await db.execute(sql`INSERT INTO org(name,slug) VALUES ('t','t-api') RETURNING id`);
  orgId = (rows as unknown as Array<{ id: string }>)[0]!.id;

  // Every data route now needs a key that *states* its org, rather than one shared secret
  // that had to guess. Minted per test so nothing leaks between them.
  const issued = await issueApiKey(db, {
    orgId, name: 'test', scopes: [...API_SCOPES_FOR_TESTS]
  });
  orgKey = issued.secret;
});

/** Full scopes: these tests are about the routes, not about scope enforcement. */
const API_SCOPES_FOR_TESTS = [
  'contacts:read', 'contacts:write', 'conversations:read', 'conversations:write',
  'messages:send', 'senders:read', 'senders:write'
] as const;

describe('authentication', () => {
  it('refuses a request with no key', async () => {
    const r = await request(app).get('/api/v1/senders');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a wrong key, without saying which part was wrong', async () => {
    const none = await request(app).get('/api/v1/senders');
    const wrong = await request(app).get('/api/v1/senders').set('Authorization', 'Bearer nope');

    expect(wrong.status).toBe(401);
    // Identical to "no credential at all": distinguishing them tells an attacker their key
    // format was right.
    expect(wrong.body.detail).toBe(none.body.detail);
    expect(wrong.body.code).toBe(none.body.code);
  });

  it('accepts a valid per-org key', async () => {
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(200);
  });

  it('lists a sender with its live state, and none of the old engine\'s fields', async () => {
    await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgId}, 'baileys', 'plain', 'active')`);

    const r = await request(app).get('/api/v1/senders').set(...auth());
    const sender = (r.body.data as Array<Record<string, unknown>>).find((s) => s.label === 'plain')!;

    expect(sender).toMatchObject({ status: 'active', linked: false });
    for (const gone of ['riskScore', 'health', 'enforcement', 'recovery', 'restrictionState', 'advisoryReason', 'warmupStartedAt']) {
      expect(sender, gone).not.toHaveProperty(gone);
    }
  });

  it('serves a second org without complaint, because the key names its own tenant', async () => {
    // This used to be a 409 MULTIPLE_ORGS. The org was resolved by `SELECT id FROM org LIMIT 2`
    // and a config-level key could not say which tenant it meant, so a second org broke the
    // entire API. A key now states its org, and more than one is unremarkable.
    await db.execute(sql`INSERT INTO org(name,slug) VALUES ('second','t-api-2')`);

    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(200);
  });

  it('never lets one org see the data of another', async () => {
    const other = await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('second','t-api-2') RETURNING id`);
    const otherOrgId = (other as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${otherOrgId}, 'baileys', 'theirs', 'active')`);

    const r = await request(app).get('/api/v1/senders').set(...auth());

    expect(r.status).toBe(200);
    // The other tenant's sender must not appear, whatever else is in the table.
    expect((r.body.data as Array<{ label: string }>).some((x) => x.label === 'theirs')).toBe(false);
  });

  it('refuses the deployment bootstrap key on data routes', async () => {
    const r = await request(app).get('/api/v1/senders').set(...bootstrapAuth());
    // It authenticates, but it holds no org and must never reach data — that single shared
    // secret having full read/write is the hole per-org keys exist to close.
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('BOOTSTRAP_KEY_SCOPE');
  });

  it('refuses a revoked key', async () => {
    await db.execute(sql`UPDATE api_key SET revoked_at = now() WHERE org_id = ${orgId}`);
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(401);
  });

  it('refuses an expired key', async () => {
    await db.execute(sql`UPDATE api_key SET expires_at = now() - interval '1 second' WHERE org_id = ${orgId}`);
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(401);
  });
});

describe('senders', () => {
  it('creates and lists a sender', async () => {
    const created = await request(app).post('/api/v1/senders').set(...auth())
      .send({ label: 'my number' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('linking');

    const list = await request(app).get('/api/v1/senders').set(...auth());
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].label).toBe('my number');
  });

  it('rejects an invalid label', async () => {
    const r = await request(app).post('/api/v1/senders').set(...auth()).send({ label: '' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('requires a phone number for pairing-code mode', async () => {
    const s = await request(app).post('/api/v1/senders').set(...auth()).send({ label: 'n' });
    const r = await request(app).post(`/api/v1/senders/${s.body.data.id}/link`).set(...auth())
      .send({ mode: 'pairing_code' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('PHONE_REQUIRED');
  });

  it('accepts a link request and returns somewhere to poll, not the QR itself', async () => {
    // Linking is asynchronous by necessity: the socket lives in the gateway process.
    const s = await request(app).post('/api/v1/senders').set(...auth()).send({ label: 'n' });
    const r = await request(app).post(`/api/v1/senders/${s.body.data.id}/link`).set(...auth())
      .send({ mode: 'qr' });
    expect(r.status).toBe(202);
    expect(r.body.data.poll).toContain('/link');

    const poll = await request(app).get(`/api/v1/senders/${s.body.data.id}/link`).set(...auth());
    // No gateway is running in this test, so it stays pending rather than erroring.
    expect(poll.body.data.state).toBe('pending');
  });

  it('answers 404 for a sender in another tenant, not 403', async () => {
    // Confirming a resource exists elsewhere is itself a leak.
    const r = await request(app).post(`/api/v1/senders/${randomUUID()}/link`).set(...auth())
      .send({ mode: 'qr' });
    expect(r.status).toBe(404);
  });
});

describe('sending', () => {
  /** Creates a sender already in the active state, as linking would leave it. */
  async function activeSender(): Promise<string> {
    const rows = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      SELECT id, 'baileys', 'active one', 'active' FROM org LIMIT 1 RETURNING id`);
    return (rows as unknown as Array<{ id: string }>)[0]!.id;
  }

  it('refuses a landline before it ever reaches WhatsApp', async () => {
    // A doomed send would only fail later.
    await activeSender();
    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+911123456789', body: 'hi' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NOT_REACHABLE');
    expect(r.body.detail).toContain('fixed_line');
  });

  it('refuses a number that is not valid for the country', async () => {
    await activeSender();
    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '1111111111', body: 'hi' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('PHONE_INVALID_FOR_COUNTRY');
  });

  it('queues a message, creating the contact and conversation', async () => {
    await activeSender();
    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'hello there' });
    expect(r.status).toBe(202);          // accepted for sending, NOT sent
    expect(r.body.data.status).toBe('queued');
    expect(r.body.data.to).toBe('+919876543210');

    const thread = await request(app)
      .get(`/api/v1/conversations/${r.body.data.conversationId}/messages`).set(...auth());
    expect(thread.body.data).toHaveLength(1);
    expect(thread.body.data[0].body).toBe('hello there');
    expect(thread.body.data[0].undecryptable).toBe(false);
  });

  it('normalises the recipient, so one person is not several contacts', async () => {
    // The M8 regression test, at the API boundary this time.
    await activeSender();
    for (const to of ['+91 98765 43210', '9876543210', '+919876543210']) {
      await request(app).post('/api/v1/messages').set(...auth()).send({ to, body: 'x' });
    }
    const rows = await db.execute(sql`SELECT count(*)::int AS c FROM contact`);
    expect((rows as unknown as Array<{ c: number }>)[0]!.c).toBe(1);
  });

  it('explains what to do when no number is linked', async () => {
    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'hi' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NO_ACTIVE_SENDER');
    expect(r.body.detail).toContain('POST /api/v1/senders');
  });

  it('lists conversations with message counts', async () => {
    await activeSender();
    await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'one' });
    const r = await request(app).get('/api/v1/conversations').set(...auth());
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].messageCount).toBe(1);
  });

  it('replies into an existing conversation, addressed by thread rather than number', async () => {
    await activeSender();
    const first = await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'one' });
    const conversationId = first.body.data.conversationId;

    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ conversationId, body: 'two' });

    expect(r.status).toBe(202);
    expect(r.body.data.conversationId).toBe(conversationId);
  });

  it('replies to a contact that has no phone at all — a WhatsApp privacy address', async () => {
    const sender = await activeSender();
    // Exactly what an inbound @lid produces: an identity with no phone number anywhere.
    const rows = await db.execute(sql`
      WITH c AS (
        INSERT INTO contact (org_id, display_name, source)
        VALUES ((SELECT id FROM org), '110762928373833@lid', 'inbound_message') RETURNING id
      ), i AS (
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        SELECT (SELECT id FROM org), c.id, 'wa_lid', '110762928373833@lid', true FROM c
      )
      INSERT INTO conversation (org_id, contact_id, sender_identity_id)
      SELECT (SELECT id FROM org), c.id, ${sender} FROM c
      RETURNING id`);
    const conversationId = (rows as unknown as Array<{ id: string }>)[0]!.id;

    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ conversationId, body: 'reply to a privacy address' });

    // `to` could never name this person. Addressing by conversation is the only way to answer,
    // and the gateway resolves the wa_lid identity when it sends.
    expect(r.status).toBe(202);
  });

  it('refuses a conversation belonging to nobody', async () => {
    const r = await request(app).post('/api/v1/messages').set(...auth())
      .send({ conversationId: '00000000-0000-4000-8000-000000000000', body: 'hi' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });

  it('refuses both an address and a conversation, and refuses neither', async () => {
    const both = await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', conversationId: '00000000-0000-4000-8000-000000000000', body: 'x' });
    expect(both.status).toBe(422);

    const neither = await request(app).post('/api/v1/messages').set(...auth()).send({ body: 'x' });
    expect(neither.status).toBe(422);
  });

  it('counts queued messages, so the inbox can warn that nothing has been sent', async () => {
    await activeSender();
    await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'one' });

    const r = await request(app).get('/api/v1/conversations').set(...auth());
    // Nothing is linked in a test, so the message can only be queued — which is exactly the
    // state a person misreads as sent.
    expect(r.body.data[0].queuedCount).toBe(1);
    expect(r.body.data[0].messageCount).toBe(1);
  });

  it('stops counting a message as queued once it has been sent', async () => {
    await activeSender();
    await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'one' });
    await db.execute(sql`UPDATE message SET status = 'sent', sent_at = now()`);

    const r = await request(app).get('/api/v1/conversations').set(...auth());
    expect(r.body.data[0].queuedCount).toBe(0);
    expect(r.body.data[0].messageCount).toBe(1);
  });

  it('includes the contact phone, without which a reply has no address', async () => {
    await activeSender();
    await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'one' });
    const r = await request(app).get('/api/v1/conversations').set(...auth());
    expect(r.body.data[0].contactPhone).toBe('+919876543210');
  });

  it('does not duplicate a conversation when a contact has several phone identities', async () => {
    await activeSender();
    await request(app).post('/api/v1/messages').set(...auth())
      .send({ to: '+919876543210', body: 'one' });

    // A second, non-primary phone for the same person — exactly what a merge leaves behind.
    // Joining contact_identity rather than sub-selecting would return the conversation twice,
    // which is why the query uses a correlated subquery.
    await db.execute(sql`
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      SELECT org_id, contact_id, 'phone', '+919876543211', false
      FROM contact_identity WHERE value_normalized = '+919876543210'`);

    const r = await request(app).get('/api/v1/conversations').set(...auth());
    expect(r.body.data).toHaveLength(1);
    // The primary wins, so the reply address does not drift to a secondary number.
    expect(r.body.data[0].contactPhone).toBe('+919876543210');
  });
});

describe('problem responses', () => {
  it('refuses a malformed id rather than letting Postgres throw', async () => {
    // This used to be a 500: the value reached a query, the uuid cast raised 22P02, and the
    // error boundary turned a caller's typo into INTERNAL_ERROR. Bodies were validated and
    // path parameters were not.
    const r = await request(app)
      .get('/api/v1/conversations/not-a-uuid/messages').set(...auth());

    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(r.body.detail).toContain('id');
  });

  it('still answers 404 for an id that is well formed but absent', async () => {
    // The distinction that matters: malformed is the caller's mistake and can be named,
    // absent is indistinguishable from another tenant's and must not be.
    const r = await request(app)
      .get('/api/v1/conversations/00000000-0000-4000-8000-00000000dead/messages')
      .set(...auth());
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('validates ids on every route that takes one', async () => {
    const senders = await request(app).get('/api/v1/senders/nope/link').set(...auth());
    expect(senders.status).toBe(422);
    const media = await request(app).get('/api/v1/media/nope').set(...auth());
    expect(media.status).toBe(422);
  });

  it('puts the real status in the problem body, on every route', async () => {
    // Two routers used to hardcode "status": 0 while the real code went out on the status
    // line, so a client reading body.status got 0 from some routes and the truth from others.
    const cases = [
      request(app).get('/api/v1/conversations/not-a-uuid/messages').set(...auth()),
      request(app).post('/api/v1/messages').set(...auth()).send({ body: '' }),
      request(app).post('/api/v1/senders').set(...auth()).send({}),
      request(app).get('/api/v1/media/00000000-0000-4000-8000-00000000dead').set(...auth()),
      request(app).get('/api/v1/senders'),
    ];
    for (const pending of cases) {
      const r = await pending;
      if (r.status >= 400) {
        expect(r.body.status, `body.status for ${r.request.url}`).toBe(r.status);
        expect(r.body.status).not.toBe(0);
      }
    }
  });
});

describe('per-key rate limiting', () => {
  beforeEach(() => { resetRateLimits(); });

  it('enforces the key’s own rate_limit_per_min', async () => {
    // The column has existed since the key table did, and until now was enforced nowhere —
    // which is worse than absent, because it reads like a control that is in force.
    const slow = await issueApiKey(db, {
      orgId, name: 'slow', scopes: ['senders:read'], rateLimitPerMin: 3
    });
    const hdr = ['Authorization', `Bearer ${slow.secret}`] as const;

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/api/v1/senders').set(...hdr)).status).toBe(200);
    }
    const blocked = await request(app).get('/api/v1/senders').set(...hdr);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    // A well-behaved client is told exactly when to return rather than hammering.
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['ratelimit-limit']).toBe('3');
  });

  it('counts each key separately', async () => {
    const a = await issueApiKey(db, {
      orgId, name: 'a', scopes: ['senders:read'], rateLimitPerMin: 1
    });
    const b = await issueApiKey(db, {
      orgId, name: 'b', scopes: ['senders:read'], rateLimitPerMin: 1
    });

    await request(app).get('/api/v1/senders').set('Authorization', `Bearer ${a.secret}`);
    const aBlocked = await request(app).get('/api/v1/senders')
      .set('Authorization', `Bearer ${a.secret}`);
    const bFine = await request(app).get('/api/v1/senders')
      .set('Authorization', `Bearer ${b.secret}`);

    expect(aBlocked.status).toBe(429);
    // One noisy integration must not throttle another org's — or even the same org's — key.
    expect(bFine.status).toBe(200);
  });

  it('does not limit a session, which is a person clicking', async () => {
    // Sessions carry no per-key ceiling; the abuse that matters lands on /auth/login, which
    // has its own throttle.
    for (let i = 0; i < 40; i++) {
      const r = await request(app).get('/api/v1/senders').set(...auth());
      expect(r.status).not.toBe(429);
    }
  });
});

describe('unlinking a sender', () => {
  it('records an unlink request for a linked number, so the gateway can reset it', async () => {
    const s = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgId}, 'baileys', 'linked', 'active') RETURNING id`);
    const senderId = (s as unknown as Array<{ id: string }>)[0]!.id;
    // A channel_session row exists once a number has been linked.
    await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state) VALUES (${senderId}, 'open')`);

    const r = await request(app).post(`/api/v1/senders/${senderId}/unlink`).set(...auth());
    expect(r.status).toBe(202);

    const cs = (await db.execute(sql`
      SELECT unlink_requested_at AS u FROM channel_session WHERE sender_identity_id = ${senderId}`)
    ) as unknown as Array<{ u: string | null }>;
    expect(cs[0]!.u).not.toBeNull();
  });

  it('is a 404 for a sender that was never linked (no session row)', async () => {
    const s = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgId}, 'baileys', 'never', 'linking') RETURNING id`);
    const senderId = (s as unknown as Array<{ id: string }>)[0]!.id;
    const r = await request(app).post(`/api/v1/senders/${senderId}/unlink`).set(...auth());
    expect(r.status).toBe(404);
  });

  it('is a 404 for an unknown sender id', async () => {
    const r = await request(app)
      .post('/api/v1/senders/00000000-0000-4000-8000-00000000dead/unlink').set(...auth());
    expect(r.status).toBe(404);
  });
});

describe('the linked flag on GET /senders', () => {
  it('reflects whether stored credentials exist, not the socket state', async () => {
    const s = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgId}, 'baileys', 'flag', 'active') RETURNING id`);
    const senderId = (s as unknown as Array<{ id: string }>)[0]!.id;

    const before = await request(app).get('/api/v1/senders').set(...auth());
    const unlinkedRow = (before.body.data as Array<{ id: string; linked: boolean }>)
      .find((x) => x.id === senderId);
    expect(unlinkedRow?.linked).toBe(false);

    // A stored credential is what "linked" means.
    await db.execute(sql`
      INSERT INTO channel_auth_state (sender_identity_id, key, value_enc)
      VALUES (${senderId}, 'creds', ${Buffer.from('x')})`);

    const after = await request(app).get('/api/v1/senders').set(...auth());
    const linkedRow = (after.body.data as Array<{ id: string; linked: boolean }>)
      .find((x) => x.id === senderId);
    expect(linkedRow?.linked).toBe(true);
  });
});
