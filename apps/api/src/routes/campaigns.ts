import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  campaignProgress, forecast, snapshotAudience, writeAudit, AUDIT
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
  fromTagId: z.string().uuid().optional()
}).refine((v) => [v.fromImportRunId, v.explicitContactIds, v.fromTagId]
  .filter((x) => x !== undefined).length === 1, {
  message: 'state the audience exactly once: fromImportRunId, explicitContactIds, or fromTagId'
});

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
      name, body, senderIdentityId, fromImportRunId, explicitContactIds, fromTagId
    } = parsed.data;

    const created = await req.tenant!(async (tx) => {
      const sender = await tx.execute(sql`
        SELECT id FROM sender_identity WHERE id = ${senderIdentityId} AND org_id = ${orgId}`);
      if ((sender as unknown as unknown[]).length === 0) return { error: 'no_sender' as const };

      // A tag audience must name a tag that exists in this org — a clean 404 rather than a
      // foreign-key 500, and it stops a campaign being created against a tag from another org.
      if (fromTagId !== undefined) {
        const t = await tx.execute(sql`
          SELECT id FROM tag WHERE id = ${fromTagId} AND org_id = ${orgId}`);
        if ((t as unknown as unknown[]).length === 0) return { error: 'no_tag' as const };
      }

      const rows = await tx.execute(sql`
        INSERT INTO campaign (org_id, name, body, sender_identity_id, from_import_run_id,
                              explicit_contact_ids, from_tag_id, status)
        VALUES (${orgId}, ${name}, ${body}, ${senderIdentityId}, ${fromImportRunId ?? null},
                ${explicitContactIds === undefined
                  ? null : JSON.stringify(explicitContactIds)}::jsonb,
                ${fromTagId ?? null}, 'draft')
        RETURNING id`);
      const id = (rows as unknown as Array<{ id: string }>)[0]!.id;
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.campaignCreated,
        targetType: 'campaign', targetId: id, after: { name, senderIdentityId },
        ip: req.ip ?? null, requestId: String(req.id)
      });
      return { id };
    });

    if ('error' in created) {
      const detail = created.error === 'no_tag' ? 'No such tag.' : 'No such sender.';
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

      const result = await req.tenant!(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT status, sender_identity_id AS "senderIdentityId" FROM campaign
          WHERE id = ${id} AND org_id = ${orgId} FOR UPDATE`);
        const campaign = (rows as unknown as Array<{
          status: string; senderIdentityId: string;
        }>)[0];
        if (!campaign) return { error: 'not_found' as const };
        if (campaign.status === 'running') return { error: 'already_running' as const };
        if (campaign.status === 'completed' || campaign.status === 'cancelled') {
          return { error: 'finished' as const };
        }

        // Only on the first start. Resuming a paused campaign must not re-snapshot, or
        // contacts added since would silently join an audience somebody already approved.
        if (campaign.status === 'draft') await snapshotAudience(tx, orgId, id);

        await tx.execute(sql`
          UPDATE campaign SET status = 'running', started_at = coalesce(started_at, now()),
                              updated_at = now()
          WHERE id = ${id} AND org_id = ${orgId}`);

        const progress = await campaignProgress(tx, orgId, id);
        const senderLimits = await tx.execute(sql`
          SELECT warmup_started_at AS "warmupStartedAt", daily_cap_override AS "dailyCapOverride"
          FROM sender_identity WHERE id = ${campaign.senderIdentityId} AND org_id = ${orgId}`);
        const s = (senderLimits as unknown as Array<{
          warmupStartedAt: string | null; dailyCapOverride: number | null;
        }>)[0]!;

        const outlook = await forecast(tx, campaign.senderIdentityId, progress.pending, {
          perMinute: limits.perMinute, perDay: limits.perDay,
          dailyCapOverride: s.dailyCapOverride,
          warmupStartedAt: s.warmupStartedAt === null ? null : new Date(s.warmupStartedAt)
        });

        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.campaignStarted,
          targetType: 'campaign', targetId: id, after: { ...progress, ...outlook },
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return { progress, outlook };
      });

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
    (req: Request, res: Response) => { void transition(req, res, 'paused', AUDIT.campaignPaused); });

  /**
   * Cancels a campaign permanently.
   *
   * Everything still pending becomes `skipped` with a reason rather than vanishing — the totals
   * have to keep adding up. Messages already queued are left alone: they have been accepted for
   * sending and pulling them back would be a different, racier operation.
   */
  router.post('/:id/cancel', requireUuidParam('id'), requireScope('messages:send'),
    (req: Request, res: Response) => {
      void transition(req, res, 'cancelled', AUDIT.campaignCancelled, async (tx, orgId, id) => {
        await tx.execute(sql`
          UPDATE campaign_recipient SET status = 'skipped', skip_reason = 'cancelled'
          WHERE campaign_id = ${id} AND org_id = ${orgId} AND status = 'pending'`);
      });
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
                 c.created_at AS "createdAt",
                 si.warmup_started_at AS "warmupStartedAt",
                 si.daily_cap_override AS "dailyCapOverride"
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
            ? null : new Date(campaign.warmupStartedAt as string)
        });
        // The sender's pacing state fed the forecast; it is not the caller's business.
        const { warmupStartedAt: _w, dailyCapOverride: _d, ...rest } = campaign;
        return { ...rest, progress, forecast: outlook };
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
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT id, name, status, started_at AS "startedAt", created_at AS "createdAt"
      FROM campaign WHERE org_id = ${req.crm!.orgId}
      ORDER BY created_at DESC LIMIT 100`));
    res.json({ data: rows });
  });

  return router;
}

/** Shared status change, so pause and cancel cannot drift apart. */
async function transition(
  req: Request, res: Response, to: string, action: string,
  extra?: (tx: Parameters<Parameters<NonNullable<Request['tenant']>>[0]>[0],
           orgId: string, id: string) => Promise<void>
): Promise<void> {
  const orgId = req.crm!.orgId;
  const id = String(req.params.id);

  const changed = await req.tenant!(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE campaign SET status = ${to}, updated_at = now(),
                          completed_at = CASE WHEN ${to} = 'cancelled' THEN now()
                                              ELSE completed_at END
      WHERE id = ${id} AND org_id = ${orgId} AND status IN ('running', 'paused', 'draft')
      RETURNING id`);
    if ((rows as unknown as unknown[]).length === 0) return false;
    if (extra) await extra(tx, orgId, id);
    await writeAudit(tx, {
      orgId, actor: auditActor(req), action, targetType: 'campaign', targetId: id,
      after: { status: to }, ip: req.ip ?? null, requestId: String(req.id)
    });
    return true;
  });

  if (!changed) {
    res.status(404).json(problem(req, 404, 'NOT_FOUND',
      'No such campaign, or it has already finished.'));
    return;
  }
  res.json({ data: { id, status: to } });
}
