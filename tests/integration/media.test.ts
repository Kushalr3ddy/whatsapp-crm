import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey, storeMedia, storeInboundMessage } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * Media, end to end: an attachment arriving, being stored, and being served.
 *
 * The emphasis is on **serving**, because that is where the exploit lives (D-11). Storing a
 * hostile file is harmless; handing it back with a content type that makes a browser run it is
 * stored XSS against whoever opens the thread, and the attacker only has to send a message.
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

/** A real PDF header followed by binary that is not valid UTF-8. */
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let orgA: string;
let orgB: string;
let keyA: string;
let senderA: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 6 });
  media = tempStorage();
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole,
    storage: media.storage
  });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  const orgs = await db.execute(sql`
    INSERT INTO org(name,slug) VALUES ('a','media-a'), ('b','media-b') RETURNING id, slug`);
  const rows = orgs as unknown as Array<{ id: string; slug: string }>;
  orgA = rows.find((o) => o.slug === 'media-a')!.id;
  orgB = rows.find((o) => o.slug === 'media-b')!.id;

  const senders = await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, status)
    VALUES (${orgA}, 'baileys', 'A', 'active') RETURNING id`);
  senderA = (senders as unknown as Array<{ id: string }>)[0]!.id;

  keyA = (await issueApiKey(db, {
    orgId: orgA, name: 'media', scopes: ['conversations:read', 'messages:send']
  })).secret;
});

/** Stores an inbound message with an attachment, the way the gateway does. */
async function inboundWithFile(
  orgId: string, senderIdentityId: string, bytes: Uint8Array, filename: string | null
): Promise<{ mediaId: string; messageId: string; conversationId: string }> {
  const stored = await storeInboundMessage(db, kms, {
    orgId, senderIdentityId,
    providerMessageId: `wamid-${randomUUID()}`,
    fromPhoneE164: '+919876543210',
    fromProviderAddress: '919876543210@s.whatsapp.net',
    body: '', contentType: 'document', receivedAt: new Date()
  });
  const result = await storeMedia(db, media.storage, {
    orgId, messageId: stored.messageId!, bytes, filename
  });
  return {
    mediaId: result.mediaId, messageId: stored.messageId!,
    conversationId: stored.conversationId
  };
}

const auth = () => ['Authorization', `Bearer ${keyA}`] as const;

describe('storing an attachment', () => {
  it('types the file from its bytes, not from what it is called', async () => {
    // The whole game. The name says PDF, the bytes say HTML, and a browser handed
    // `text/html` from our own origin would run the script inside it.
    const html = new TextEncoder().encode('<html><script>alert(document.cookie)</script></html>');
    const { mediaId } = await inboundWithFile(orgA, senderA, html, 'totally-a-cv.pdf');

    const rows = await db.execute(sql`
      SELECT content_type AS "contentType", filename FROM media_asset WHERE id = ${mediaId}`);
    const row = (rows as unknown as Array<{ contentType: string; filename: string }>)[0]!;
    expect(row.contentType).toBe('application/octet-stream');
    // The name is kept — it is what the file gets saved as — it simply decides nothing.
    expect(row.filename).toBe('totally-a-cv.pdf');
  });

  it('stores the bytes unchanged, including the ones that are not text', async () => {
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const rows = await db.execute(sql`
      SELECT storage_key AS "key", size_bytes AS "size", content_type AS "contentType"
      FROM media_asset WHERE id = ${mediaId}`);
    const row = (rows as unknown as Array<{ key: string; size: number; contentType: string }>)[0]!;

    expect(row.contentType).toBe('application/pdf');
    expect(row.size).toBe(PDF_BYTES.byteLength);
    expect(Array.from(await media.storage.get(row.key))).toEqual(Array.from(PDF_BYTES));
  });

  it('builds a key that cannot be guessed and is scoped to the org', async () => {
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'Priya CV.pdf');
    const rows = await db.execute(sql`
      SELECT storage_key AS "key" FROM media_asset WHERE id = ${mediaId}`);
    const key = (rows as unknown as Array<{ key: string }>)[0]!.key;

    expect(key).toBe(`org/${orgA}/media/${mediaId}.pdf`);
    // Never the sender's filename: a name is guessable and a key must not be, because the
    // filesystem is where row-level security stops (D-11).
    expect(key).not.toContain('Priya');
  });

  it('stores an identical file once and points both messages at it', async () => {
    const first = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const second = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv-again.pdf');

    expect(second.mediaId).toBe(first.mediaId);
    const count = await db.execute(sql`
      SELECT count(*)::int AS n FROM media_asset WHERE org_id = ${orgA}`);
    expect((count as unknown as Array<{ n: number }>)[0]!.n).toBe(1);

    // Both messages resolve to the one asset.
    const linked = await db.execute(sql`
      SELECT count(*)::int AS n FROM message WHERE media_id = ${first.mediaId}`);
    expect((linked as unknown as Array<{ n: number }>)[0]!.n).toBe(2);
  });

  it('does not deduplicate across tenants', async () => {
    // Same bytes, different org. Sharing the row would leak one tenant's file into another's
    // erasure path and storage accounting.
    const senders = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgB}, 'baileys', 'B', 'active') RETURNING id`);
    const senderB = (senders as unknown as Array<{ id: string }>)[0]!.id;

    const a = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const b = await inboundWithFile(orgB, senderB, PDF_BYTES, 'cv.pdf');
    expect(b.mediaId).not.toBe(a.mediaId);
  });
});

