import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  campaignProgress, previewAudience, POLICY_GATES, campaignEta, hasVariation, fillInReport, fillInKeys, unknownFillIns, loadCustomFields,
  createCampaignDraft, startCampaign as startCampaignRun, setCampaignStatus, editCampaign, type ActionContext,
  reviewCampaign, audienceColumnsFromTargets, blankFillInPeople, audienceHistory,
  storeCampaignPicture, listCampaignPictures, CampaignPictureError, GifConversionError, campaignAiUsage, stopCampaignAi, listCampaignAiStatus
} from '@crm/core';
import type { StorageDriver } from '@crm/storage';
import { auditActor, requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';

/** One pick of the audience: a file, a tag, a saved list, or every contact. */
const reviewTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('import'), id: z.string().uuid() }),
  z.object({ kind: z.literal('tag'), id: z.string().uuid() }),
  z.object({ kind: z.literal('segment'), id: z.string().uuid() }),
  z.object({ kind: z.literal('people'), ids: z.array(z.string().uuid()).min(1).max(50_000) }),
  z.object({ kind: z.literal('everyone') })
]);
const targetsField = z.array(reviewTarget).min(1).max(50);

/** Body for the review before a draft exists: the picks, the number it sends from, and what "recently" means. */
const reviewBody = z.object({
  targets: targetsField,
  senderIdentityId: z.string().uuid(),
  days: z.number().int().min(1).max(60).optional()
});

/** Body for the downloadable list of people with a blank fill-in. */
const blanksBody = z.object({ targets: targetsField, key: z.string().min(1).max(80) });

/** Body for creating a campaign. The audience is always stated — there is no "everyone". */
const createCampaign = z.object({
  name: z.string().min(1).max(200),
  body: z.string().max(4096).refine((v) => v.trim() !== '', 'The message is empty.'),
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
  purpose: z.string().trim().min(1).max(300).optional(),
  /** A person with no value for a fill-in the message uses: leave them out, or fill the gap with `fillInFallback`. Unset = send anyway. */
  blankFillInChoice: z.enum(['skip', 'fallback']).nullable().optional(),
  fillInFallback: z.string().trim().min(1).max(200).nullable().optional(),
  /** Several picks at once (New campaign): stored as the one list of people they come to, each counted once. */
  targets: targetsField.optional(),
  /** What "messaged recently" means for this campaign, in days, and whether those people are left out. */
  recentDays: z.number().int().min(1).max(60).optional(),
  leaveOutRecent: z.boolean().optional()
}).refine((v) => v.blankFillInChoice !== 'fallback' || (v.fillInFallback ?? '') !== '', {
  message: 'give the fallback text to use', path: ['fillInFallback']
}).refine((v) => [v.fromImportRunId, v.explicitContactIds, v.fromTagId, v.fromSegmentId, v.targets]
  .filter((x) => x !== undefined).length === 1, {
  message: 'state the audience exactly once: fromImportRunId, explicitContactIds, fromTagId, fromSegmentId, or targets'
});

/**
 * Optional body for starting: an admin lifting recipient-experience gates for this campaign. The
 * list may only name the three policy gates — the number-protecting ones cannot be named at all.
 */
const startCampaign = z.object({
  overrideGates: z.array(z.enum(POLICY_GATES)).max(POLICY_GATES.length).optional(),
  /** Launching with a `{{key}}` that is not a column needs this explicit yes (CW-7.7 AC4). */
  confirmUnknownFillIns: z.boolean().optional(),
  reason: z.string().trim().min(10).max(500).optional()
}).refine((v) => (v.overrideGates ?? []).length === 0 || v.reason !== undefined, {
  message: 'a reason of at least 10 characters is required to override a gate', path: ['reason']
});

/** Body for editing a draft or paused campaign: a new name, new wording, or both. */
const editBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(4096).refine((v) => v.trim() !== '', 'The message is empty.').optional(),
  mediaAfterReply: z.boolean().optional(),
  blankFillInChoice: z.enum(['skip', 'fallback']).nullable().optional(),
  fillInFallback: z.string().trim().min(1).max(200).nullable().optional(),
  /** Draft only: the number, the picks, the template and picture (`null` takes one off), and "messaged recently". */
  senderIdentityId: z.string().uuid().optional(),
  targets: targetsField.optional(),
  aiTemplateId: z.string().uuid().nullable().optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
  recentDays: z.number().int().min(1).max(60).nullable().optional(),
  leaveOutRecent: z.boolean().optional()
}).refine((v) => Object.values(v).some((x) => x !== undefined),
  'give something to change')
  .refine((v) => v.blankFillInChoice !== 'fallback' || (v.fillInFallback ?? '') !== '', {
    message: 'give the fallback text to use', path: ['fillInFallback']
  });

