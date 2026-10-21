import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { detectMediaType } from '@crm/shared';
import { mediaKey, type StorageDriver } from '@crm/storage';
import { gifToMp4 } from './media-convert.js';
import { storeOutboundMedia, type ResolvedMedia } from './media.js';

/** The most a campaign picture or GIF may weigh. Bigger files send slower and look more like spam; WhatsApp recompresses them anyway. */
export const CAMPAIGN_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

/** The picture types a campaign accepts (decided from the file's bytes, never its name). MP4 and other video are not accepted yet. */
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Why a picture was refused, in words the form can show as they are. */
export class CampaignPictureError extends Error {
  /** Builds the error with a short code and the words to show. */
  constructor(readonly code: 'unsupported' | 'too_large' | 'empty' | 'not_found', message: string) {
    super(message);
    this.name = 'CampaignPictureError';
  }
}

/** The executor shape a request's tenant transaction has. */
type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** A stored campaign picture as the form and the campaign page show it. */
export interface CampaignPicture {
  readonly id: string;
  readonly filename: string | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly gif: boolean;
  readonly createdAt: string;
  /** How many campaigns use it. */
  readonly uses: number;
}

/**
 * Checks and stores one picture or GIF for campaigns. The type comes from the bytes: MP4 and any other video are refused for now,
 * so are documents, and anything over 5 MB. A GIF is also converted into the looping clip it is sent as; if that cannot be done the
 * whole upload is refused, so a campaign never holds a GIF that cannot be sent.
 */
export async function storeCampaignPicture(
  tx: Executor, storage: StorageDriver, upload: { orgId: string; bytes: Uint8Array; filename: string | null }
): Promise<CampaignPicture> {
  if (upload.bytes.byteLength === 0) throw new CampaignPictureError('empty', 'That file is empty.');
  if (upload.bytes.byteLength > CAMPAIGN_PICTURE_MAX_BYTES) {
    throw new CampaignPictureError('too_large', `That file is ${(upload.bytes.byteLength / 1048576).toFixed(1)} MB. The most is 5 MB. Make it smaller and try again.`);
  }
  const type = detectMediaType(upload.bytes);
  if (type.contentType === 'video/mp4' || type.contentType.startsWith('video/')) {
    throw new CampaignPictureError('unsupported', 'MP4 videos are not supported yet. Use a picture or a GIF.');
  }
  if (!ALLOWED.has(type.contentType)) {
    throw new CampaignPictureError('unsupported', 'That file type is not supported. Use a JPG, PNG, WebP or GIF.');
  }
  const gif = type.contentType === 'image/gif';
  // Convert first: a GIF that cannot be turned into a clip is refused before anything is stored.
  const clip = gif ? await gifToMp4(upload.bytes) : null;

  const stored = await storeOutboundMedia(tx, storage, { orgId: upload.orgId, bytes: upload.bytes, filename: upload.filename });
  await tx.execute(sql`UPDATE media_asset SET campaign_picture = true WHERE id = ${stored.mediaId} AND org_id = ${upload.orgId}`);

  if (clip !== null) {
    const have = await tx.execute(sql`SELECT id FROM media_asset WHERE source_asset_id = ${stored.mediaId} AND org_id = ${upload.orgId} LIMIT 1`);
    if ((have as unknown as unknown[]).length === 0) {
      const clipId = randomUUID();
      const key = mediaKey(upload.orgId, clipId, 'mp4');
      await storage.put(key, clip, { contentType: 'video/mp4' });
      await tx.execute(sql`
        INSERT INTO media_asset (id, org_id, storage_key, storage_driver, content_type, size_bytes, sha256, filename, gif_playback, source_asset_id)
        VALUES (${clipId}, ${upload.orgId}, ${key}, ${storage.name}, 'video/mp4', ${clip.byteLength},
                ${createHash('sha256').update(clip).digest('hex')}, ${upload.filename}, true, ${stored.mediaId})`);
    }
  }
  const row = await readPicture(tx, upload.orgId, stored.mediaId);
  return row!;
}

