import { Router, type Request, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { resolveMedia, writeAudit, AUDIT } from '@crm/core';
import { ObjectNotFoundError, type StorageDriver } from '@crm/storage';
import { auditActor, requireScope } from '../auth.js';
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
 *  - `Content-Disposition: attachment` on every response, always. Nothing is ever rendered
 *    inline, including images — the cost is a download instead of a preview, and the benefit is
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
