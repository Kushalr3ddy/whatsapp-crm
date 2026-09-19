import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';

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
const auth = () => ['Authorization', `Bearer ${API_KEY}`] as const;

beforeAll(() => {
  db = createDatabase(url, { max: 6 });
  app = buildApp({ config, logger, db, kms });
});
afterAll(async () => { await db.$client.end(); });

beforeEach(async () => {
  // These tests exercise the single-org path, so the table must hold exactly one.
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`INSERT INTO org(name,slug) VALUES ('t','t-api')`);
});

describe('authentication', () => {
  it('refuses a request with no key', async () => {
    const r = await request(app).get('/api/v1/senders');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a wrong key, without saying which part was wrong', async () => {
    const r = await request(app).get('/api/v1/senders').set('Authorization', 'Bearer nope');
    expect(r.status).toBe(401);
    // Identical response to "no key at all": distinguishing them tells an attacker their
    // key format is right.
    expect(r.body.detail).toBe('Send a valid API key as: Authorization: Bearer <key>');
  });

  it('accepts a valid key', async () => {
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(200);
  });

  it('refuses rather than guesses when more than one org exists', async () => {
    // A config-level key cannot say which tenant it speaks for, and picking one would be a
    // cross-tenant leak waiting to happen. Per-org keys arrive in P2.
    await db.execute(sql`INSERT INTO org(name,slug) VALUES ('second','t-api-2')`);
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MULTIPLE_ORGS');
  });

  it('reports clearly when nothing is provisioned', async () => {
    await db.execute(sql`DELETE FROM org`);
    const r = await request(app).get('/api/v1/senders').set(...auth());
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('NO_ORG');
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
    // A doomed send costs the sender's delivery ratio, which feeds its health score.
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