describe('serving an attachment', () => {
  it('returns the exact bytes to a caller entitled to them', async () => {
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');

    const r = await request(app).get(`/api/v1/media/${mediaId}`).set(...auth())
      .buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => { cb(null, Buffer.concat(chunks)); });
      });

    expect(r.status).toBe(200);
    expect(Array.from(r.body as Buffer)).toEqual(Array.from(PDF_BYTES));
  });

  it('always serves as an attachment, never inline, with sniffing disabled', async () => {
    // Three headers, one purpose: a file that slips past type detection still must not run.
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const r = await request(app).get(`/api/v1/media/${mediaId}`).set(...auth());

    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.headers['content-disposition']).not.toContain('inline');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-type']).toBe('application/pdf');
    // Personal data: no shared cache may keep a copy, and neither may the browser's disk.
    expect(r.headers['cache-control']).toBe('private, no-store');
  });

  it('serves an unrecognised file as a download, whatever it claims to be', async () => {
    const html = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    const { mediaId } = await inboundWithFile(orgA, senderA, html, 'picture.svg');
    const r = await request(app).get(`/api/v1/media/${mediaId}`).set(...auth());

    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(r.headers['content-disposition']).toContain('attachment');
  });

  it('carries a non-Latin filename without breaking the header', async () => {
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'प्रिया-सीवी.pdf');
    const r = await request(app).get(`/api/v1/media/${mediaId}`).set(...auth());

    // Both forms: an ASCII fallback every client understands, and the encoded real name.
    expect(r.headers['content-disposition']).toMatch(/filename="[^"]*"/);
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''");
  });

  it('refuses a caller with no credential', async () => {
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const r = await request(app).get(`/api/v1/media/${mediaId}`);
    expect(r.status).toBe(401);
  });

  it('answers 404 for another tenant’s attachment, not 403', async () => {
    // Saying "forbidden" would confirm the file exists, which is itself the leak.
    const senders = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgB}, 'baileys', 'B', 'active') RETURNING id`);
    const senderB = (senders as unknown as Array<{ id: string }>)[0]!.id;
    const theirs = await inboundWithFile(orgB, senderB, PDF_BYTES, 'their-cv.pdf');

    const r = await request(app).get(`/api/v1/media/${theirs.mediaId}`).set(...auth());
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });

  it('says so plainly when the row exists but the bytes do not', async () => {
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const rows = await db.execute(sql`
      SELECT storage_key AS "key" FROM media_asset WHERE id = ${mediaId}`);
    await media.storage.delete((rows as unknown as Array<{ key: string }>)[0]!.key);

    const r = await request(app).get(`/api/v1/media/${mediaId}`).set(...auth());
    // Not a 404: the caller is entitled to it and it is our inconsistency, not their mistake.
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('MEDIA_UNREADABLE');
  });
});

describe('the thread shows what is attached', () => {
  it('gives each message its attachment and a path to fetch it', async () => {
    const { mediaId, conversationId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');

    const r = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`).set(...auth());
    expect(r.status).toBe(200);

    const message = (r.body.data as Array<{ media: { id: string; url: string; contentType: string; filename: string } | null }>)[0]!;
    expect(message.media).not.toBeNull();
    expect(message.media!.id).toBe(mediaId);
    expect(message.media!.url).toBe(`/api/v1/media/${mediaId}`);
    expect(message.media!.contentType).toBe('application/pdf');
    expect(message.media!.filename).toBe('cv.pdf');
  });

  it('marks a media message whose file was never fetched', async () => {
    // The gateway keeps the message when a download fails, so the inbox must be able to say
    // "there was a file and we do not have it" rather than showing an empty bubble.
    await storeInboundMessage(db, kms, {
      orgId: orgA, senderIdentityId: senderA,
      providerMessageId: `wamid-${randomUUID()}`,
      fromPhoneE164: '+919876543210',
      fromProviderAddress: '919876543210@s.whatsapp.net',
      body: '', contentType: 'image', receivedAt: new Date()
    });

    const list = await request(app).get('/api/v1/conversations').set(...auth());
    const conversationId = (list.body.data as Array<{ id: string }>)[0]!.id;
    const r = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`).set(...auth());

    const message = (r.body.data as Array<{ media: unknown; mediaUnavailable: boolean }>)[0]!;
    expect(message.media).toBeNull();
    expect(message.mediaUnavailable).toBe(true);
  });
});

describe('the access trail (D-13)', () => {
  it('records who downloaded an attachment', async () => {
    const { mediaId, conversationId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    await request(app).get(`/api/v1/media/${mediaId}`).set(...auth());

    const rows = await db.execute(sql`
      SELECT actor_type AS "actorType", target_id AS "targetId", after
      FROM audit_log WHERE org_id = ${orgA} AND action = 'media.downloaded'`);
    const entries = rows as unknown as Array<{
      actorType: string; targetId: string; after: { conversationId: string };
    }>;

    expect(entries).toHaveLength(1);
    expect(entries[0]!.targetId).toBe(mediaId);
    expect(entries[0]!.actorType).toBe('api');
    // The conversation is what makes the row answerable: "who read this candidate's file?"
    expect(entries[0]!.after.conversationId).toBe(conversationId);
  });

  it('records the access even when no bytes are ever transferred', async () => {
    // The ordering guarantee, tested where it can be made deterministic: the row is written
    // before the transfer is attempted, so a download that fails or that the client abandons
    // halfway still counts. Waiting for a completed transfer would lose exactly the accesses
    // worth knowing about.
    const { mediaId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');
    const keys = await db.execute(sql`
      SELECT storage_key AS "key" FROM media_asset WHERE id = ${mediaId}`);
    await media.storage.delete((keys as unknown as Array<{ key: string }>)[0]!.key);

    const r = await request(app).get(`/api/v1/media/${mediaId}`).set(...auth());
    expect(r.status).toBe(500);

    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM audit_log
      WHERE org_id = ${orgA} AND action = 'media.downloaded' AND target_id = ${mediaId}`);
    expect((rows as unknown as Array<{ n: number }>)[0]!.n).toBe(1);
  });

  it('records opening a thread, but not listing the inbox', async () => {
    const { conversationId } = await inboundWithFile(orgA, senderA, PDF_BYTES, 'cv.pdf');

    await request(app).get('/api/v1/conversations').set(...auth());
    await request(app).get(`/api/v1/conversations/${conversationId}/messages`).set(...auth());

    const rows = await db.execute(sql`
      SELECT action, target_id AS "targetId" FROM audit_log
      WHERE org_id = ${orgA} AND action LIKE 'conversation%'`);
    const entries = rows as unknown as Array<{ action: string; targetId: string }>;

    // Exactly one: the thread open. A paginated inbox load is not a meaningful access event,
    // and recording one would bury the events that are (D-13).
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('conversation.read');
    expect(entries[0]!.targetId).toBe(conversationId);
  });

  it('writes no trail for a thread the caller cannot see', async () => {
    const senders = await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, status)
      VALUES (${orgB}, 'baileys', 'B', 'active') RETURNING id`);
    const senderB = (senders as unknown as Array<{ id: string }>)[0]!.id;
    const theirs = await inboundWithFile(orgB, senderB, PDF_BYTES, 'cv.pdf');

    await request(app)
      .get(`/api/v1/conversations/${theirs.conversationId}/messages`).set(...auth());

    // An audit row here would put one org's conversation id into another org's trail, which
    // is a leak in the place least able to afford one.
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM audit_log`);
    expect((rows as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });
});
