import { sql } from 'drizzle-orm';
import { tenantDatabase, type Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import type { LlmDriver } from '@crm/llm';
import type { Logger } from '@crm/shared';
import {
  claimNextAiJob, finishAiJob, tidyAiJobs, runAiCommand, draftCampaignText, AiCommandError,
  type ClaimedJob
} from '@crm/core';

/** What the runner needs to carry out a job. */
export interface AiRunnerDeps {
  readonly db: Database;
  readonly tenantRole: string | null;
  readonly kms: KmsDriver;
  /** Built on first use, so a server with no model configured still boots. */
  readonly getLlm: () => LlmDriver;
  readonly logger: Logger;
}

/**
 * Works through the AI queue, one request at a time per org, oldest first.
 *
 * A request is picked up the moment it is queued (`kick`), and a slow sweep covers what a restart left behind: it fails a
 * job whose worker vanished, prunes finished ones after a day, and restarts a queue that still has people waiting. Each
 * org drains on its own, so one org's slow model never holds up another's. The model call itself has its own timeout
 * (`LLM_TIMEOUT_MS`), so a job cannot run for ever.
 */
export class AiJobRunner {
  private readonly draining = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly inFlight = new Set<Promise<void>>();

  /** Builds a runner; nothing runs until `kick` or `start`. */
  constructor(private readonly deps: AiRunnerDeps) {}

  /** Starts working through this org's queue now, unless it already is. Returns at once. */
  kick(orgId: string): void {
    if (this.draining.has(orgId)) return;
    this.draining.add(orgId);
    const run = this.drain(orgId).finally(() => { this.draining.delete(orgId); this.inFlight.delete(run); });
    this.inFlight.add(run);
  }

  /** Resolves when everything started so far has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /** Begins the periodic sweep (and runs one straight away, to pick up what a restart left waiting). */
  start(everyMs = 15_000): void {
    void this.sweep();
    this.timer = setInterval(() => { void this.sweep(); }, everyMs);
    this.timer.unref();
  }

  /** Stops the sweep. Jobs already running are left to finish. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Housekeeping for every org, and a kick for any with someone waiting. */
  private async sweep(): Promise<void> {
    try {
      const orgs = (await this.deps.db.execute(sql`SELECT id FROM org`)) as unknown as Array<{ id: string }>;
      for (const { id } of orgs) {
        if (await tidyAiJobs(this.pinned(id), id)) this.kick(id);
      }
    } catch (error) {
      this.deps.logger.error({ err: error instanceof Error ? error.message : String(error) }, 'ai queue sweep failed');
    }
  }

  /** A database handle pinned to one org. */
  private pinned(orgId: string): Database {
    return tenantDatabase(this.deps.db, orgId, this.deps.tenantRole);
  }

  /** Runs jobs for one org until none is waiting. */
  private async drain(orgId: string): Promise<void> {
    const db = this.pinned(orgId);
    for (;;) {
      let job: ClaimedJob | null;
      try { job = await claimNextAiJob(db, orgId); } catch (error) {
        this.deps.logger.error({ err: error instanceof Error ? error.message : String(error) }, 'ai queue claim failed');
        return;
      }
      if (job === null) return;
      await this.run(db, orgId, job);
    }
  }

  /** Carries out one job and records how it ended. Never throws. */
  private async run(db: Database, orgId: string, job: ClaimedJob): Promise<void> {
    try {
      const llm = this.deps.getLlm();
      const result = job.kind === 'command'
        ? await runAiCommand({ db, kms: this.deps.kms, llm }, orgId, job.requestedBy, job.input)
        : { body: await draftCampaignText({ db, llm }, orgId, job.input) };
      await finishAiJob(db, orgId, job.id, { status: 'done', result });
    } catch (error) {
      const reason = error instanceof AiCommandError ? error.message : 'Something went wrong. Please try again.';
      if (!(error instanceof AiCommandError)) {
        this.deps.logger.error({ jobId: job.id, err: error instanceof Error ? error.message : String(error) }, 'ai job failed');
      }
      await finishAiJob(db, orgId, job.id, { status: 'failed', error: reason }).catch(() => undefined);
    }
  }
}