/** The audience the fill-in report reads: stated once, like a campaign's. */
const fillInsQuery = z.object({
  fromImportRunId: z.string().uuid().optional(),
  fromTagId: z.string().uuid().optional(),
  fromSegmentId: z.string().uuid().optional()
}).refine((v) => [v.fromImportRunId, v.fromTagId, v.fromSegmentId].filter((x) => x !== undefined).length === 1, {
  message: 'state the audience exactly once: fromImportRunId, fromTagId, or fromSegmentId'
});

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
  /** Where the AI's conversation with the person stands; `none` = messaged and nothing back yet. */
  ai: z.enum(['interested', 'not_interested', 'needs_person', 'talking', 'none']).optional(),
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

  /**
   * The fill-ins an audience offers (CW-7.6): `name`, `first_name` and every defined field, each with a real sample value and how many
   * of the people have it, so the Insert list can say "due_date · 12 Nov 2026 · 982 of 1,000 have it". Reads, writes nothing.
   * (Declared before the `/:id` routes so "fill-ins" is not read as a campaign id.)
   */
  router.get('/fill-ins', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const parsed = fillInsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    res.json({ data: await req.tenant!((tx) => fillInReport(tx, orgId, parsed.data)) });
  });

  /**
   * What these picks would reach from this number, before a draft exists: people, who is left out and why, the fill-ins with samples,
   * and a few real people to preview as. Reads, writes nothing. (Declared before `/:id`.)
   */
  router.post('/review', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const parsed = reviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const { targets, senderIdentityId, days } = parsed.data;
    res.json({ data: await req.tenant!((tx) => reviewCampaign(tx, orgId, { targets, senderIdentityId, days })) });
  });

  /** The people the picks reach who have no value for one fill-in, as rows to fix in a spreadsheet. */
  router.post('/review/blanks', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const parsed = blanksBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    res.json({ data: await req.tenant!((tx) => blankFillInPeople(tx, orgId, parsed.data.targets, parsed.data.key)) });
  });

  /** The last campaign each file, tag and saved list was used for. */
  router.get('/audience-history', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    res.json({ data: await req.tenant!((tx) => audienceHistory(tx, orgId)) });
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
      name, body, senderIdentityId, fromImportRunId, explicitContactIds, fromTagId, fromSegmentId, aiTemplateId, mediaAssetId, mediaAfterReply, purpose,
      blankFillInChoice, fillInFallback, targets, recentDays, leaveOutRecent
    } = parsed.data;

    const created = await req.tenant!(async (tx) => {
      // One file, tag or saved list is kept as itself, so it is read again when the campaign starts. More than one pick (or "everyone")
      // is stored as the one list of people it comes to, each counted once. The picks themselves are kept so the draft can be edited.
      const picked = targets === undefined ? undefined : await audienceColumnsFromTargets(tx, orgId, targets);
      if (targets !== undefined && picked === null) return { error: 'no_people' as const };
      return createCampaignDraft(tx, orgId, actionContext(req), {
        name, body, senderIdentityId, aiTemplateId,
        fromImportRunId: picked?.fromImportRunId ?? fromImportRunId,
        fromTagId: picked?.fromTagId ?? fromTagId,
        fromSegmentId: picked?.fromSegmentId ?? fromSegmentId,
        explicitContactIds: picked?.explicitContactIds ?? explicitContactIds,
        audienceTargets: targets,
        mediaAssetId, mediaAfterReply, purpose, blankFillInChoice, fillInFallback, recentDays, leaveOutRecent
      });
    });

    if ('error' in created) {
      const detail = created.error === 'no_tag' ? 'No such tag.'
        : created.error === 'no_segment' ? 'No such segment.'
        : created.error === 'no_template' ? 'No such AI template.'
        : created.error === 'no_picture' ? 'No such picture. Upload it again.'
        : created.error === 'no_people' ? 'Nobody is in what you picked.'
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

      // A `{{key}}` that is not a column is blank for everyone: starting needs an explicit yes (CW-7.7 AC4). Only a draft is checked;
      // a campaign being resumed was already started with that yes.
      if (startBody.data.confirmUnknownFillIns !== true) {
        const unknown = await req.tenant!(async (tx) => {
          const row = (await tx.execute(sql`SELECT body, status FROM campaign WHERE id = ${id} AND org_id = ${orgId}`) as unknown as Array<{ body: string; status: string }>)[0];
          if (row === undefined || row.status !== 'draft') return [];
          return unknownFillIns(row.body, fillInKeys((await loadCustomFields(tx, orgId)).map((f) => f.key)));
        });
        if (unknown.length > 0) {
          res.status(409).json(problem(req, 409, 'UNKNOWN_FILL_IN',
            `No column called ${unknown.map((u) => u.key).join(', ')}. Fix the message, or confirm to send with blanks.`));
          return;
        }
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

  /** Stops the AI on this campaign: no more AI openings or replies; its chats go to the person the template names. */
  router.post('/:id/stop-ai', requireUuidParam('id'), requireScope('messages:send'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const done = await req.tenant!((tx) => stopCampaignAi(tx, orgId, String(req.params.id), auditActor(req)));
    if (!done) { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign, or it does not use an AI template.')); return; }
    res.status(204).end();
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
    const orgId = req.crm!.orgId;
    const { targets, ...rest } = parsed.data;
    const outcome = await req.tenant!(async (tx) => {
      const audience = targets === undefined ? undefined : await audienceColumnsFromTargets(tx, orgId, targets);
      if (targets !== undefined && audience === null) return 'no_people' as const;
      return editCampaign(tx, orgId, actionContext(req), id, { ...rest, audience: audience ?? undefined, audienceTargets: targets });
    });
    if (outcome === 'not_found') { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.')); return; }
    if (outcome === 'not_editable') {
      res.status(409).json(problem(req, 409, 'NOT_EDITABLE', 'Only a draft or paused campaign can be edited (and only a draft can change its number, audience, picture or template). Pause it first.'));
      return;
    }
    if (outcome !== 'ok') {
      const detail = outcome === 'no_people' ? 'Nobody is in what you picked.' : outcome === 'no_tag' ? 'No such tag.' : outcome === 'no_segment' ? 'No such segment.'
        : outcome === 'no_template' ? 'No such AI template.' : outcome === 'no_picture' ? 'No such picture. Upload it again.' : 'No such sender.';
      res.status(404).json(problem(req, 404, 'NOT_FOUND', detail));
      return;
    }
    res.json({ data: { id, ...rest } });
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
                 c.ai_template_id AS "aiTemplateId", c.ai_stopped AS "aiStopped", c.audience_targets AS "audienceTargets",
                 c.from_import_run_id AS "fromImportRunId", c.from_tag_id AS "fromTagId", c.from_segment_id AS "fromSegmentId",
                 c.explicit_contact_ids AS "explicitContactIds", c.recent_days AS "recentDays", c.leave_out_recent AS "leaveOutRecent",
                 c.blank_fill_in_choice AS "blankFillInChoice", c.fill_in_fallback AS "fillInFallback", ma.filename AS "mediaFilename",
                 ma.content_type AS "mediaContentType", ma.size_bytes AS "mediaSizeBytes"
          FROM campaign c
          LEFT JOIN media_asset ma ON ma.id = c.media_asset_id AND ma.org_id = c.org_id
          WHERE c.id = ${id} AND c.org_id = ${orgId}`);
        const campaign = (rows as unknown as Array<Record<string, unknown>>)[0];
        if (!campaign) return null;

        const progress = await campaignProgress(tx, orgId, id);
        const warnings = campaignWarnings(String(campaign.body), (campaign.aiTemplateId as string | null) ?? null);
        const aiUsage = campaign.aiTemplateId === null ? null : await campaignAiUsage(tx, orgId, id);
        const aiStatus = campaign.aiTemplateId === null ? null : await listCampaignAiStatus(tx, orgId, id);
        return { ...campaign, progress, warnings, aiUsage, aiStatus };
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
          SELECT c.status, c.body FROM campaign c
          WHERE c.id = ${id} AND c.org_id = ${orgId}`);
        const campaign = (rows as unknown as Array<{ status: string; body: string }>)[0];
        if (!campaign) return null;

        const audience = await previewAudience(tx, orgId, id);
        // `{{keys}}` in the message that are not a column, each with the closest real one (CW-7.7): launching with one needs a yes.
        const unknownFields = unknownFillIns(campaign.body, fillInKeys((await loadCustomFields(tx, orgId)).map((f) => f.key)));
        return { status: campaign.status, audience, unknownFillIns: unknownFields };
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
      const { status, q, ai, limit, cursor } = parsed.data;
      const like = q === undefined ? null : `%${q}%`;
      const statusFilter = status ?? null;
      const aiFilter = ai ?? null;
      const after = cursor ?? null;

      const result = await req.tenant!(async (tx) => {
        // A missing campaign is a 404, not an empty list — the same shape as GET /:id.
        const exists = await tx.execute(sql`
          SELECT 1 FROM campaign WHERE id = ${id} AND org_id = ${orgId}`);
        if ((exists as unknown as unknown[]).length === 0) return null;

        return tx.execute(sql`
          SELECT cr.id, cr.status, cr.skip_reason AS "skipReason",
                 cr.attempted_at AS "attemptedAt", cr.ai_status AS "aiStatus", cr.ai_summary AS "aiSummary",
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
            AND (${aiFilter}::text IS NULL OR cr.ai_status = ${aiFilter}::text OR (${aiFilter}::text = 'none' AND cr.ai_status IS NULL AND cr.status = 'sent'))
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
  if (changed === 'not_started') {
    res.status(409).json(problem(req, 409, 'NOT_RUNNING', 'This campaign has not started, so there is nothing to pause.'));
    return;
  }
  if (changed === 'not_found') {
    res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign, or it has already finished.'));
    return;
  }
  res.json({ data: { id, status: to } });
}
