import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  campaignProgress, previewAudience, forecast, POLICY_GATES,
  createCampaignDraft, startCampaign as startCampaignRun, setCampaignStatus, editCampaign, type ActionContext
} from '@crm/core';
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
  fromSegmentId: z.string().uuid().optional()
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
  body: z.string().min(1).max(4096).optional()
}).refine((v) => v.name !== undefined || v.body !== undefined, 'give a name or a body');

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
 * audience, and the gateway converts recipients into messages at whatever rate the anti-ban
 * ceiling allows. Nothing in this router can make a message go out faster (M12).
 */
export function campaignsRouter(limits: { perMinute: number; perDay: number }): Router {
  const router = Router();

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
      name, body, senderIdentityId, fromImportRunId, explicitContactIds, fromTagId, fromSegmentId
    } = parsed.data;

    const created = await req.tenant!((tx) => createCampaignDraft(tx, orgId, actionContext(req), {
      name, body, senderIdentityId, fromImportRunId, explicitContactIds, fromTagId, fromSegmentId
    }));

    if ('error' in created) {
      const detail = created.error === 'no_tag' ? 'No such tag.'
        : created.error === 'no_segment' ? 'No such segment.'
        : 'No such sender.';
      res.status(404).json(problem(req, 404, 'NOT_FOUND', detail));
      return;
    }
    res.status(201).json({ data: { id: created.id, status: 'draft' } });
  });

  /**
   * Starts a campaign: freezes the audience and lets the gateway begin.
   *
   * The forecast comes back with it, because **how long this will take is a fact the operator
   * needs at the moment of starting**, not afterwards. A 5,000-person campaign on a number
   * that is four days old is a months-long proposition, and that should never be a surprise.
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
        tx, orgId, actionContext(req), id, limits,
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
                 si.warmup_started_at AS "warmupStartedAt",
                 si.daily_cap_override AS "dailyCapOverride",
                 si.last_inbound_at AS "lastInboundAt"
          FROM campaign c
          JOIN sender_identity si ON si.id = c.sender_identity_id
          WHERE c.id = ${id} AND c.org_id = ${orgId}`);
        const campaign = (rows as unknown as Array<Record<string, unknown>>)[0];
        if (!campaign) return null;

        const progress = await campaignProgress(tx, orgId, id);
        const outlook = await forecast(tx, campaign.senderIdentityId as string, progress.pending, {
          perMinute: limits.perMinute, perDay: limits.perDay,
          dailyCapOverride: campaign.dailyCapOverride as number | null,
          warmupStartedAt: campaign.warmupStartedAt === null
            ? null : new Date(campaign.warmupStartedAt as string),
          lastInboundAt: campaign.lastInboundAt === null
            ? null : new Date(campaign.lastInboundAt as string)
        });
        // The sender's pacing state fed the forecast; it is not the caller's business.
        const { warmupStartedAt: _w, dailyCapOverride: _d, lastInboundAt: _l, ...rest } = campaign;
        return { ...rest, progress, forecast: outlook };
      });

      if (data === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such campaign.'));
        return;
      }
      res.json({ data });
    });

  /**
   * A dry run: the audience a draft *would* freeze, and how long it would take — without writing
   * anything (F5 AC-1). This is the number an operator needs **before** pressing start, not after.
   * Reachable vs unreachable is split out so a low reachable count (a tag of contacts with no
   * numbers) is visible up front rather than a surprise in the results.
   */
  router.get('/:id/preview', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);

      const data = await req.tenant!(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT c.status, c.sender_identity_id AS "senderIdentityId",
                 si.warmup_started_at AS "warmupStartedAt",
                 si.daily_cap_override AS "dailyCapOverride",
                 si.last_inbound_at AS "lastInboundAt"
          FROM campaign c
          JOIN sender_identity si ON si.id = c.sender_identity_id
          WHERE c.id = ${id} AND c.org_id = ${orgId}`);
        const campaign = (rows as unknown as Array<{
          status: string; senderIdentityId: string;
          warmupStartedAt: string | null; dailyCapOverride: number | null; lastInboundAt: string | null;
        }>)[0];
        if (!campaign) return null;

        const audience = await previewAudience(tx, orgId, id);
        // Only the reachable contacts would actually be messaged, so that is what the forecast paces.
        const outlook = await forecast(tx, campaign.senderIdentityId, audience.reachable, {
          perMinute: limits.perMinute, perDay: limits.perDay,
          dailyCapOverride: campaign.dailyCapOverride,
          warmupStartedAt: campaign.warmupStartedAt === null
            ? null : new Date(campaign.warmupStartedAt),
          lastInboundAt: campaign.lastInboundAt === null ? null : new Date(campaign.lastInboundAt)
        });
        return { status: campaign.status, audience, forecast: outlook };
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
                 m.status AS "messageStatus",
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
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT id, name, status, started_at AS "startedAt", created_at AS "createdAt",
             from_tag_id AS "fromTagId"
      FROM campaign WHERE org_id = ${req.crm!.orgId}
        AND (${tagId}::uuid IS NULL OR from_tag_id = ${tagId}::uuid)
      ORDER BY created_at DESC LIMIT 100`));
    res.json({ data: rows });
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
