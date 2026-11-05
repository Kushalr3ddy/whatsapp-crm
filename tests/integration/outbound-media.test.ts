import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import {
  createOrgWithAdmin, addUserToOrg, createSession, issueApiKey
} from '@crm/core';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { handleSend, type WorkContext } from '../../apps/gateway/src/work.js';
import { toBaileysContent } from '../../packages/channels/baileys/src/outbound-content.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Outbound media (D-25): an agent can send a file. The API decides what the file is from its
 * bytes, stores it like any attachment, and queues a message; the gateway reads it back and the
 * adapter sends it as the right kind of WhatsApp message.
 */
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
const hasher = new BuiltinPasswordHasher();

/** A few real file headers: enough bytes for the magic-number detector to vouch for them. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgId: string;
let senderId: string;
let conv: string;
let key: string;
let agent2Token: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  app = buildApp({ config, logger, db, kms, hasher, tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'om', slug: 'om-org', email: 'admin@om.test', password: 'x', displayName: 'Admin'
  });
  orgId = org.orgId;
  const agent1 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a1@om.test', password: 'x', displayName: 'A1', role: 'agent' })).userId;
  const agent2 = (await addUserToOrg(db, hasher, {
    orgId, email: 'a2@om.test', password: 'x', displayName: 'A2', role: 'agent' })).userId;
  agent2Token = (await createSession(db, { userId: agent2, orgId })).token;
  key = (await issueApiKey(db, { orgId, name: 'k', scopes: ['messages:send', 'conversations:read'] })).secret;
  senderId = ((await db.execute(sql`
    INSERT INTO sender_identity(org_id, provider, label, status, phone_e164)
    VALUES (${orgId}, 'fake', 'n', 'active', '+919000000011') RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
  const c = ((await db.execute(sql`
    INSERT INTO contact(org_id, display_name, source) VALUES (${orgId}, 'x', 'test') RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
    VALUES (${orgId}, ${c}, 'phone', '+919876511111', true)`);
  conv = ((await db.execute(sql`
    INSERT INTO conversation(org_id, contact_id, sender_identity_id, assignee_user_id)
    VALUES (${orgId}, ${c}, ${senderId}, ${agent1}) RETURNING id`)
  ) as unknown as Array<{ id: string }>)[0]!.id;
});

/** Posts raw bytes into the thread as the API key. */
function upload(bytes: Buffer, query = 'filename=cv.pdf', auth: Record<string, string> = { Authorization: `Bearer ${key}` }) {
  return request(app).post(`/api/v1/conversations/${conv}/attachments?${query}`)
    .set(auth).set('Content-Type', 'application/octet-stream').send(bytes);
}

