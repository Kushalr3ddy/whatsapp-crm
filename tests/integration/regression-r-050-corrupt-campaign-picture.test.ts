import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { CampaignPictureError, createOrgWithAdmin, storeCampaignPicture } from '@crm/core';
import { tempStorage, type TempStorage } from '../fixtures/storage.js';

/**
 * R-050 (2026-11-10, area: campaigns, found by: live run on four phones): a PNG cut to 100 bytes was accepted as a campaign picture
 * (the type was judged from the first bytes only) and would have failed, or sent a broken picture, at send time. A picture must open.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
let db: Database;
let media: TempStorage;
let orgId: string;
beforeAll(() => { db = createDatabase(url, { max: 3 }); media = tempStorage('crm-r050'); });
afterAll(async () => { await db.$client.end(); media.cleanup(); });
beforeEach(async () => {
  await db.execute(sql`DELETE FROM org`);
  await db.execute(sql`DELETE FROM app_user`);
  orgId = (await createOrgWithAdmin(db, new BuiltinPasswordHasher(), { orgName: 'p', slug: 'pic-org', email: 'p@pic.test', password: 'x', displayName: 'P' })).orgId;
});

const raw = { width: 200, height: 200, channels: 3 as const, background: { r: 200, g: 30, b: 30 } };
const png = (): Promise<Buffer> => sharp({ create: raw }).png().toBuffer();
const jpg = (): Promise<Buffer> => sharp({ create: raw }).jpeg().toBuffer();
const store = (bytes: Uint8Array) => storeCampaignPicture(db, media.storage, { orgId, bytes, filename: 'x' });

describe('[R-050] uploading a campaign picture', () => {
  it('[R-050] a whole PNG and a whole JPEG are accepted', async () => {
    expect((await store(await png())).contentType).toBe('image/png');
    expect((await store(await jpg())).contentType).toBe('image/jpeg');
  });

  it('[R-050] a PNG cut to 100 bytes is refused, and so is a JPEG cut in half', async () => {
    const p = await png(); const j = await jpg();
    await expect(store(p.subarray(0, 100))).rejects.toBeInstanceOf(CampaignPictureError);
    await expect(store(j.subarray(0, Math.floor(j.length / 2)))).rejects.toBeInstanceOf(CampaignPictureError);
  });

  it('[R-050] a refused picture leaves nothing behind', async () => {
    const p = await png();
    await store(p.subarray(0, 100)).catch(() => undefined);
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM media_asset WHERE org_id = ${orgId}`)) as unknown as Array<{ n: number }>;
    expect(n[0]!.n).toBe(0);
  });

  it('[R-050] random bytes that start like a PNG are refused', async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)]);
    await expect(store(fake)).rejects.toBeInstanceOf(CampaignPictureError);
  });
});