/** One campaign picture with its use count, or null when it is not one of this organisation's pictures. */
async function readPicture(tx: Executor, orgId: string, id: string): Promise<CampaignPicture | null> {
  const rows = await tx.execute(sql`
    SELECT ma.id, ma.filename, ma.content_type AS "contentType", ma.size_bytes AS "sizeBytes",
           (ma.content_type = 'image/gif') AS gif, ma.created_at AS "createdAt",
           (SELECT count(*)::int FROM campaign c WHERE c.media_asset_id = ma.id) AS uses
    FROM media_asset ma WHERE ma.id = ${id} AND ma.org_id = ${orgId} AND ma.campaign_picture`);
  return (rows as unknown as CampaignPicture[])[0] ?? null;
}

/** The organisation's campaign pictures, newest first, for "use one I uploaded before". */
export async function listCampaignPictures(tx: Executor, orgId: string, limit = 24): Promise<CampaignPicture[]> {
  const rows = await tx.execute(sql`
    SELECT ma.id, ma.filename, ma.content_type AS "contentType", ma.size_bytes AS "sizeBytes",
           (ma.content_type = 'image/gif') AS gif, ma.created_at AS "createdAt",
           (SELECT count(*)::int FROM campaign c WHERE c.media_asset_id = ma.id) AS uses
    FROM media_asset ma WHERE ma.org_id = ${orgId} AND ma.campaign_picture
    ORDER BY ma.created_at DESC LIMIT ${limit}`);
  return rows as unknown as CampaignPicture[];
}

/** One campaign picture, or null. Used to check a picture really belongs to the organisation before a campaign points at it. */
export async function getCampaignPicture(tx: Executor, orgId: string, id: string): Promise<CampaignPicture | null> {
  return readPicture(tx, orgId, id);
}

/** Pictures whose file name contains the words, for the AI assistant ("the Diwali picture"). */
export async function findCampaignPictures(tx: Executor, orgId: string, words: string): Promise<CampaignPicture[]> {
  const like = `%${words.trim().replace(/[%_]/g, ' ')}%`;
  const rows = await tx.execute(sql`
    SELECT ma.id, ma.filename, ma.content_type AS "contentType", ma.size_bytes AS "sizeBytes",
           (ma.content_type = 'image/gif') AS gif, ma.created_at AS "createdAt",
           (SELECT count(*)::int FROM campaign c WHERE c.media_asset_id = ma.id) AS uses
    FROM media_asset ma WHERE ma.org_id = ${orgId} AND ma.campaign_picture AND ma.filename ILIKE ${like}
    ORDER BY ma.created_at DESC LIMIT 10`);
  return rows as unknown as CampaignPicture[];
}

/** What a campaign's messages carry: the file to attach and the message type. A GIF's file is its converted clip. */
export interface SendAsset { readonly mediaId: string; readonly contentType: 'image' | 'video' }

/** Works out which stored file a campaign message should carry. Returns null when the picture is gone, so the caller can fail clearly. */
export async function resolveSendAsset(tx: Executor, orgId: string, pictureId: string): Promise<SendAsset | null> {
  const rows = await tx.execute(sql`
    SELECT ma.id, ma.content_type AS "contentType",
           (SELECT v.id FROM media_asset v WHERE v.source_asset_id = ma.id AND v.org_id = ${orgId} AND v.gif_playback LIMIT 1) AS "clipId"
    FROM media_asset ma WHERE ma.id = ${pictureId} AND ma.org_id = ${orgId}`);
  const row = (rows as unknown as Array<{ id: string; contentType: string; clipId: string | null }>)[0];
  if (row === undefined) return null;
  if (row.contentType === 'image/gif') return row.clipId === null ? null : { mediaId: row.clipId, contentType: 'video' };
  return { mediaId: row.id, contentType: 'image' };
}

/** Authorises a preview of a campaign picture that belongs to no message: it is the organisation's own campaign picture. */
export async function resolveCampaignPicture(tx: Executor, orgId: string, id: string): Promise<ResolvedMedia | null> {
  const rows = await tx.execute(sql`
    SELECT id, storage_key AS "storageKey", content_type AS "contentType", size_bytes AS "sizeBytes", filename
    FROM media_asset WHERE id = ${id} AND org_id = ${orgId} AND campaign_picture`);
  const row = (rows as unknown as Array<Omit<ResolvedMedia, 'mediaId' | 'conversationId'> & { id: string }>)[0];
  if (row === undefined) return null;
  return { mediaId: row.id, storageKey: row.storageKey, contentType: row.contentType, sizeBytes: row.sizeBytes, filename: row.filename, conversationId: '' };
}
