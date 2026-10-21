import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/** What a queued request asks the assistant to do. */
export type AiJobKind = 'command' | 'draft';
/** Where a request stands. Only `queued` can be cancelled. */
export type AiJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** One request, as the queue shows it. */
export interface AiJob {
  readonly id: string;
  readonly kind: AiJobKind;
  /** The instruction or goal as typed (cut to 300 characters for the list). */
  readonly input: string;
  readonly status: AiJobStatus;
  /** The assistant's message and actions, or the written wording; null until done. */
  readonly result: unknown;
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** True when the viewer asked for it. */
  readonly mine: boolean;
  /** 1 = next to run. Only set while `queued`. */
  readonly position: number | null;
}

/** Why a queue operation was refused. */
export class AiJobError extends Error {
  /** `queue_full`: too many are already waiting. */
  constructor(readonly code: 'queue_full', message: string) { super(message); this.name = 'AiJobError'; }
}

/** Most requests one org may have waiting at once, so a loop or a flood cannot bury the queue. */
const MAX_QUEUED = 20;
/** A running job older than this has lost its worker (a restart mid-run); it is marked failed rather than blocking the queue. */
const STUCK_AFTER_MINUTES = 5;
/** How long finished jobs stay in the list. */
const KEEP_HOURS = 24;

/** The viewer of the queue: an admin (or API key) sees everyone's; anyone else sees only their own. */
export interface QueueViewer { readonly userId: string | null; readonly seesAll: boolean }

/** Adds a request to the back of the org's queue. `db` must be pinned to the org. */
export async function enqueueAiJob(
  db: Database, orgId: string, job: { kind: AiJobKind; input: string; requestedBy: string | null }
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const waiting = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_job WHERE org_id = ${orgId} AND status = 'queued'`) as unknown as Array<{ n: number }>)[0]?.n ?? 0;
    if (waiting >= MAX_QUEUED) throw new AiJobError('queue_full', `There are already ${String(MAX_QUEUED)} requests waiting. Wait for some to finish or cancel some.`);
    const rows = await tx.execute(sql`
      INSERT INTO ai_job (org_id, kind, input, requested_by) VALUES (${orgId}, ${job.kind}, ${job.input}, ${job.requestedBy}) RETURNING id`);
    return { id: (rows as unknown as Array<{ id: string }>)[0]!.id };
  });
}

/** The queue as the viewer may see it: what is waiting (with its place in line), what is running, and the last day's finished ones. */
export async function listAiJobs(db: Database, orgId: string, viewer: QueueViewer): Promise<AiJob[]> {
  const rows = await db.execute(sql`
    SELECT id, kind, left(input, 300) AS "input", status, result, error,
           created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt",
           (requested_by IS NOT NULL AND requested_by = ${viewer.userId}) AS "mine"
    FROM ai_job
    WHERE org_id = ${orgId}
      AND (status IN ('queued', 'running') OR created_at > now() - make_interval(hours => ${KEEP_HOURS}))
      AND (${viewer.seesAll} OR requested_by = ${viewer.userId})
    ORDER BY (status IN ('queued', 'running')) DESC, created_at DESC
    LIMIT 100`) as unknown as Array<Omit<AiJob, 'position'>>;
  // The place in line counts everyone's waiting jobs, not only the viewer's, so it is computed over the whole queue.
  const all = (await db.execute(sql`SELECT id FROM ai_job WHERE org_id = ${orgId} AND status = 'queued' ORDER BY created_at`) as unknown as Array<{ id: string }>).map((r) => r.id);
  return rows.map((r) => ({ ...r, position: r.status === 'queued' ? all.indexOf(r.id) + 1 : null }));
}

/**
 * Cancels a request that has not started. Atomic with the runner picking it up: exactly one of the two wins, so a job is
 * never both cancelled and run. A job that is already running (or finished) cannot be cancelled.
 */
export async function cancelAiJob(
  db: Database, orgId: string, id: string, viewer: QueueViewer
): Promise<'cancelled' | 'not_found' | 'not_queued' | 'forbidden'> {
  return db.transaction(async (tx) => {
    const found = (await tx.execute(sql`SELECT status, requested_by AS "by" FROM ai_job WHERE id = ${id} AND org_id = ${orgId}`) as unknown as Array<{ status: string; by: string | null }>)[0];
    if (found === undefined) return 'not_found';
    if (!viewer.seesAll && found.by !== viewer.userId) return 'forbidden';
    const done = await tx.execute(sql`
      UPDATE ai_job SET status = 'cancelled', finished_at = now() WHERE id = ${id} AND org_id = ${orgId} AND status = 'queued' RETURNING id`);
    return (done as unknown as unknown[]).length === 1 ? 'cancelled' : 'not_queued';
  });
}

/** What the runner needs to carry out a job. */
export interface ClaimedJob { readonly id: string; readonly kind: AiJobKind; readonly input: string; readonly requestedBy: string | null }

/**
 * Takes the oldest queued request and marks it running, or returns null when something is already running for this org
 * or nothing is waiting. One at a time per org, even with several processes: the per-org advisory lock serialises the check
 * and the claim.
 */
export async function claimNextAiJob(db: Database, orgId: string): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai_job:${orgId}`}))`);
    const busy = await tx.execute(sql`SELECT 1 FROM ai_job WHERE org_id = ${orgId} AND status = 'running' LIMIT 1`);
    if ((busy as unknown as unknown[]).length > 0) return null;
    const rows = await tx.execute(sql`
      UPDATE ai_job SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM ai_job WHERE org_id = ${orgId} AND status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, input, requested_by AS "requestedBy"`);
    return (rows as unknown as ClaimedJob[])[0] ?? null;
  });
}

/** Records how a running job ended. */
export async function finishAiJob(
  db: Database, orgId: string, id: string, outcome: { status: 'done'; result: unknown } | { status: 'failed'; error: string }
): Promise<void> {
  await db.execute(sql`
    UPDATE ai_job SET status = ${outcome.status}, finished_at = now(),
                      result = ${outcome.status === 'done' ? JSON.stringify(outcome.result) : null}::jsonb,
                      error = ${outcome.status === 'failed' ? outcome.error : null}
    WHERE id = ${id} AND org_id = ${orgId} AND status = 'running'`);
}

/** Housekeeping for one org: fail a job whose worker vanished, and drop finished ones older than a day. Returns whether anything is still queued. */
export async function tidyAiJobs(db: Database, orgId: string): Promise<boolean> {
  await db.execute(sql`
    UPDATE ai_job SET status = 'failed', finished_at = now(), error = 'It was interrupted (the server restarted). Please send it again.'
    WHERE org_id = ${orgId} AND status = 'running' AND started_at < now() - make_interval(mins => ${STUCK_AFTER_MINUTES})`);
  await db.execute(sql`
    DELETE FROM ai_job WHERE org_id = ${orgId} AND status IN ('done', 'failed', 'cancelled') AND finished_at < now() - make_interval(hours => ${KEEP_HOURS})`);
  const queued = await db.execute(sql`SELECT 1 FROM ai_job WHERE org_id = ${orgId} AND status = 'queued' LIMIT 1`);
  return (queued as unknown as unknown[]).length > 0;
}