describe('POST /conversations/:id/attachments', () => {
  it('stores the file and queues a message that carries it', async () => {
    const r = await upload(PDF, 'filename=Priya%20CV.pdf&caption=here%20you%20go');
    expect(r.status).toBe(202);
    expect(r.body.data.contentType).toBe('document');
    expect(r.body.data.status).toBe('queued');

    const rows = await db.execute(sql`
      SELECT m.content_type AS "ct", ma.content_type AS "mime", ma.filename, ma.size_bytes AS "size"
      FROM message m JOIN media_asset ma ON ma.id = m.media_id WHERE m.id = ${r.body.data.id}`);
    const row = (rows as unknown as Array<{ ct: string; mime: string; filename: string; size: number }>)[0]!;
    expect(row.mime).toBe('application/pdf');
    expect(row.filename).toBe('Priya CV.pdf');
    expect(row.size).toBe(PDF.byteLength);
  });

  it('types an image from its bytes, whatever the filename claims', async () => {
    const r = await upload(PNG, 'filename=totally-a-doc.pdf');
    expect(r.status).toBe(202);
    expect(r.body.data.contentType).toBe('image');
  });

  it('refuses HTML and anything it cannot recognise — decided from the bytes, not the name', async () => {
    const r = await upload(HTML, 'filename=cv.pdf');
    expect(r.status).toBe(415);
    expect(r.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM message WHERE direction = 'outbound'`)) as unknown as Array<{ n: number }>;
    expect(n[0]!.n).toBe(0);                                  // nothing queued, nothing stored
  });

  it('refuses an empty body and a file over the limit', async () => {
    expect((await upload(Buffer.alloc(0))).status).toBe(415);
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(17 * 1024 * 1024)]);
    expect((await upload(big)).status).toBe(413);
  });

  it('stores an identical file once, but queues each send', async () => {
    await upload(PDF); await upload(PDF);
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM media_asset WHERE org_id = ${orgId}`)) as unknown as Array<{ n: number }>;
    expect(n[0]!.n).toBe(1);
    const m = (await db.execute(sql`SELECT count(*)::int AS n FROM message WHERE media_id IS NOT NULL`)) as unknown as Array<{ n: number }>;
    expect(m[0]!.n).toBe(2);
  });

  it('answers 404 for a conversation that does not exist, and honours the thread lock', async () => {
    const missing = await request(app)
      .post('/api/v1/conversations/00000000-0000-4000-8000-000000000000/attachments?filename=a.pdf')
      .set({ Authorization: `Bearer ${key}` }).set('Content-Type', 'application/octet-stream').send(PDF);
    expect(missing.status).toBe(404);
    // assigned to agent1; agent2 (not an admin) is locked out, exactly like a text reply
    const locked = await upload(PDF, 'filename=a.pdf',
      { Cookie: `crm_session=${agent2Token}; crm_csrf=csrf`, 'x-csrf-token': 'csrf' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('THREAD_ASSIGNED');
  });

  it('is a send, so it needs the messages:send scope', async () => {
    const readOnly = (await issueApiKey(db, { orgId, name: 'ro', scopes: ['conversations:read'] })).secret;
    const r = await upload(PDF, 'filename=a.pdf', { Authorization: `Bearer ${readOnly}` });
    expect(r.status).toBe(403);
  });
});

describe('the gateway sending a queued attachment', () => {
  /** A context that can read stored files back. */
  function ctx(provider: FakeChannelProvider): WorkContext {
    return {
      db, provider, logger, storage: media.storage,
      decrypt: (c) => new TextDecoder().decode(kms.decrypt(c)), sleep: async () => {}
    };
  }

  it('reads the file from storage and hands the provider its bytes, type and caption', async () => {
    const r = await upload(PDF, 'filename=CV.pdf&caption=hello');
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+919000000011' });
    await handleSend(ctx(provider), r.body.data.id);

    expect(provider.sent).toHaveLength(1);
    const content = provider.sent[0]!.content;
    expect(content.kind).toBe('freeform');
    if (content.kind === 'freeform') {
      expect(content.body).toBe('hello');
      expect(content.media?.contentType).toBe('application/pdf');
      expect(content.media?.filename).toBe('CV.pdf');
      expect(Buffer.from(content.media!.bytes).equals(PDF)).toBe(true);
    }
    const st = (await db.execute(sql`SELECT status FROM message WHERE id = ${r.body.data.id}`)) as unknown as Array<{ status: string }>;
    expect(st[0]!.status).toBe('sent');
  });

  it('fails just that message, visibly, when the file cannot be read', async () => {
    const r = await upload(PDF);
    const provider = new FakeChannelProvider();
    await provider.connect({ id: senderId, phoneE164: '+919000000011' });
    const noStorage = { ...ctx(provider) } as { storage?: unknown };
    delete noStorage.storage;
    await handleSend(noStorage as WorkContext, r.body.data.id);
    const st = (await db.execute(sql`SELECT status, error_code AS "code" FROM message WHERE id = ${r.body.data.id}`)) as unknown as Array<{ status: string; code: string }>;
    expect(st[0]!.status).toBe('failed');
    expect(st[0]!.code).toBe('media_storage_unavailable');
    expect(provider.sent).toHaveLength(0);
  });
});

describe('mapping to a Baileys message', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const make = (contentType: string, body = '', filename: string | null = 'f.bin') =>
    toBaileysContent({ kind: 'freeform', body, media: { bytes, contentType, filename } });

  it('sends text as text, images/video/audio natively, and the rest as a named document', () => {
    expect(toBaileysContent({ kind: 'freeform', body: 'hi' })).toEqual({ text: 'hi' });
    expect(make('image/png', 'cap')).toMatchObject({ caption: 'cap' });
    expect(make('image/png')).not.toHaveProperty('caption');             // empty caption omitted
    expect(make('video/mp4')).toMatchObject({ mimetype: 'video/mp4' });
    expect(make('audio/mpeg')).toMatchObject({ mimetype: 'audio/mpeg' });
    expect(make('application/pdf', 'x', 'CV.pdf')).toMatchObject({
      mimetype: 'application/pdf', fileName: 'CV.pdf', caption: 'x'
    });
    expect(make('application/zip', '', null)).toMatchObject({ fileName: 'file' });
  });

  it('keeps an Office file\'s real type, and sends a HEIC photo as a file so it arrives', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(make(docx, '', 'CV.docx')).toMatchObject({ mimetype: docx, fileName: 'CV.docx' });
    const heic = make('image/heic', '', 'IMG.heic');
    expect(heic).toHaveProperty('document');
    expect(heic).not.toHaveProperty('image');
  });
});
