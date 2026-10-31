import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  campaignProgress, previewAudience, POLICY_GATES, campaignEta, hasVariation,
  createCampaignDraft, startCampaign as startCampaignRun, setCampaignStatus, editCampaign, type ActionContext,
  storeCampaignPicture, listCampaignPictures, CampaignPictureError, GifConversionError
} from '@crm/core';
import type { StorageDriver } from '@crm/storage';
import { auditActor, requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';

/** Body for creating a campaign. The audience is always stated — there is no "everyone". */
const createCampaign = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(1).max(4096),
  senderIdentityId: z.string().uuid(),
  fromImportRunId: z.string().uuid().optional(),
  explicitContactIds: z.array(z.string().uuid()).min(1).max(50_000).optional(),
  fromTagId: z.string().uuid().optional(),
  fromSegmentId: z.string().uuid().optional(),
  aiTemplateId: z.string().uuid().optional(),
  /** One stored campaign picture or GIF sent with every message, the message being its caption. */
  mediaAssetId: z.string().uuid().optional(),
  /** A new chat gets the text alone; the picture or link follows when they reply. On unless said otherwise (F6 AC-7.3). */
  mediaAfterReply: z.boolean().optional(),
  /** Why these people are being messaged, in a sentence. Said in the closing message if one of them opts out (F6 AC-6.2). */
  purpose: z.string().trim().min(1).max(300).optional()
}).refine((v) => [v.fromImportRunId, v.explicitContactIds, v.fromTagId, v.fromSegmentId]
  .filter((x) => x !== undefined).length === 1, {
  message: 'state the audience exactly once: fromImportRunId, explicitContactIds, fromTagId, or fromSegmentId'
});

/**
 * Optional body for starting: an admin lifting recipient-experience gates for this campaign. The
 * list may only name the three policy gates — the number-protecting ones cannot be named at all.
 */
const startCampaign = z.object({
  overrideGates: z.array(z.enum(POLICY_GATES)).max(POLICY_GATES.length).optional(),
  reason: z.string().trim().min(10).max(500).optional()
}).refine((v) => (v.overrideGates ?? []).length === 0 || v.reason !== undefined, {
  message: 'a reason of at least 10 characters is required to override a gate', path: ['reason']
});

/** Body for editing a draft or paused campaign: a new name, new wording, or both. */
const editBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  body: z.string().min(1).max(4096).optional(),
  mediaAfterReply: z.boolean().optional()
}).refine((v) => v.name !== undefined || v.body !== undefined || v.mediaAfterReply !== undefined, 'give a name, a body or mediaAfterReply');

/**
 * Warnings about a campaign that never stop it from launching (F6 AC-7.2): text with no `{a|b}` variation and no AI writing it
 * sends the same words to everyone, which is one of the clearest signs of a bulk sender.
 */
function campaignWarnings(body: string, aiTemplateId: string | null): Array<{ code: 'no_variation'; message: string }> {
  return aiTemplateId === null && !hasVariation(body)
    ? [{ code: 'no_variation', message: 'Every recipient gets exactly the same text. Add variants like {Hi|Hello|Hey}, or let the AI write it, to look less like a bulk send.' }]
    : [];
}

/**
 * Query for listing a campaign's recipients. `status` narrows to one terminal/pending state, `q`
 * is a case-insensitive substring on the contact's name or an identity, and `cursor` is the last
 * recipient id seen — keyset paging on the row id, which is a stable total order without needing a
 * timestamp column on `campaign_recipient`.
 */
