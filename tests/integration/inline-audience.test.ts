import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole, type Database
} from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { issueApiKey } from '@crm/core';
import { createLogger, type Config } from '@crm/shared';
import { buildApp } from '../../apps/api/src/app.js';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * An audience built inline while creating a campaign (the old standalone Segments screen, folded
 * in). It is a segment under the hood so it freezes at launch like any other, but a one-off one is
 * created with `saved: false` and must not clutter the list of reusable audiences.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({
  keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
});
const config = {
  PRESET: 'lean', PROCESS_ROLE: 'all', LOG_LEVEL: 'silent', NODE_ENV: 'test',
  API_KEY: randomBytes(32).toString('hex'), DEFAULT_COUNTRY: 'IN'
} as unknown as Config;
const logger = createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' });

let db: Database;
let app: ReturnType<typeof buildApp>;
let media: TempStorage;
let key: string;
let orgId: string;
let senderId: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 4 });
  media = tempStorage('crm-inline-aud');
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  app = buildApp({ config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: media.storage });
});
afterAll(async () => { await db.$client.end(); media.cleanup(); });

beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  orgId = (await db.execute(sql`INSERT INTO org(name,slug) VALUES ('a','aud') RETURNING id`) as
    unknown as Array<{ id: string }>)[0]!.id;
  senderId = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${orgId}, 'fake', 's', '+919000000001', 'active') RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  key = (await issueApiKey(db, {
    orgId, name: 'k', scopes: ['contacts:read', 'contacts:write', 'messages:send', 'conversations:read']
  })).secret;
});

const auth = () => ['Authorization', `Bearer ${key}`] as const;

describe('a one-off inline audience', () => {
  it('is hidden from the saved list but can still be targeted by a campaign', async () => {
    const kept = await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'Kept', definition: { replied: 'never' } });
    const oneOff = await request(app).post('/api/v1/segments').set(...auth())
      .send({ name: 'Campaign A · audience abc', definition: { replied: 'never' }, saved: false });
    expect(kept.status).toBe(201);
    expect(oneOff.status).toBe(201);

    const list = await request(app).get('/api/v1/segments').set(...auth());
    expect(list.body.data.map((s: { name: string }) => s.name)).toEqual(['Kept']);

    // The campaign can aim at the hidden one, exactly like a saved one.
    const campaign = await request(app).post('/api/v1/campaigns').set(...auth()).send({
      name: 'c', body: 'hello', senderIdentityId: senderId, fromSegmentId: oneOff.body.data.id
    });
    expect(campaign.status).toBe(201);
  });

  it('defaults to saved, so existing callers are unaffected', async () => {
    await request(app).post('/api/v1/segments').set(...auth()).send({ name: 'Plain', definition: { replied: 'ever' } });
    const list = await request(app).get('/api/v1/segments').set(...auth());
    expect(list.body.data).toHaveLength(1);
  });
});
