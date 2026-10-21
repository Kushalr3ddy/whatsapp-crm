import { Router, type Request, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { resolveMedia, resolveCampaignPicture, writeAudit, AUDIT } from '@crm/core';
import { ObjectNotFoundError, type StorageDriver } from '@crm/storage';
import { auditActor, requireScope } from '../auth.js';
import { makeThumbnail, THUMBNAIL_TYPES } from '../thumbnail.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';

/**
 * Serving stored attachments.
 *
 * **Storing a file is harmless; serving it is where the exploit lives** (docs/21-deferred.md,
 * D-11). Everything unusual about this router is that sentence:
 *
 *  - The content type is the one detected from **magic bytes** when the file was stored, never
 *    the sender's filename or declared type. An HTML attachment served as `text/html` from our
 *    own origin is stored XSS against a logged-in session, and the attacker only has to send a
 *    message.
 *  - `Content-Disposition: attachment` on every response, always. The original is never rendered
 *    inline, including images (the `/thumb` route below shows a re-encoded copy instead) — the cost is a download instead of a preview, and the benefit is
 *    that a file which slips past type detection still cannot execute.
 *  - `X-Content-Type-Options: nosniff`, so a browser cannot decide for itself that the bytes
 *    look like something more interesting than what we said.
 *  - Authorisation is resolved through the database, file → message → conversation → org, on
 *    every request. Row-level security protects the row and stops at the filesystem, so this
 *    walk is the only thing standing between a storage key and the bytes.
 *
 * There is deliberately no signed URL and no public path. A URL that grants access on its own
 * would route around the check above, which is the only one there is.
 */
export function mediaRouter(storage: StorageDriver): Router {
  const router = Router();

  /** Streams one attachment to a caller that is entitled to it. */
  router.get('/:id', requireUuidParam('id'), requireScope('conversations:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;

    // Resolve and record in one tenant transaction, then leave it before streaming. Holding a
    // transaction open across the transfer would pin a pooled connection for the length of a
    // 100 MB download, which is why `req.tenant` hands out a runner rather than a handle.
    const media = await req.tenant!(async (tx) => {
      const found = await resolveMedia(tx, orgId, String(req.params.id));
      if (found === null) return null;

      // Written before a byte moves, and inside the same transaction as the lookup that
      // authorised it. Recording it after a successful transfer would lose every download the
      // client aborted halfway — which is exactly the download worth knowing about (D-13).
      await writeAudit(tx, {
        orgId,
        actor: auditActor(req),
        action: AUDIT.mediaDownloaded,
        targetType: 'media_asset',
        targetId: found.mediaId,
        // No bytes, no filename, no key: an audit row must never become a second copy of the
        // thing it describes. The conversation is what makes the row answerable.
        after: { conversationId: found.conversationId, contentType: found.contentType },
        ip: req.ip ?? null,
        requestId: String(req.id)
      });
      return found;
    });

    if (media === null) {
      // 404 and not 403, for the same reason as everywhere else: distinguishing "not yours"
      // from "does not exist" confirms another tenant's file exists.
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such attachment.'));
      return;
    }

    let stream;
    try {
      stream = await storage.getStream(media.storageKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        // The row exists and the bytes do not. That is our inconsistency, not a bad request,
        // and saying so plainly beats a 404 that would send someone hunting for a deleted row.
        req.log.error({ mediaId: media.mediaId, key: media.storageKey },
          'media row has no bytes behind it');
        res.status(500).json(problem(req, 500, 'MEDIA_UNREADABLE',
          'The attachment is recorded but its contents could not be read.'));
        return;
      }
      throw error;
    }

    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Content-Length', String(media.sizeBytes));
    res.setHeader('Content-Disposition', disposition(media.filename ?? media.mediaId));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Attachments are personal data. A shared cache must never hold one, and a browser
    // keeping a copy on disk outlives the session that was allowed to see it.
    res.setHeader('Cache-Control', 'private, no-store');

    try {
      await pipeline(stream, res);
    } catch (error) {
      // The headers are already sent, so there is no status left to change. A client that
      // hangs up mid-download is ordinary and not worth an error line.
      req.log.warn({ mediaId: media.mediaId, err: String(error) }, 'attachment transfer ended early');
      res.destroy();
    }
  });

  /**
   * A small preview of an image, for the thread.
   *
   * The one place an image is shown inline, and it is safe because it is **not the sender's file**:
   * the original is decoded and re-encoded to a fixed WebP (see `makeThumbnail`), so what is served is
   * bytes we wrote. The original still only ever downloads, through the route above. Same
   * file-to-org check; not audited per image, since opening the thread is already audited.
   */
  router.get('/:id/thumb', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      // A file in a chat, or one of the organisation's own campaign pictures (which belong to no message).
      const media = await req.tenant!(async (tx) => (await resolveMedia(tx, orgId, String(req.params.id))) ?? resolveCampaignPicture(tx, orgId, String(req.params.id)));
      if (media === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such attachment.'));
        return;
      }
      if (!THUMBNAIL_TYPES.has(media.contentType)) {
        res.status(415).json(problem(req, 415, 'NO_PREVIEW', 'This kind of file has no preview.'));
        return;
      }
      try {
        const bytes = await storage.get(media.storageKey);
        const thumb = await makeThumbnail(bytes);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', String(thumb.byteLength));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // A preview of a file that never changes, but still personal data: the browser may keep it for
        // the session's sake, a shared cache never.
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.end(thumb);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          res.status(500).json(problem(req, 500, 'MEDIA_UNREADABLE',
            'The attachment is recorded but its contents could not be read.'));
          return;
        }
        // Not decodable, or too many pixels: no preview, the download still works.
        req.log.warn({ mediaId: media.mediaId, err: String(error) }, 'could not make a preview');
        res.status(415).json(problem(req, 415, 'NO_PREVIEW', 'A preview could not be made for this file.'));
      }
    });

  return router;
}

/**
 * Builds a `Content-Disposition` header that is always an attachment.
 *
 * Two forms of the filename, because they answer different clients: a plain ASCII one that
 * every browser understands, and the RFC 5987 encoded one that survives a name written in
 * Devanagari or Arabic. The plain form is stripped to ASCII rather than dropped, so a client
 * that ignores `filename*` still saves something recognisable.
 */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const safe = ascii === '' ? 'attachment' : ascii;
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