const listRecipientsQuery = z.object({
  status: z.enum(['pending', 'queued', 'sent', 'failed', 'skipped']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional()
});

/**
 * Campaigns — a bulk send, and the controls for stopping one.
 *
 * **Creating a campaign sends nothing.** It is a draft until started, starting only freezes the
 * audience, and the gateway converts recipients into messages a small batch at a time. Nothing in this
 * router can make a message go out faster (M12).
 */
export function campaignsRouter(storage: StorageDriver): Router {
  const router = Router();

  /**
   * Stores one picture or GIF for campaigns: the raw file as the body. JPG, PNG, WebP or GIF up to 5 MB, decided from the
   * bytes; MP4 and other video are refused for now. A GIF is also turned into the looping clip WhatsApp plays. Sends nothing.
   * (Declared before the `/:id` routes so "media" is not read as a campaign id.)
   */
  router.post('/media', requireScope('messages:send'), async (req: Request, res: Response) => {
    const bytes = req.body as unknown;
    if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
      res.status(415).json(problem(req, 415, 'UNSUPPORTED_MEDIA_TYPE', 'POST the file itself as the request body.'));
      return;
    }
    const orgId = req.crm!.orgId;
    const filename = typeof req.query.filename === 'string' ? req.query.filename : null;
    try {
      const picture = await req.tenant!((tx) => storeCampaignPicture(tx, storage, { orgId, bytes, filename }));
      res.status(201).json({ data: picture });
    } catch (error) {
      if (error instanceof CampaignPictureError) {
        const status = error.code === 'too_large' ? 413 : 415;
        res.status(status).json(problem(req, status, error.code === 'too_large' ? 'FILE_TOO_LARGE' : 'UNSUPPORTED_FILE_TYPE', error.message));
        return;
      }
      if (error instanceof GifConversionError) {
        res.status(error.code === 'no_ffmpeg' ? 501 : 422).json(problem(req, error.code === 'no_ffmpeg' ? 501 : 422, 'GIF_CONVERSION_FAILED', error.message));
        return;
      }
      throw error;
    }
  });

  /** The organisation's campaign pictures, newest first, for "use one I uploaded before". */
  router.get('/media', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    res.json({ data: await req.tenant!((tx) => listCampaignPictures(tx, orgId)) });
  });

  /** Creates a draft. Nothing is sent and no audience is frozen until it is started. */
  router.post('/', requireScope('messages:send'), async (req: Request, res: Response) => {
    const parsed = createCampaign.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const {
      name, body, senderIdentityId, fromImportRunId, explicitContactIds, fromTagId, fromSegmentId, aiTemplateId, mediaAssetId, mediaAfterReply, purpose
    } = parsed.data;

    const created = await req.tenant!((tx) => createCampaignDraft(tx, orgId, actionContext(req), {
      name, body, senderIdentityId, fromImportRunId, explicitContactIds, fromTagId, fromSegmentId, aiTemplateId, mediaAssetId, mediaAfterReply, purpose
    }));

    if ('error' in created) {
      const detail = created.error === 'no_tag' ? 'No such tag.'
        : created.error === 'no_segment' ? 'No such segment.'
        : created.error === 'no_template' ? 'No such AI template.'
        : created.error === 'no_picture' ? 'No such picture. Upload it again.'
        : 'No such sender.';
      res.status(404).json(problem(req, 404, 'NOT_FOUND', detail));
      return;
    }
    res.status(201).json({ data: { id: created.id, status: 'draft', warnings: campaignWarnings(body, aiTemplateId ?? null) } });
  });

  /**
   * Starts a campaign: freezes the audience and lets the gateway begin.
   */
  router.post('/:id/start', requireUuidParam('id'), requireScope('messages:send'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);

      const startBody = startCampaign.safeParse(req.body ?? {});
      if (!startBody.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 
          startBody.error.issues.map((i) => i.message).join('; ')));
        return;
      }
      const overrideGates = [...new Set(startBody.data.overrideGates ?? [])];
      // Lifting a gate is a person's judgement call: an admin, signed in, never an API key.
      if (overrideGates.length > 0 && (req.crm!.kind !== 'session' || req.crm!.role !== 'admin')) {
        res.status(403).json(problem(req, 403, 'FORBIDDEN', 'Only an admin can override a gate.'));
        return;
      }

      const result = await req.tenant!((tx) => startCampaignRun(
        tx, orgId, actionContext(req), id,
        overrideGates.length > 0 ? { gates: overrideGates, reason: startBody.data.reason! } : undefined
      ));

      if ('error' in result) {
        const map = {
          not_found: [404, 'NOT_FOUND', 'No such campaign.'],
          already_running: [409, 'ALREADY_RUNNING', 'This campaign is already running.'],
          finished: [409, 'CAMPAIGN_FINISHED', 'This campaign has finished and cannot restart.']
        } as const;
        const [status, code, detail] = map[result.error];
        res.status(status).json(problem(req, status, code, detail));
        return;
      }
      res.json({ data: { status: 'running', ...result } });
    });

  /** Pauses a running campaign. Instant, because pending recipients are simply not dispatched. */
  router.post('/:id/pause', requireUuidParam('id'), requireScope('messages:send'),
    (req: Request, res: Response) => { void transition(req, res, 'paused'); });

  /**
   * Cancels a campaign permanently.
   *
   * Everything still pending becomes `skipped` with a reason rather than vanishing — the totals
   * have to keep adding up. Messages already queued are left alone: they have been accepted for
   * sending and pulling them back would be a different, racier operation.
   */
  router.post('/:id/cancel', requireUuidParam('id'), requireScope('messages:send'),
    (req: Request, res: Response) => { void transition(req, res, 'cancelled'); });

  /**
   * Changes a campaign's name or wording, while it is a draft or paused. A running campaign must be paused first, so one
   * audience never sees two different messages.
   */
  router.patch('/:id', requireUuidParam('id'), requireScope('messages:send'), async (req: Request, res: Response) => {
    const parsed = editBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; ')));
      return;
    }
    const id = String(req.params.id);
    const outcome = await req.tenant!((tx) => editCampaign(tx, req.crm!.orgId, actionContext(req), id, parsed.data));
    if (outcome === 'not_found') { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.')); return; }
    if (outcome === 'not_editable') {
      res.status(409).json(problem(req, 409, 'NOT_EDITABLE', 'Only a draft or paused campaign can be edited. Pause it first.'));
      return;
    }
    res.json({ data: { id, ...parsed.data } });
  });

  /** The campaign, its progress, and how much longer it has. */
  router.get('/:id', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);

      const data = await req.tenant!(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT c.id, c.name, c.status, c.body, c.sender_identity_id AS "senderIdentityId",
                 c.started_at AS "startedAt", c.completed_at AS "completedAt",
                 c.created_at AS "createdAt", c.gate_overrides AS "gateOverrides",
                 c.gate_override_reason AS "gateOverrideReason", c.pause_reason AS "pauseReason",
                 c.media_asset_id AS "mediaAssetId", c.media_after_reply AS "mediaAfterReply", c.purpose,
                 c.ai_template_id AS "aiTemplateId", ma.filename AS "mediaFilename",
                 ma.content_type AS "mediaContentType", ma.size_bytes AS "mediaSizeBytes"
          FROM campaign c
          LEFT JOIN media_asset ma ON ma.id = c.media_asset_id AND ma.org_id = c.org_id
          WHERE c.id = ${id} AND c.org_id = ${orgId}`);
        const campaign = (rows as unknown as Array<Record<string, unknown>>)[0];
        if (!campaign) return null;

        const progress = await campaignProgress(tx, orgId, id);
        const warnings = campaignWarnings(String(campaign.body), (campaign.aiTemplateId as string | null) ?? null);
        return { ...campaign, progress, warnings };
      });

      if (data === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.'));
        return;
      }
      res.json({ data });
    });

  /**
   * When the campaign finishes, worked out from the gaps stored on its recipients (F6 S3): `finishAt`, how many go now and how many
   * wait for WhatsApp's next reset (`goNow`, `afterReset`, `resetAt`), what the estimate rests on (`basis`: `quota` or `time_only`),
   * and why it moved (`delayedBy`: a reason and seconds each). No randomness: the same campaign gives the same answer.
   */
  router.get('/:id/eta', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);
      const eta = await req.tenant!((tx) => campaignEta(tx, orgId, id, new Date()));
      if (eta === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.'));
        return;
      }
      res.json({
        data: {
          finishAt: eta.finishAt?.toISOString() ?? null, goNow: eta.goNow, afterReset: eta.afterReset,
          resetAt: eta.resetAt?.toISOString() ?? null, basis: eta.basis, delayedBy: eta.delayedBy
        }
      });
    });

  /**
   * A dry run: the audience a draft *would* freeze, without writing anything (F5 AC-1). This is the
   * number an operator needs **before** pressing start, not after.
   * Reachable vs unreachable is split out so a low reachable count (a tag of contacts with no
   * numbers) is visible up front rather than a surprise in the results.
   */
  router.get('/:id/preview', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);

      const data = await req.tenant!(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT c.status FROM campaign c
          WHERE c.id = ${id} AND c.org_id = ${orgId}`);
        const campaign = (rows as unknown as Array<{ status: string }>)[0];
        if (!campaign) return null;

        const audience = await previewAudience(tx, orgId, id);
        return { status: campaign.status, audience };
      });

      if (data === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.'));
        return;
      }
      res.json({ data });
    });

  /**
   * Lists a campaign's recipients — the per-recipient results view (F5 AC-5).
   *
   * Every recipient of a started campaign is here in a terminal or pending state, never silently
   * absent: `sent`/`failed` with the message's own delivery status, `skipped` with the reason it
   * was not messaged (`dnc`, `cancelled`, unreachable). Filterable by status and searchable by the
   * contact's name or number, so "who did this actually reach, and why not the rest?" is answerable.
   */
  router.get('/:id/recipients', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const parsed = listRecipientsQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
        return;
      }
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);
      const { status, q, limit, cursor } = parsed.data;
      const like = q === undefined ? null : `%${q}%`;
      const statusFilter = status ?? null;
      const after = cursor ?? null;

      const result = await req.tenant!(async (tx) => {
        // A missing campaign is a 404, not an empty list — the same shape as GET /:id.
        const exists = await tx.execute(sql`
          SELECT 1 FROM campaign WHERE id = ${id} AND org_id = ${orgId}`);
        if ((exists as unknown as unknown[]).length === 0) return null;

        return tx.execute(sql`
          SELECT cr.id, cr.status, cr.skip_reason AS "skipReason",
                 cr.attempted_at AS "attemptedAt",
                 c.display_name AS "displayName",
                 m.status AS "messageStatus", m.hold_reason AS "holdReason",
                 (SELECT ci.value_normalized FROM contact_identity ci
                  WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
                  ORDER BY ci.is_primary DESC LIMIT 1) AS "identity"
          FROM campaign_recipient cr
          JOIN contact c ON c.id = cr.contact_id AND c.org_id = ${orgId}
          LEFT JOIN message m ON m.id = cr.message_id
          WHERE cr.campaign_id = ${id} AND cr.org_id = ${orgId}
            AND (${statusFilter}::text IS NULL OR cr.status = ${statusFilter})
            AND (${like}::text IS NULL
                 OR c.display_name ILIKE ${like}
                 OR EXISTS (SELECT 1 FROM contact_identity ci2
                            WHERE ci2.contact_id = c.id AND ci2.value_normalized ILIKE ${like}))
            AND (${after}::uuid IS NULL OR cr.id > ${after}::uuid)
          ORDER BY cr.id ASC
          LIMIT ${limit}`);
      });

      if (result === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.'));
        return;
      }
      const data = result as unknown as Array<{ id: string }>;
      const nextCursor = data.length === limit ? data[data.length - 1]!.id : null;
      res.json({ data, nextCursor });
    });

  /** Lists campaigns, newest first. */
  router.get('/', requireScope('conversations:read'), async (req: Request, res: Response) => {
    // `?tagId=` narrows to campaigns aimed at that tag, so a screen can say "a campaign already uses this tag".
    const tagId = typeof req.query.tagId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.tagId) ? req.query.tagId : null;
    const orgId = req.crm!.orgId;
    const data = await req.tenant!(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT c.id, c.name, c.status, c.started_at AS "startedAt", c.created_at AS "createdAt",
               c.from_tag_id AS "fromTagId", left(c.body, 140) AS "bodySnippet",
               si.label AS "senderLabel", si.phone_e164 AS "senderPhone",
               (SELECT count(*)::int FROM campaign_recipient cr WHERE cr.campaign_id = c.id AND cr.org_id = c.org_id) AS "audienceSize"
        FROM campaign c JOIN sender_identity si ON si.id = c.sender_identity_id
        WHERE c.org_id = ${orgId}
          AND (${tagId}::uuid IS NULL OR c.from_tag_id = ${tagId}::uuid)
        ORDER BY c.created_at DESC LIMIT 100`);
      const list = rows as unknown as Array<{ id: string; status: string; audienceSize: number }>;
      // A draft has no frozen recipients yet, so its audience size is the dry-run count.
      for (const c of list) {
        if (c.status === 'draft') c.audienceSize = (await previewAudience(tx, orgId, c.id)).total;
      }
      return list;
    });
    res.json({ data });
  });

  return router;
}

/** Who is acting and from where, for the audit row. */
function actionContext(req: Request): ActionContext {
  return { actor: auditActor(req), ip: req.ip ?? null, requestId: String(req.id) };
}

/** Shared status change for pause and cancel. */
async function transition(req: Request, res: Response, to: 'paused' | 'cancelled'): Promise<void> {
  const id = String(req.params.id);
  const changed = await req.tenant!((tx) => setCampaignStatus(tx, req.crm!.orgId, actionContext(req), id, to));
  if (!changed) {
    res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign, or it has already finished.'));
    return;
  }
  res.json({ data: { id, status: to } });
}
