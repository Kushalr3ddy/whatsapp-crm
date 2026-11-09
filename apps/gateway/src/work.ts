import type { LlmDriver } from '@crm/llm';
import { sql } from 'drizzle-orm';
import { setTenant, type Database, type Transaction } from '@crm/db';
import { tenantDatabase } from './tenant.js';
import type { ChannelProvider, NormalisedConnectionEvent, NormalisedNoticeEvent, NormalisedRetryEvent, NormalisedStatusEvent, Recipient } from '@crm/channels';
import {
  classifyLinkFailure, encodeLinkError,
  dispatchCampaign, reconcileCampaign, writeOpenings, makeAntiBanPolicy,
  applyWhatsAppNotice, type AntiBanPolicy, recordHealthEvent, reencryptBatch,
  applyDeliveryStatus, markMessageFailedByProviderId, markDecryptBurst, liftRetryOnReceipt, conversationOfSent, snapshotDue, saveSnapshot,
  registerRetryRequest, checkUnreached, markUnconfirmedSends, reviewManyUndelivered, contactWroteAgain, handleInboundSafety,
  type ProbeFn, type InboundSafetyResult
} from '@crm/core';
import { runLane, markInboundRead, type LaneResult } from './lane.js';
import type { Logger } from '@crm/shared';
import type { KmsDriver } from '@crm/kms-local';
import type { StorageDriver } from '@crm/storage';

/** A pending request from the API to link a number. */
interface PendingLink {
  readonly sessionId: string;
  readonly senderIdentityId: string;
  readonly mode: 'qr' | 'pairing_code';
  readonly phone: string | null;
}

/** Everything the work handlers need. Passed in, never imported, so they stay testable. */
export interface WorkContext {
  readonly db: Database;
  /**
   * Encrypts a campaign body on its way into a message. Absent in contexts that never
   * dispatch a campaign, which is most tests.
   */
  readonly kms?: KmsDriver;
  /** The AI model, for campaigns whose first messages the AI writes. Absent = such campaigns wait. */
  readonly llm?: LlmDriver;
  readonly provider: ChannelProvider;
  readonly logger: Logger;
  /** Decrypts a stored message body back to text for sending. */
  readonly decrypt: (cipher: Uint8Array) => string;
  /**
   * What decides when a message may go and how many campaign messages queue at once. Absent = the v2 policy (`makeAntiBanPolicy`);
   * a test that wants none of it passes a policy that always sends.
   */
  readonly antiBan?: AntiBanPolicy;
  /**
   * Emit a `composing` presence and pause a human-like beat before each send (D-24). Opt-in, so tests that do
   * not exercise it are unaffected and add no real delay. A failure to signal presence never fails the send.
   */
  readonly typingSimulation?: boolean;
  /**
   * Before the first send to a contact with more than one phone number, ask the transport whether the
   * primary number has a WhatsApp account, and use the next one that does (D-60). Opt-in like the
   * other behaviour layers, so tests that do not exercise it never trigger a lookup.
   */
  readonly verifyFallbackNumbers?: boolean;
  /**
   * The restricted role tenant-scoped work drops to (`crm_app`), as resolved at startup by
   * `resolveTenantRole`. Null or absent when the connecting role is already subject to row-level
   * security, or in tests that run as a superuser and only need the org set (D-41).
   */
  readonly tenantRole?: string | null;
  /** How many of the oldest queued messages one sweep attempts. Default 200. */
  readonly sweepBatchSize?: number;
  /**
   * Where stored files live, so a queued message that carries one can be read back and sent
   * (D-25). Absent in tests that only send text; a media message with no storage fails visibly.
   */
  readonly storage?: StorageDriver;
  /**
   * Waits inside a send: the typing beat and the pause before a read receipt (a few seconds to 25 at most). Injected so tests do not
   * spend real seconds — production passes a real sleep. A context with neither `sleep` nor `schedule` does not wait at all.
   */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Comes back to a number's lane later, at a given delay. How the lane honours a wait longer than its typing: it leaves the message
   * alone and asks to be run again when it is due, instead of holding a sweep open (F6 S1). Production passes a timer; a test passes
   * a recorder it fires itself. A context with `sleep` but no `schedule` sleeps through the wait inline.
   */
  readonly schedule?: (ms: number, run: () => void) => void;
  /** The current time. Injected so a test can run the lane against a clock it moves itself; default `new Date()`. */
  readonly now?: () => Date;
  /** Random source for the gaps and read delays the lane draws. Default `Math.random`. */
  readonly random?: () => number;
}

/**
 * The same context with its database pinned to one org (D-41). Everything the gateway does for a
 * tenant goes through one of these, so Postgres, not each query's `WHERE org_id`, is what keeps
 * one org's rows away from another's.
 */
function scopedTo(ctx: WorkContext, orgId: string): WorkContext {
  return { ...ctx, db: tenantDatabase(ctx.db, orgId, ctx.tenantRole ?? null) };
}

/**
 * Every org id, for a sweep that has to look at all tenants. This and the small "which org owns
 * this id" lookups below are the gateway's only unscoped reads, and they return ids alone: the
 * work itself always runs through `scopedTo`.
 */
async function allOrgIds(ctx: WorkContext): Promise<string[]> {
  const rows = await ctx.db.execute(sql`SELECT id FROM org`);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/** Runs `work` once per org, each time with a context pinned to that org, and collects the results. */
async function inEachOrg<T>(ctx: WorkContext, work: (scoped: WorkContext) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (const orgId of await allOrgIds(ctx)) out.push(await work(scopedTo(ctx, orgId)));
  return out;
}

/** The org that owns a sender, or null when there is no such sender. */
async function orgOfSender(ctx: WorkContext, senderId: string): Promise<string | null> {
  const rows = await ctx.db.execute(sql`SELECT org_id AS "orgId" FROM sender_identity WHERE id = ${senderId}`);
  return (rows as unknown as Array<{ orgId: string }>)[0]?.orgId ?? null;
}

/** The org that owns a link/unlink session (through its sender), or null when it is gone. */
async function orgOfSession(ctx: WorkContext, sessionId: string): Promise<string | null> {
  const rows = await ctx.db.execute(sql`
    SELECT si.org_id AS "orgId" FROM channel_session cs
    JOIN sender_identity si ON si.id = cs.sender_identity_id
    WHERE cs.id = ${sessionId}`);
  return (rows as unknown as Array<{ orgId: string }>)[0]?.orgId ?? null;
}

/**
 * Starts the linking handshake the API asked for, and writes the challenge back.
 *
 * The API cannot call the provider itself — the socket lives in this process — so the request
 * is left on `channel_session` and the QR or pairing code is returned through the same row.
 */
export async function handleLinkRequest(ctx: WorkContext, sessionId: string): Promise<void> {
  const orgId = await orgOfSession(ctx, sessionId);
  if (orgId === null) return;
  await handleLinkRequestInOrg(scopedTo(ctx, orgId), sessionId);
}

/** `handleLinkRequest` once the session's org is known and the context is pinned to it. */
async function handleLinkRequestInOrg(ctx: WorkContext, sessionId: string): Promise<void> {
  const rows = await ctx.db.execute(sql`
    SELECT cs.id            AS "sessionId",
           cs.sender_identity_id AS "senderIdentityId",
           cs.link_requested_mode AS mode,
           cs.link_requested_phone AS phone
    FROM channel_session cs
    WHERE cs.id = ${sessionId}
      AND cs.link_requested_at IS NOT NULL
      AND cs.link_challenge IS NULL`);
  const req = (rows as unknown as PendingLink[])[0];
  if (!req) return;                     // already handled, or superseded

  try {
    // A number that is not currently connected may still hold the credentials of a session WhatsApp
    // already ended (logged out on the phone). Linking on top of those makes WhatsApp refuse the login
    // and never show a QR, so clear them first. Never done for a live connection.
    const state = (await ctx.db.execute(sql`
      SELECT connection_state AS s FROM channel_session WHERE id = ${req.sessionId}`
    ) as unknown as Array<{ s: string | null }>)[0]?.s ?? null;
    if (state !== 'open') {
      await ctx.provider.logout(req.senderIdentityId).catch(() => undefined);
    }
    const challenge = await ctx.provider.link(
      req.senderIdentityId, req.mode, req.phone ?? undefined
    );
    await ctx.db.execute(sql`
      UPDATE channel_session
      SET link_challenge = ${JSON.stringify(challenge)}::jsonb,
          qr_expires_at = ${challenge.expiresAt.toISOString()},
          link_error = NULL,
          connection_state = 'connecting',
          updated_at = now()
      WHERE id = ${req.sessionId}`);
    ctx.logger.info({ senderId: req.senderIdentityId, mode: req.mode }, 'link challenge issued');
  } catch (error) {
    // Surface the failure on the row so the API can tell the caller, rather than leaving them
    // polling an endpoint that never resolves.
    const info = classifyLinkFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    // The request is closed with the failure: leaving link_requested_at set made the sweep retry the
    // same doomed link every minute. The operator presses Link again when they want another try.
    await ctx.db.execute(sql`
      UPDATE channel_session
      SET link_error = ${encodeLinkError(info)}, link_requested_at = NULL,
          link_requested_mode = NULL, link_requested_phone = NULL,
          connection_state = CASE WHEN connection_state = 'connecting' THEN 'closed' ELSE connection_state END,
          updated_at = now()
      WHERE id = ${req.sessionId}`);
    ctx.logger.error(
      { senderId: req.senderIdentityId, code: info.code, statusCode: info.statusCode ?? null, err: message },
      'link request failed'
    );
  }
}

/**
 * Unlinks a number: logs it out on WhatsApp's side and discards the stored credentials.
 *
 * This is the recovery path a corrupt or logged-out session needs. Baileys only issues a fresh
 * QR when there are no stored credentials, so without clearing them a re-link just reloads the
 * broken session and never shows a QR. `provider.logout` clears them (and drops the socket if
 * one is live); afterwards the sender is back to awaiting a link, and the next link request
 * gets a clean QR.
 */
export async function handleUnlinkRequest(ctx: WorkContext, sessionId: string): Promise<void> {
  const orgId = await orgOfSession(ctx, sessionId);
  if (orgId === null) return;
  await handleUnlinkRequestInOrg(scopedTo(ctx, orgId), sessionId);
}

/** `handleUnlinkRequest` once the session's org is known and the context is pinned to it. */
async function handleUnlinkRequestInOrg(ctx: WorkContext, sessionId: string): Promise<void> {
  const rows = await ctx.db.execute(sql`
    SELECT sender_identity_id AS "senderIdentityId"
    FROM channel_session
    WHERE id = ${sessionId} AND unlink_requested_at IS NOT NULL`);
  const row = (rows as unknown as Array<{ senderIdentityId: string }>)[0];
  if (!row) return;                     // already handled, or superseded

  try {
    await ctx.provider.logout(row.senderIdentityId);
  } catch (error) {
    // Even if the logout call fails (no live socket, already gone from WhatsApp's side), the
    // stored credentials are what matter for a re-link, and logout clears those first. Log and
    // still reset the row so this does not loop.
    ctx.logger.warn(
      { senderId: row.senderIdentityId, err: error instanceof Error ? error.message : String(error) },
      'logout during unlink did not complete cleanly'
    );
  }

  // Return the sender to the same state as a freshly created, never-linked one — both the live
  // connection state and the business status, so neither is left describing a link that is gone
  // (the "written in both directions" rule, docs/00-prior-art.md).
  await ctx.db.execute(sql`
    UPDATE channel_session SET
      connection_state = 'closed', disconnect_reason = 'unlinked',
      link_requested_at = NULL, link_requested_mode = NULL, link_requested_phone = NULL,
      link_challenge = NULL, link_error = NULL, qr_expires_at = NULL,
      unlink_requested_at = NULL, linked_since = NULL, updated_at = now()
    WHERE id = ${sessionId}`);
  await ctx.db.execute(sql`
    UPDATE sender_identity SET status = 'linking', updated_at = now()
    WHERE id = ${row.senderIdentityId}`);
  ctx.logger.info({ senderId: row.senderIdentityId }, 'number unlinked; credentials cleared');
}

/**
 * Lanes running right now, one per number. A kick while a lane is running does not start a second one: it marks the lane dirty, and
 * the running one looks again before it finishes. This is what keeps two messages of one number from ever leaving together (AC-1.1).
 */
const laneRuns = new Map<string, Promise<LaneResult>>();
const laneDirty = new Set<string>();
/** The earliest pending wake-up per number, so a lane asks to be woken once rather than once per message. */
const laneWakes = new Map<string, number>();

/**
 * Runs the lane of one number (F6 S1) and arranges to run it again when something will change by itself: a gap ends, a hold
 * expires, the number goes idle. Safe to call from anywhere, any number of times.
 */
export function kickLane(ctx: WorkContext, senderId: string): Promise<LaneResult> {
  const running = laneRuns.get(senderId);
  if (running !== undefined) {
    laneDirty.add(senderId);
    return running;
  }
  const run = (async (): Promise<LaneResult> => {
    const orgId = await orgOfSender(ctx, senderId);
    if (orgId === null) return { sent: 0, failed: 0, nextWakeAt: null };
    const scoped = scopedTo(ctx, orgId);
    let sent = 0;
    let failed = 0;
    let result: LaneResult;
    do {
      laneDirty.delete(senderId);
      result = await runLane(scoped, orgId, senderId);
      sent += result.sent;
      failed += result.failed;
    } while (laneDirty.has(senderId));
    return { sent, failed, nextWakeAt: result.nextWakeAt };
  })().then((result) => {
    wakeLaneAt(ctx, senderId, result.nextWakeAt);
    return result;
  }).finally(() => { laneRuns.delete(senderId); });
  // Registered in the same tick, so a second kick right behind this one joins it instead of starting another.
  laneRuns.set(senderId, run);
  return run;
}

/** Asks `ctx.schedule` to run the lane again at `at`, unless an earlier wake-up is already waiting. */
function wakeLaneAt(ctx: WorkContext, senderId: string, at: Date | null): void {
  if (at === null || ctx.schedule === undefined) return;
  const when = at.getTime();
  const pending = laneWakes.get(senderId);
  if (pending !== undefined && pending <= when) return;
  laneWakes.set(senderId, when);
  const delay = Math.max(0, when - (ctx.now ?? (() => new Date()))().getTime());
  ctx.schedule(delay, () => {
    if (laneWakes.get(senderId) === when) laneWakes.delete(senderId);
    kickLane(ctx, senderId).catch((error: unknown) => {
      ctx.logger.error({ senderId, err: error instanceof Error ? error.message : String(error) }, 'lane run failed');
    });
  });
}

/**
 * Sends what is queued for a message's number.
 *
 * Every message of a number goes through its lane, so this runs the lane of the message's number: the message goes when its turn
 * and the policy say so, which may be after others (a reply goes before campaign messages queued earlier).
 *
 * Every failure is recorded against that message and nothing else. In the previous system one unsendable recipient threw and took
 * down the whole engine, so the watchdog restarted it, the operator retried, and it died again — a permanent crash loop for a
 * single contact (docs/00-prior-art.md, M26).
 *
 * There is no retry here, deliberately. Retrying into WhatsApp is exactly how a number gets banned, so a failed message stays
 * failed until a person sends it again.
 */
export async function handleSend(ctx: WorkContext, messageId: string): Promise<void> {
  const owner = (await ctx.db.execute(sql`
    SELECT v.sender_identity_id AS "senderId"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE m.id = ${messageId}`) as unknown as Array<{ senderId: string }>)[0];
  if (owner === undefined) return;
  await kickLane(ctx, owner.senderId);
}

/**
 * An agent opened a chat: tell WhatsApp its inbound messages were read (F6 AC-1.7). Messages are never marked read when they arrive;
 * this and the reply path in the lane are the only places it happens.
 */
export async function handleReadRequest(ctx: WorkContext, conversationId: string): Promise<number> {
  const owner = (await ctx.db.execute(sql`
    SELECT org_id AS "orgId", sender_identity_id AS "senderId" FROM conversation WHERE id = ${conversationId}`
  ) as unknown as Array<{ orgId: string; senderId: string }>)[0];
  if (owner === undefined) return 0;
  const scoped = scopedTo(ctx, owner.orgId);
  const health = await scoped.provider.health(owner.senderId);
  if (health.state !== 'open') return 0;      // left requested; the next sweep tries again
  const pending = (await scoped.db.execute(sql`
    SELECT id, provider_message_id AS "providerMessageId" FROM message
    WHERE conversation_id = ${conversationId} AND direction = 'inbound' AND read_requested_at IS NOT NULL
      AND read_marked_at IS NULL AND provider_message_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 20`) as unknown as Array<{ id: string; providerMessageId: string }>);
  if (pending.length === 0) return 0;
  const to = (await scoped.db.execute(sql`
    SELECT ci.kind, ci.value_normalized AS "value"
    FROM conversation v JOIN contact_identity ci ON ci.contact_id = v.contact_id AND ci.kind IN ('phone','wa_jid','wa_lid')
    WHERE v.id = ${conversationId}
    ORDER BY CASE ci.kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END, ci.is_primary DESC LIMIT 1`
  ) as unknown as Array<{ kind: string; value: string }>)[0];
  if (to === undefined) return 0;
  const recipient = to.kind === 'phone' ? { phoneE164: to.value } : { phoneE164: '', providerAddress: to.value };
  const done = await markInboundRead(scoped, { id: owner.senderId, phoneE164: '' }, recipient, pending);
  if (done) scoped.logger.info({ senderId: owner.senderId, conversationId, messages: pending.length }, 'an agent opened the chat: its messages were marked read');
  return done ? pending.length : 0;
}

/**
 * Turns campaign recipients into queued messages, a small batch at a time.
 *
 * A campaign does not queue its messages at launch: the `campaign_recipient` rows are the queue, and this
 * converts only as many as the anti-ban policy allows (`campaignBatch`). Everything downstream — the policy in
 * `handleSend` — then applies unchanged, so there is no second path to a provider and no way for a campaign to
 * bypass the gates (M12).
 *
 * It also keeps a campaign from burying an agent's reply: only a small batch of campaign messages is ever
 * sitting in the send queue at once.
 */
export async function dispatchCampaigns(ctx: WorkContext): Promise<number> {
  const counts = await inEachOrg(ctx, (c) => dispatchCampaignsInOrg(c));
  return counts.reduce((a, b) => a + b, 0);
}

/** One org's share of `dispatchCampaigns`, run with a context already pinned to that org. */
async function dispatchCampaignsInOrg(ctx: WorkContext): Promise<number> {
  if (!ctx.kms) return 0;

  const rows = await ctx.db.execute(sql`
    SELECT c.id, c.org_id AS "orgId", c.body, c.sender_identity_id AS "senderIdentityId",
           c.gate_overrides AS "gateOverrides"
    FROM campaign c
    WHERE c.status = 'running'
    ORDER BY c.started_at ASC
    LIMIT 20`);

  const policy = ctx.antiBan ?? defaultPolicy;
  let queued = 0;
  for (const campaign of rows as unknown as Array<{
    id: string; orgId: string; body: string; senderIdentityId: string; gateOverrides: string[];
  }>) {
    const tenant = tenantRunner(ctx, campaign.orgId);

    // What is already waiting for this sender, from any source (a reply an agent typed counts): the policy says how
    // many more campaign messages may join it. Without this a sweep every few seconds would queue the whole audience.
    const waiting = (await ctx.db.execute(sql`
      SELECT count(*)::int AS n
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.sender_identity_id = ${campaign.senderIdentityId} AND m.direction = 'outbound' AND m.status = 'queued'`
    ) as unknown as Array<{ n: number }>)[0]!.n;
    const room = policy.campaignBatch({ senderIdentityId: campaign.senderIdentityId, waiting });

    if (room > 0) {
      // A campaign with an AI template sends what the AI writes for each person: write the next few openings first (no-op otherwise).
      if (ctx.llm !== undefined && ctx.llm.name !== 'none') {
        try { await writeOpenings({ db: ctx.db, kms: ctx.kms, llm: ctx.llm }, { orgId: campaign.orgId, campaignId: campaign.id, limit: Math.min(room, 5) }); }
        catch (error) { ctx.logger.error({ campaignId: campaign.id, err: error instanceof Error ? error.message : String(error) }, 'could not write AI openings'); }
      }
      queued += await dispatchCampaign(tenant, ctx.kms, {
        orgId: campaign.orgId, campaignId: campaign.id,
        senderIdentityId: campaign.senderIdentityId, body: campaign.body, limit: room,
        gateOverrides: campaign.gateOverrides
      });
    }
    await tenant((tx) => reconcileCampaign(tx, campaign.orgId, campaign.id));
  }
  return queued;
}

/**
 * The background half of a key rotation (D-31): moves a small batch of values per org from retired
 * keys onto the current one, every sweep, until nothing is left on an old key.
 *
 * Does nothing at all unless a retired key is configured, so an install that never rotates pays
 * no cost. Honours the operator's pause. Small batches per org keep it from competing with sends.
 * Returns how many values were moved.
 */
export async function sweepKeyRotation(ctx: WorkContext, batch = 100): Promise<number> {
  const kms = ctx.kms;
  if (!kms || kms.knownKeyVersions().length <= 1) return 0;
  const state = (await ctx.db.execute(sql`
    SELECT paused FROM key_rotation_state WHERE id = 1`) as unknown as Array<{ paused: boolean }>)[0];
  if (state?.paused === true) return 0;

  const results = await inEachOrg(ctx, (c) => reencryptBatch(c.db, kms, batch));
  const moved = results.reduce((n, r) => n + r.reencrypted, 0);
  const unreadable = results.reduce((n, r) => n + r.unreadable, 0);
  if (moved > 0 || unreadable > 0) {
    await ctx.db.execute(sql`
      UPDATE key_rotation_state
      SET last_run_at = now(), reencrypted_total = reencrypted_total + ${moved},
          last_unreadable = ${unreadable}, updated_at = now()
      WHERE id = 1`);
    ctx.logger.info({ moved, unreadable }, 'key rotation: re-encrypted a batch onto the current key');
  }
  return moved;
}

/** The v2 policy, used when the context does not bring its own. */
const defaultPolicy: AntiBanPolicy = makeAntiBanPolicy();

/** A tenant-scoped runner for the gateway, which has no request to take one from. */
function tenantRunner(ctx: WorkContext, orgId: string) {
  return <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
    ctx.db.transaction(async (tx) => {
      await setTenant(tx, orgId);
      return work(tx);
    });
}

/**
 * Picks up work left behind while this process was down.
 *
 * The reason the command channel is a durable table and not only a NOTIFY: a notification sent
 * while the gateway was stopped is gone forever, but a queued row is still there.
 */
export async function sweepPendingWork(ctx: WorkContext): Promise<{ links: number; sends: number }> {
  const linkRows = await ctx.db.execute(sql`
    SELECT id FROM channel_session
    WHERE link_requested_at IS NOT NULL AND link_challenge IS NULL
      AND link_requested_at > now() - interval '10 minutes'`);
  const links = (linkRows as unknown as Array<{ id: string }>).map((r) => r.id);
  for (const id of links) await handleLinkRequest(ctx, id);

  // Unlink requests left behind: no time bound — a pending reset must not be lost just because
  // the gateway was down when it was asked for.
  const unlinkRows = await ctx.db.execute(sql`
    SELECT id FROM channel_session WHERE unlink_requested_at IS NOT NULL`);
  for (const r of unlinkRows as unknown as Array<{ id: string }>) await handleUnlinkRequest(ctx, r.id);

  // Chats an agent opened while the gateway was down or the number was disconnected: tell WhatsApp they were read.
  const readRows = await ctx.db.execute(sql`
    SELECT DISTINCT conversation_id AS id FROM message
    WHERE direction = 'inbound' AND read_requested_at IS NOT NULL AND read_marked_at IS NULL AND provider_message_id IS NOT NULL
    LIMIT 50`);
  for (const r of readRows as unknown as Array<{ id: string }>) await handleReadRequest(ctx, r.id);

  // Sends a process lost track of (it died, or the database went, after WhatsApp took them): reported, never sent twice.
  const unconfirmed = await markUnconfirmedSends(ctx.db, clockOf(ctx));
  if (unconfirmed > 0) ctx.logger.error({ unconfirmed }, 'messages handed to WhatsApp were never confirmed: marked send_unconfirmed, not sent again');

  // One lane per number that has something queued. Each lane runs on its own, so a number waiting out a gap never holds up another.
  const laneRows = await ctx.db.execute(sql`
    SELECT DISTINCT v.sender_identity_id AS id
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE m.direction = 'outbound' AND m.status = 'queued'`);
  const results = await Promise.all((laneRows as unknown as Array<{ id: string }>).map((r) => kickLane(ctx, r.id)));
  const sends = results.reduce((n, r) => n + r.sent + r.failed, 0);

  // A key rotation in progress (D-31): a small batch per sweep, never in the way of a send.
  await sweepKeyRotation(ctx);

  // Messages that never got their second tick (F6 S4). Before the dispatcher, so a hold raised here applies to this sweep's campaign batch.
  try {
    await sweepDeliveries(ctx);
  } catch (error) {
    ctx.logger.error({ err: error instanceof Error ? error.message : String(error) }, 'delivery check failed');
  }

  // After sending, not before: a campaign tops the queue up with whatever room the policy gives
  // once this sweep's sends have gone.
  await dispatchCampaigns(ctx);

  try {
    await retryDownNumbers(ctx);
  } catch (error) {
    ctx.logger.error({ err: error instanceof Error ? error.message : String(error) }, 'could not retry numbers that are down');
  }

  return { links: links.length, sends };
}

/** How long a linked number may stay down before the gateway tries it again itself, and how often it tries after that. */
const DOWN_RETRY_MS = 10 * 60_000;
/** When the gateway last tried each number, so a sweep every few seconds tries a down number at most once per `DOWN_RETRY_MS`. */
const downRetriedAt = new Map<string, number>();

/**
 * A safety net under the adapter's own reconnects (R-026): a linked number that has been down for 10 minutes, and that nothing else is
 * bringing back, is tried once, then again every 10 minutes. Never a number that was logged out, refused (403) or opened somewhere
 * else (440): retrying those cannot help and looks like abuse. Before this only a gateway restart brought such a number back.
 */
export async function retryDownNumbers(ctx: WorkContext): Promise<number> {
  const perOrg = await inEachOrg(ctx, async (c) => (await c.db.execute(sql`
    SELECT si.id, si.phone_e164 AS phone
    FROM channel_session cs JOIN sender_identity si ON si.id = cs.sender_identity_id
    WHERE si.status = 'active' AND cs.connection_state = 'closed'
      AND coalesce(cs.disconnect_reason, '') NOT IN ('logged_out', 'forbidden', 'connection_replaced')
      AND cs.link_requested_at IS NULL AND cs.unlink_requested_at IS NULL
      AND cs.updated_at < now() - make_interval(secs => ${DOWN_RETRY_MS / 1000})`)) as unknown as Array<{ id: string; phone: string | null }>);
  let tried = 0;
  const now = Date.now();
  for (const s of perOrg.flat()) {
    if (now - (downRetriedAt.get(s.id) ?? 0) < DOWN_RETRY_MS) continue;
    const health = await ctx.provider.health(s.id);
    if (health.state === 'open' || health.state === 'connecting') continue;
    downRetriedAt.set(s.id, now);
    tried += 1;
    ctx.logger.info({ senderId: s.id }, 'number down for 10 minutes; trying it again');
    try {
      await ctx.provider.connect({ id: s.id, phoneE164: s.phone ?? '' });
    } catch (error) {
      ctx.logger.warn({ senderId: s.id, err: error instanceof Error ? error.message : String(error) }, 'could not bring the number back');
    }
  }
  return tried;
}

/**
 * Reconnects every number that was linked before this process restarted.
 *
 * Credentials live in Postgres precisely so this is possible without anyone scanning a QR
 * again — the previous system needed every session reconnected by hand after each restart
 * (M29/M30).
 *
 * `providers` names which `sender_identity.provider` values this gateway's transport owns: the
 * default is the real thing, and the fake-channel gateway passes `['fake']` so a seeded test number
 * comes up connected while a UI-created one stays unlinked.
 */
export async function restoreSessions(
  ctx: WorkContext, providers: readonly string[] = ['baileys']
): Promise<number> {
  // One query per org, each pinned to it, so a number is only ever listed from inside its own org.
  const perOrg = await inEachOrg(ctx, async (c) => (await c.db.execute(sql`
    SELECT si.id, si.phone_e164 AS phone FROM sender_identity si
    WHERE si.provider IN (${sql.join(providers.map((p) => sql`${p}`), sql`, `)})
      AND si.status = 'active'`)) as unknown as Array<{ id: string; phone: string | null }>);
  const senders = perOrg.flat();

  let restored = 0;
  for (const s of senders) {
    try {
      await ctx.provider.connect({ id: s.id, phoneE164: s.phone ?? '' });
      restored += 1;
      ctx.logger.info({ senderId: s.id }, 'session restored from stored credentials');
    } catch (error) {
      // One number failing to reconnect must not stop the others.
      ctx.logger.warn(
        { senderId: s.id, err: error instanceof Error ? error.message : String(error) },
        'could not restore session'
      );
    }
  }
  return restored;
}

/**
 * Pauses a number's running campaigns and says why. A person resumes them after checking the phone;
 * nothing resumes on its own, so a relink cannot silently carry on a campaign into a banned number.
 */
async function pauseCampaignsFor(ctx: WorkContext, senderId: string, reason: 'ban_suspected' | 'unlinked'): Promise<number> {
  const rows = await ctx.db.execute(sql`
    UPDATE campaign SET status = 'paused', pause_reason = ${reason}, updated_at = now()
    WHERE sender_identity_id = ${senderId} AND status = 'running'
    RETURNING id`);
  return (rows as unknown as unknown[]).length;
}

/**
 * A close with code 403: WhatsApp refused this number. Records one critical timeline event (not one per
 * reconnect attempt: nothing within 30 minutes of the last) that tells the operator to look at the
 * phone first, and pauses the number's running campaigns.
 */
async function suspectBan(
  ctx: WorkContext, senderId: string, kind: 'forbidden', at: Date, evidence: Record<string, unknown>
): Promise<void> {
  const org = (await ctx.db.execute(sql`
    SELECT org_id AS "orgId" FROM sender_identity WHERE id = ${senderId}`
  ) as unknown as Array<{ orgId: string }>)[0];
  if (!org) return;
  const recent = (await ctx.db.execute(sql`
    SELECT 1 FROM sender_health_event
    WHERE sender_identity_id = ${senderId} AND kind = ${`${kind}_suspected`}
      AND at > now() - interval '30 minutes' LIMIT 1`) as unknown as unknown[]).length > 0;
  if (recent) return;
  const paused = await pauseCampaignsFor(ctx, senderId, 'ban_suspected');
  await recordHealthEvent(ctx.db, {
    orgId: org.orgId, senderIdentityId: senderId, kind: `${kind}_suspected`, severity: 'critical', at,
    summary: 'WhatsApp refused this number\'s connection (403), which is the code it uses for bans and '
      + 'blocks. Open WhatsApp on the phone now and look for an "account banned" or "temporarily banned" '
      + `notice before doing anything else. ${paused > 0 ? `${String(paused)} running campaign(s) were paused.` : 'No campaign was running.'}`,
    evidence
  });
  ctx.logger.error({ senderId, paused }, 'WhatsApp refused the number (403) — possible ban, campaigns paused');
}

/**
 * Stores a limit warning WhatsApp sent a number (F6 S2): the raw notice, and the latest of its kind on the number. Then runs the
 * number's lane, because a warning can change what may go: a timelock that ended releases the held messages (AC-2.2), one that
 * began holds new chats (AC-2.1).
 */
export async function applyNoticeEvent(ctx: WorkContext, event: NormalisedNoticeEvent): Promise<void> {
  const orgId = await orgOfSender(ctx, event.senderId);
  if (orgId === null) return;
  const scoped = scopedTo(ctx, orgId);
  await applyWhatsAppNotice(scoped.db, orgId, event.senderId, event);
  scoped.logger.info(
    event.kind === 'timelock'
      ? { senderId: event.senderId, kind: event.kind, active: event.active, until: event.until?.toISOString() ?? null, type: event.enforcementType }
      : { senderId: event.senderId, kind: event.kind, status: event.status, total: event.totalQuota, used: event.usedQuota, cycleEnd: event.cycleEnd?.toISOString() ?? null },
    'WhatsApp limit notice stored'
  );
  await kickLane(ctx, event.senderId);
}

/**
 * Records a connection state change, and promotes or demotes the sender to match.
 *
 * This is the only writer of `channel_session.connection_state`, which is what the UI reads to
 * answer "is this number actually linked?". `sender_identity.status` cannot answer that: it is
 * a business state that says nothing about whether a socket is open.
 */
export async function applyConnectionEvent(
  ctx: WorkContext, event: NormalisedConnectionEvent
): Promise<void> {
  const orgId = await orgOfSender(ctx, event.senderId);
  if (orgId === null) return;
  await applyConnectionEventInOrg(scopedTo(ctx, orgId), event);
}

/** `applyConnectionEvent` once the sender's org is known and the context is pinned to it. */
async function applyConnectionEventInOrg(
  ctx: WorkContext, event: NormalisedConnectionEvent
): Promise<void> {
  const openedAt = event.state === 'open' ? event.at.toISOString() : null;
  // Did a person ask for this unlink? Read before the update below, because an unlink in flight is
  // what tells a deliberate logout from WhatsApp logging the number out on its own.
  const unlinkRow = event.state === 'logged_out'
    ? (await ctx.db.execute(sql`
        SELECT unlink_requested_at AS "at", connection_state AS "previous"
        FROM channel_session
        WHERE sender_identity_id = ${event.senderId}`) as unknown as Array<{ at: string | null; previous: string | null }>)[0]
    : undefined;
  const deliberateUnlink = unlinkRow?.at !== null && unlinkRow?.at !== undefined;
  const alreadyLoggedOut = unlinkRow?.previous === 'logged_out';

  await ctx.db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, connection_state, disconnect_reason, last_connected_at)
    VALUES (${event.senderId}, ${event.state}, ${event.reason}, ${openedAt})
    ON CONFLICT (sender_identity_id) DO UPDATE
      SET connection_state = ${event.state},
          disconnect_reason = ${event.reason},
          last_connected_at = COALESCE(${openedAt}, channel_session.last_connected_at),
          updated_at = now()`);

  // A completed link has no further use for the challenge, and leaving it behind would let the UI keep offering a QR for a number that is
  // already connected. Same for the request itself: left set, the sweep kept asking for a link on a number that was already connected,
  // and each attempt disturbed the live session. Its own statement, run only on open: `channel_session_link_requested` fires on any SET of
  // `link_requested_at`, even to the same value, so writing it on every event re-sent a pending link to the gateway (R-014).
  if (event.state === 'open') {
    await ctx.db.execute(sql`
      UPDATE channel_session
      SET link_challenge = NULL, link_requested_at = NULL, link_requested_mode = NULL, link_requested_phone = NULL,
          link_error = NULL, qr_expires_at = NULL
      WHERE sender_identity_id = ${event.senderId}`);
  }

  // 403 is the code WhatsApp uses when it refuses a number outright (a ban or a block). It arrives as a
  // plain close, not a logout, so it needs its own branch: say so loudly and stop the campaigns.
  if (event.code === 403) {
    await suspectBan(ctx, event.senderId, 'forbidden', event.at, { code: 403, reason: event.reason });
  }

  if (event.state === 'open') {
    // The first open after a link starts the clock for the "new number, go gentle" hint (F6 AC-2.5, AC-7.6).
    await ctx.db.execute(sql`
      UPDATE channel_session SET linked_since = ${event.at.toISOString()}
      WHERE sender_identity_id = ${event.senderId} AND linked_since IS NULL`);
    // Promote on first successful connection. Until this existed only the wa:link script set
    // 'active', so a number linked through the API stayed 'linking' forever and POST /messages
    // kept answering NO_ACTIVE_SENDER.
    await ctx.db.execute(sql`
      UPDATE sender_identity
      SET status = 'active', updated_at = now()
      WHERE id = ${event.senderId} AND status = 'linking'`);

    // Record the number this connection belongs to, so a linked number is not left reading "no number
    // yet". Only fills a blank (a number someone typed in stays as typed), and only when no other number
    // of this org already has that phone, which the unique index would otherwise reject.
    if (event.phoneE164 !== undefined && event.phoneE164 !== null) {
      await ctx.db.execute(sql`
        UPDATE sender_identity si
        SET phone_e164 = ${event.phoneE164}, updated_at = now()
        WHERE si.id = ${event.senderId} AND si.phone_e164 IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM sender_identity o
            WHERE o.org_id = si.org_id AND o.provider = si.provider AND o.phone_e164 = ${event.phoneE164})`);
    }
  }

  if (event.state === 'logged_out') {
    await ctx.db.execute(sql`UPDATE channel_session SET linked_since = NULL WHERE sender_identity_id = ${event.senderId}`);
    // Terminal: the number was unlinked from the phone. Say so rather than leaving it looking
    // active, which would keep the dispatcher queueing sends that can never leave. Deliberately
    // *not* auto-retired: a genuine 401 ban and a user-initiated unlink look identical at the
    // socket, and retiring a number the operator just unlinked would be wrong.
    await ctx.db.execute(sql`
      UPDATE sender_identity SET status = 'linking', updated_at = now()
      WHERE id = ${event.senderId}`);

    // Nobody asked for this logout, so WhatsApp ended the session: that is what a ban looks like from
    // the socket (and also what unlinking from the phone looks like). Say so on the timeline instead
    // of letting the number quietly turn up as "not connected".
    // WhatsApp ended this session, so the stored credentials are dead. Clear them now, so the next
    // Link starts clean instead of retrying a login that can only fail.
    if (!deliberateUnlink && !alreadyLoggedOut) {
      await ctx.provider.logout(event.senderId).catch(() => undefined);
    }

    // Say it once per logout. A failed re-login on the same dead session reports `logged_out` again,
    // and recording each one buried the real signal under a pile of identical "possible ban" alarms.
    // `device_removed` is WhatsApp saying the device was taken off the phone's Linked devices list: an unlink, not a ban (a ban
    // comes as a 403). It gets its own calm event, so the page does not shout "possible ban" at someone who just unlinked it.
    if (event.detail === 'device_removed' && !deliberateUnlink && !alreadyLoggedOut) {
      const org = (await ctx.db.execute(sql`
        SELECT org_id AS "orgId" FROM sender_identity WHERE id = ${event.senderId}`
      ) as unknown as Array<{ orgId: string }>)[0];
      if (org) {
        await recordHealthEvent(ctx.db, {
          orgId: org.orgId, senderIdentityId: event.senderId, kind: 'unlinked_on_phone',
          severity: 'warning', at: event.at,
          summary: 'This device was removed under Linked devices on the phone (WhatsApp: device_removed). That is an '
            + 'unlink, not a ban; a ban comes as a 403. Link it again once, from this page.',
          evidence: { code: event.code ?? null, reason: event.reason, detail: event.detail }
        });
        ctx.logger.info({ senderId: event.senderId }, 'number removed from Linked devices on the phone');
        await pauseCampaignsFor(ctx, event.senderId, 'unlinked');
      }
    }

    const recent = (await ctx.db.execute(sql`
      SELECT 1 FROM sender_health_event
      WHERE sender_identity_id = ${event.senderId} AND kind = 'hard_ban_suspected'
        AND at > now() - interval '30 minutes' LIMIT 1`) as unknown as unknown[]).length > 0;
    if (event.detail !== 'device_removed' && !deliberateUnlink && !alreadyLoggedOut && !recent) {
      const org = (await ctx.db.execute(sql`
        SELECT org_id AS "orgId" FROM sender_identity WHERE id = ${event.senderId}`
      ) as unknown as Array<{ orgId: string }>)[0];
      if (org) {
        await recordHealthEvent(ctx.db, {
          orgId: org.orgId, senderIdentityId: event.senderId, kind: 'hard_ban_suspected',
          severity: 'critical', at: event.at,
          summary: 'WhatsApp logged this number out without being asked. That is either a ban or someone '
            + 'unlinking it on the phone. Check the phone, and do not relink in a hurry.',
          evidence: { code: event.code ?? null, reason: event.reason }
        });
        ctx.logger.error({ senderId: event.senderId }, 'number logged out by WhatsApp — possible ban');
        await pauseCampaignsFor(ctx, event.senderId, 'ban_suspected');
      }
    }
  }

  ctx.logger.info(
    { senderId: event.senderId, state: event.state, reason: event.reason },
    'connection state changed'
  );
}

/**
 * Marks every session closed. Run at boot and at shutdown.
 *
 * `connection_state` describes a socket held by *this* process, so it is meaningless the
 * moment the process is not running — yet it would sit at `'open'` forever, and the UI would
 * cheerfully report a number as connected with no gateway alive. Running it at boot also
 * covers the case a graceful shutdown cannot: a crash or a `kill -9`, where nothing gets the
 * chance to tidy up. Anything genuinely reachable is set back to `'open'` seconds later as
 * `restoreSessions()` reconnects it.
 */
export async function markAllSessionsClosed(ctx: WorkContext): Promise<number> {
  const counts = await inEachOrg(ctx, async (c) => {
    const rows = await c.db.execute(sql`
      UPDATE channel_session
      SET connection_state = 'closed', updated_at = now()
      WHERE connection_state <> 'closed'
      RETURNING sender_identity_id`);
    return (rows as unknown as unknown[]).length;
  });
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * The address of a conversation's contact in the form the provider takes, the same pick the lane makes (phone first, then the
 * WhatsApp address). Null when the contact has no way to be reached.
 */
async function recipientOfConversation(ctx: WorkContext, conversationId: string): Promise<Recipient | null> {
  const to = (await ctx.db.execute(sql`
    SELECT ci.kind, ci.value_normalized AS "value"
    FROM conversation v JOIN contact_identity ci ON ci.contact_id = v.contact_id AND ci.kind IN ('phone','wa_jid','wa_lid')
    WHERE v.id = ${conversationId}
    ORDER BY CASE ci.kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END, ci.is_primary DESC LIMIT 1`
  ) as unknown as Array<{ kind: string; value: string }>)[0];
  if (to === undefined) return null;
  return to.kind === 'phone' ? { phoneE164: to.value } : { phoneE164: '', providerAddress: to.value };
}

/**
 * Applies a delivery receipt (F6 S4, S5). A failed ack marks the message failed; anything else moves its status forward. A delivered or
 * read receipt then does two more things: it lifts the hold on new sends to that contact if it came after their retry request (AC-5.2),
 * and it takes a snapshot of what their profile photo and about look like, at most once a day (AC-4.2), for the sweep to compare with.
 */
export async function applyStatusEvent(ctx: WorkContext, event: NormalisedStatusEvent): Promise<void> {
  const orgId = await orgOfSender(ctx, event.senderId);
  if (orgId === null) return;
  const scoped = scopedTo(ctx, orgId);
  if (event.status === 'failed') {
    await markMessageFailedByProviderId(scoped.db, orgId, event.providerMessageId, 'delivery_error');
    return;
  }
  await applyDeliveryStatus(scoped.db, orgId, event.providerMessageId, event.status);
  if (event.status !== 'delivered' && event.status !== 'read') return;

  if (await liftRetryOnReceipt(scoped.db, event.providerMessageId, event.at)) {
    scoped.logger.info({ senderId: event.senderId, providerMessageId: event.providerMessageId }, 'the contact\'s phone can read us again: the hold on new sends to them is lifted');
    await kickLane(ctx, event.senderId);
  }

  const profile = scoped.provider.profileSnapshot?.bind(scoped.provider);
  if (profile === undefined) return;
  const found = await conversationOfSent(scoped.db, event.providerMessageId);
  if (found === null) return;
  const now = clockOf(scoped);
  if (!(await snapshotDue(scoped.db, found.conversationId, now))) return;
  const to = await recipientOfConversation(scoped, found.conversationId);
  if (to === null) return;
  try {
    const seen = await profile({ id: event.senderId, phoneE164: '' }, to);
    if (seen !== null) await saveSnapshot(scoped.db, found.conversationId, seen, now);
  } catch (error) {
    scoped.logger.warn({ senderId: event.senderId, err: error instanceof Error ? error.message : String(error) }, 'could not take a profile snapshot at a delivery');
  }
}

/** The context's clock. */
const clockOf = (ctx: WorkContext): Date => (ctx.now ?? (() => new Date()))();

/**
 * A contact's phone asked for one of our messages again (F6 S5). The provider sends it again itself; here every new send to that
 * contact is held (AC-5.1). The second request for the same message means the session with that contact is out of step: it is
 * recreated, and the composer's existing warning about a broken encryption session is raised (AC-5.3). Retries from three contacts
 * within ten minutes hold the whole number (AC-5.4).
 */
export async function applyRetryEvent(ctx: WorkContext, event: NormalisedRetryEvent): Promise<void> {
  const orgId = await orgOfSender(ctx, event.senderId);
  if (orgId === null) return;
  const scoped = scopedTo(ctx, orgId);
  const outcome = await registerRetryRequest(scoped.db, event.senderId, event.providerMessageId, event.at);
  if (outcome === null) {
    // Only a message this CRM sent is worth a hold. A retry request for one the owner typed on their phone is not ours to answer.
    scoped.logger.debug({ senderId: event.senderId, messageId: event.providerMessageId }, 'a retry request for a message this CRM did not send');
    return;
  }
  scoped.logger.warn({
    senderId: event.senderId, messageId: event.providerMessageId, conversationId: outcome.conversationId, retries: outcome.retries
  }, 'the recipient\'s phone could not decrypt a message and asked for it again: new sends to them are held');

  if (outcome.resetSession) {
    await markDecryptBurst(scoped.db, event.senderId, event.at);
    const reset = scoped.provider.resetSession?.bind(scoped.provider);
    const to = await recipientOfConversation(scoped, outcome.conversationId);
    if (reset !== undefined && to !== null) {
      try {
        await reset({ id: event.senderId, phoneE164: '' }, to);
        scoped.logger.warn({ senderId: event.senderId, conversationId: outcome.conversationId }, 'asked twice for the same message: the encryption session with this contact was recreated');
      } catch (error) {
        scoped.logger.error({ senderId: event.senderId, err: error instanceof Error ? error.message : String(error) }, 'could not recreate the encryption session with this contact');
      }
    }
  }
  if (outcome.waveStarted) {
    scoped.logger.error({ senderId: event.senderId }, 'retries from several contacts in a few minutes: the whole number is held until it is linked again');
  }
}

/**
 * The sweep for messages that never got their second tick (F6 S4), for every number: judges what has been at one tick for 30 minutes,
 * holds or releases the number's campaigns by how many are stuck, and runs the lane again when a hold was released. Profile lookups
 * only happen on a connected number, a few per pass.
 */
export async function sweepDeliveries(ctx: WorkContext): Promise<number> {
  const counts = await inEachOrg(ctx, async (scoped) => {
    let judged = 0;
    const senders = (await scoped.db.execute(sql`SELECT id, org_id AS "orgId" FROM sender_identity`)) as unknown as Array<{ id: string; orgId: string }>;
    for (const s of senders) {
      const now = clockOf(scoped);
      const profile = scoped.provider.profileSnapshot?.bind(scoped.provider);
      const open = profile !== undefined && (await scoped.provider.health(s.id)).state === 'open';
      const probe: ProbeFn = async (conversationId) => {
        if (!open || profile === undefined) return null;
        const to = await recipientOfConversation(scoped, conversationId);
        return to === null ? null : profile({ id: s.id, phoneE164: '' }, to);
      };
      const result = await checkUnreached(scoped.db, { senderIdentityId: s.id, now, probe });
      judged += result.judged;
      if (result.likelyBlocked > 0) {
        scoped.logger.warn({ senderId: s.id, contacts: result.likelyBlocked }, 'contacts probably blocked this number: campaigns and the AI stop messaging them');
      }
      const review = await reviewManyUndelivered(scoped.db, { orgId: s.orgId, senderIdentityId: s.id, now });
      if (review.change === 'hold') scoped.logger.error({ senderId: s.id, stuck: review.stuck }, 'many messages are not reaching people: the number\'s campaigns are on hold');
      if (review.change === 'lift') {
        scoped.logger.info({ senderId: s.id, stuck: review.stuck }, 'messages are reaching people again: the hold on the number\'s campaigns is lifted');
        await kickLane(ctx, s.id);
      }
    }
    return judged;
  });
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * What to do about a message a contact just sent, once it is stored (F6 S5, S6): a message that decrypts clears the holds that only
 * a silent contact would have (a retry not yet resolved, a probable block); then the message is read for an opt-out or a restart. An
 * opt-out queues the one closing message and runs the lane, so it goes at reply priority at once. Needs the key service in the context,
 * and uses the AI driver, when there is one, to read intent.
 */
export async function applyInboundEffects(ctx: WorkContext, input: {
  readonly senderId: string; readonly conversationId: string; readonly messageId: string | null; readonly body: string; readonly contentType: string
}): Promise<InboundSafetyResult> {
  const orgId = await orgOfSender(ctx, input.senderId);
  if (orgId === null) return { outcome: 'none', closingMessageId: null, via: null };
  const scoped = scopedTo(ctx, orgId);
  if (await contactWroteAgain(scoped.db, input.conversationId)) {
    scoped.logger.info({ senderId: input.senderId, conversationId: input.conversationId }, 'the contact wrote to us: the hold for a retry or a probable block is lifted');
    await kickLane(ctx, input.senderId);
  }
  if (scoped.kms === undefined) return { outcome: 'none', closingMessageId: null, via: null };
  const result = await handleInboundSafety(
    { db: scoped.db, kms: scoped.kms, ...(scoped.llm === undefined ? {} : { llm: scoped.llm }), now: () => clockOf(scoped) },
    { orgId, conversationId: input.conversationId, body: input.body, contentType: input.contentType }
  );
  if (result.outcome !== 'none') {
    scoped.logger.info({ senderId: input.senderId, conversationId: input.conversationId, outcome: result.outcome, via: result.via, closingMessageId: result.closingMessageId }, 'opt-out handled');
  }
  if (result.closingMessageId !== null) await kickLane(ctx, input.senderId);
  return result;
}
