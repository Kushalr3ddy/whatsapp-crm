import { sql } from 'drizzle-orm';
import { setTenant, type Database, type Transaction } from '@crm/db';
import { tenantDatabase } from './tenant.js';
import type { ChannelProvider, NormalisedConnectionEvent } from '@crm/channels';
import {
  classifyLinkFailure, encodeLinkError,
  markMessageFailed, markMessageSent, checkSendAllowance, checkContactGraph,
  scoreConnectedSenders, dispatchCampaign, reconcileCampaign, dailyCeiling, typingDelayMs,
  recoveryState, beginRecovery, deliveryDelayMultiplier, type RecoveryIncident,
  type ReplyFloorConfig, readIsDue, circadianActivity, localHour, entropyPlan, type EntropyScheduler,
  timezoneForPhone, circadianDelayMs, CIRCADIAN_QUIET_THRESHOLD, checkRestriction, recordHealthEvent,
  reencryptBatch
} from '@crm/core';
import type { Logger } from '@crm/shared';
import type { KmsDriver } from '@crm/kms-local';
import type { StorageDriver } from '@crm/storage';

/** A queued outbound message, joined to everything needed to actually send it. */
interface QueuedSend {
  readonly messageId: string;
  readonly orgId: string;
  readonly senderIdentityId: string;
  readonly senderPhone: string | null;
  /** The sender's health status, so a quarantined number does not send. */
  readonly senderStatus: string;
  /** `enforce` (default) or `advisory` (D-29: holds are recorded as warnings, not obeyed). */
  readonly enforcement: string;
  /** Who the message is to, for the contact-graph gate's relationship lookup. */
  readonly contactId: string;
  /** Flagged do-not-contact; refused unless an admin overrode it for this message (`dncOverride`). */
  readonly doNotContact: boolean;
  readonly dncOverride: boolean;
  readonly recipientValue: string;
  readonly recipientKind: string;
  readonly bodyEnc: Uint8Array | null;
  /** The attachment this message carries (D-25), or null for plain text. */
  readonly mediaStorageKey: string | null;
  readonly mediaContentType: string | null;
  readonly mediaFilename: string | null;
  /** Pacing inputs, read with the job so the gate costs no extra round trip. */
  readonly warmupStartedAt: string | null;
  readonly dailyCapOverride: number | null;
  /** When the sender last received an inbound, or null if never — drives the outbound-only clamp. */
  readonly lastInboundAt: string | null;
  /** When the socket last (re)opened, for the post-reconnect ramp. */
  readonly lastConnectedAt: string | null;
  /** Layer 6 recovery state, read with the job: the incident class and when its pause ends. */
  readonly recoveryIncident: string | null;
  readonly recoveryUntil: string | null;
  /** `ok` | `suspected` | `likely` — the silent-restriction detector's verdict for this number. */
  readonly restrictionState: string;
  /** The sender's recent delivery ratio (from `health`), for the Layer 5 adaptive-speed curve. */
  readonly deliveryRatio: number;
}

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
  readonly provider: ChannelProvider;
  readonly logger: Logger;
  /** Decrypts a stored message body back to text for sending. */
  readonly decrypt: (cipher: Uint8Array) => string;
  /**
   * Send ceilings, from config. Present so the anti-ban gate is configurable per deployment
   * without a code change, and so tests can drive it to its limits in a few sends rather than
   * fifteen hundred.
   */
  readonly limits: {
    readonly perMinute: number;
    readonly perDay: number;
    /** Most identical message bodies a sender may hold per 24h (Layer 3 / D-26). Absent = no cap. */
    readonly identicalBodyCap?: number;
    /** Circadian pacing timezone, or null to leave the send cadence flat (layers 1–2 only). */
    readonly circadianTimezone?: string | null;
  };
  /**
   * Contact-graph caps on starting new stranger conversations, or null to skip the relationship
   * gate entirely. Opt-in like circadian pacing so tests that do not exercise it are unaffected.
   */
  readonly contactGraph?: {
    readonly newContactsPerHour: number;
    readonly newContactsPerDay: number;
    readonly replyFloor?: ReplyFloorConfig;
  } | null;
  /**
   * Emit a `composing` presence and pause a human-like beat before each send (docs/08-antiban.md,
   * D-24). Opt-in like circadian and the contact-graph gate, so tests that do not exercise it are
   * unaffected and add no real delay. Cosmetic anti-ban — a failure to signal presence never fails
   * the send.
   */
  readonly typingSimulation?: boolean;
  /**
   * Mark inbound messages read after a human-like 10–60 minute delay, in active hours only
   * (docs/08-antiban.md, Layer 3). Opt-in like the other behaviour layers, so tests that do not
   * exercise it never see a read receipt.
   */
  readonly readReceipts?: boolean;
  /**
   * The restricted role tenant-scoped work drops to (`crm_app`), as resolved at startup by
   * `resolveTenantRole`. Null or absent when the connecting role is already subject to row-level
   * security, or in tests that run as a superuser and only need the org set (D-41).
   */
  readonly tenantRole?: string | null;
  /** How many of the oldest queued messages one sweep attempts. Default 200; the simulation lowers it. */
  readonly sweepBatchSize?: number;
  /** Minimum gap between restriction sweeps. Default 60 000 ms; tests pass 0. */
  readonly restrictionSweepEveryMs?: number;
  /**
   * Where stored files live, so a queued message that carries one can be read back and sent
   * (D-25). Absent in tests that only send text; a media message with no storage fails visibly.
   */
  readonly storage?: StorageDriver;
  /**
   * Also respect the *recipient's* day, inferred from their phone number's country: a send to
   * someone in their small hours is deferred, and one in their shoulders is slowed. Only ever
   * adds caution. Needs `limits.circadianTimezone` (the sender's own zone) to be set too.
   */
  readonly recipientTimezone?: boolean;
  /**
   * Background presence noise while idle (docs/08-antiban.md, Layer 3). Present = on: the
   * scheduler decides per number when an event is due (every 2–6 h). Absent in tests that do not
   * exercise it.
   */
  readonly entropy?: EntropyScheduler;
  /**
   * Waits before a send. Injected so tests do not spend real seconds on jitter — production
   * passes a real sleep, and skipping it entirely would defeat the point of the jitter.
   */
  readonly sleep?: (ms: number) => Promise<void>;
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
 * One background noise event for a connected number: an abandoned "typing…" to a contact who has
 * replied (never to a stranger — typing at someone who never wrote back is itself odd), then a
 * brief available→unavailable presence blip. Strictly cosmetic and best-effort: every call is
 * swallowed on failure and nothing here can affect a send.
 */
export async function runEntropyEvent(
  ctx: WorkContext, senderId: string, senderPhone: string,
  rng: () => number = Math.random
): Promise<void> {
  if (!ctx.provider.presence) return;
  const plan = entropyPlan(rng);
  const sender = { id: senderId, phoneE164: senderPhone };
  const sleep = ctx.sleep ?? (async () => {});
  try {
    if (ctx.provider.typing) {
      const rows = await ctx.db.execute(sql`
        SELECT ci.value_normalized AS "value", ci.kind AS "kind"
        FROM conversation v
        JOIN contact_identity ci ON ci.contact_id = v.contact_id AND ci.kind IN ('phone','wa_jid','wa_lid')
        WHERE v.sender_identity_id = ${senderId} AND v.last_inbound_at IS NOT NULL
        ORDER BY v.last_inbound_at DESC, CASE ci.kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END
        LIMIT 1`);
      const target = (rows as unknown as Array<{ value: string; kind: string }>)[0];
      if (target) {
        const to = target.kind === 'phone'
          ? { phoneE164: target.value } : { phoneE164: '', providerAddress: target.value };
        await ctx.provider.typing(sender, to, 'composing');
        await sleep(plan.typingMs);
        await ctx.provider.typing(sender, to, 'paused');      // started typing, changed their mind
      }
    }
    if (await ctx.provider.presence(sender, 'available')) {
      await sleep(plan.presenceMs);
      await ctx.provider.presence(sender, 'unavailable');
    }
  } catch (err) {
    ctx.logger.warn({ err, senderId }, 'background entropy event failed');
  }
}

/**
 * Fires whichever numbers' noise events are due, in active hours only. The events themselves take
 * tens of seconds (typing, then a presence blip), so they run detached rather than holding up the
 * send sweep; each is best-effort and logs its own failure.
 */
export async function sweepEntropy(ctx: WorkContext, now: Date = new Date()): Promise<number> {
  if (!ctx.entropy) return 0;
  const counts = await inEachOrg(ctx, (c) => sweepEntropyInOrg(c, now));
  return counts.reduce((a, b) => a + b, 0);
}

/** One org's share of `sweepEntropy`, run with a context already pinned to that org. */
async function sweepEntropyInOrg(ctx: WorkContext, now: Date): Promise<number> {
  if (!ctx.entropy) return 0;
  const tz = ctx.limits?.circadianTimezone ?? null;
  if (tz && circadianActivity(localHour(now, tz)) < 0.5) return 0;
  const rows = await ctx.db.execute(sql`
    SELECT si.id AS "id", si.phone_e164 AS "phone"
    FROM sender_identity si JOIN channel_session cs ON cs.sender_identity_id = si.id
    WHERE si.status IN ('active','degraded') AND cs.connection_state = 'open'`);
  let fired = 0;
  for (const r of rows as unknown as Array<{ id: string; phone: string | null }>) {
    if (!ctx.entropy.due(r.id, now)) continue;
    fired++;
    void runEntropyEvent(ctx, r.id, r.phone ?? '');
  }
  return fired;
}

/**
 * Sends the read receipts that have come due (Layer 3 read behaviour).
 *
 * An inbound message is marked read only after its own 10–60 minute delay and only in the
 * number's active hours, and at most a few per sender per sweep, so a backlog can never be
 * blue-ticked in one burst. `read_at` on an inbound message records "we sent the receipt"; it is
 * set only after the provider confirms, so a closed socket leaves the message to be tried again.
 */
export async function sweepReadReceipts(ctx: WorkContext, now: Date = new Date()): Promise<number> {
  if (!ctx.readReceipts || !ctx.provider.markRead) return 0;
  const counts = await inEachOrg(ctx, (c) => sweepReadReceiptsInOrg(c, now));
  return counts.reduce((a, b) => a + b, 0);
}

/** One org's share of `sweepReadReceipts`, run with a context already pinned to that org. */
async function sweepReadReceiptsInOrg(ctx: WorkContext, now: Date): Promise<number> {
  if (!ctx.readReceipts || !ctx.provider.markRead) return 0;
  const tz = ctx.limits?.circadianTimezone ?? null;
  const activity = tz ? circadianActivity(localHour(now, tz)) : null;
  if (activity !== null && activity < 0.5) return 0;       // quiet hours: nobody reads at 4 a.m.

  const rows = await ctx.db.execute(sql`
    SELECT m.id AS "messageId", m.provider_message_id AS "providerMessageId",
           m.created_at AS "receivedAt", si.id AS "senderId", si.phone_e164 AS "senderPhone",
           ci.value_normalized AS "recipientValue", ci.kind AS "recipientKind"
    FROM message m
    JOIN conversation v ON v.id = m.conversation_id
    JOIN sender_identity si ON si.id = v.sender_identity_id
    JOIN LATERAL (
      SELECT value_normalized, kind FROM contact_identity
      WHERE contact_id = v.contact_id AND kind IN ('phone','wa_jid','wa_lid')
      ORDER BY CASE kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END, is_primary DESC
      LIMIT 1
    ) ci ON true
    WHERE m.direction = 'inbound' AND m.read_at IS NULL
      AND m.created_at > ${now.toISOString()}::timestamptz - interval '24 hours'
      AND m.created_at < ${now.toISOString()}::timestamptz - interval '10 minutes'
      AND si.status IN ('active','degraded')
    ORDER BY m.created_at ASC
    LIMIT 200`);

  const perSender = new Map<string, number>();
  let sent = 0;
  for (const r of rows as unknown as Array<{
    messageId: string; providerMessageId: string; receivedAt: string; senderId: string;
    senderPhone: string | null; recipientValue: string; recipientKind: string;
  }>) {
    if ((perSender.get(r.senderId) ?? 0) >= 3) continue;   // a trickle, never a burst
    if (!readIsDue(r.messageId, new Date(r.receivedAt), now, activity)) continue;
    const recipient = r.recipientKind === 'phone'
      ? { phoneE164: r.recipientValue }
      : { phoneE164: '', providerAddress: r.recipientValue };
    try {
      const ok = await ctx.provider.markRead(
        { id: r.senderId, phoneE164: r.senderPhone ?? '' }, recipient, r.providerMessageId
      );
      if (!ok) continue;                                    // socket closed: try again next sweep
      await ctx.db.execute(sql`UPDATE message SET read_at = ${now.toISOString()}::timestamptz WHERE id = ${r.messageId}`);
      perSender.set(r.senderId, (perSender.get(r.senderId) ?? 0) + 1);
      sent++;
    } catch (err) {
      // Cosmetic and best-effort: never let a refused receipt disturb the sweep.
      ctx.logger.warn({ err, messageId: r.messageId }, 'read receipt failed');
    }
  }
  return sent;
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
      unlink_requested_at = NULL, updated_at = now()
    WHERE id = ${sessionId}`);
  await ctx.db.execute(sql`
    UPDATE sender_identity SET status = 'linking', updated_at = now()
    WHERE id = ${row.senderIdentityId}`);
  ctx.logger.info({ senderId: row.senderIdentityId }, 'number unlinked; credentials cleared');
}

/**
 * Messages this process is handling right now. A message can reach `handleSend` from the NOTIFY,
 * from the sweep, and (below) from its own retry timer, and each call sleeps a jittered pause
 * before sending: without this a second caller arriving during the pause would send it twice.
 * In-process only; a second gateway process would need a database claim, which there is none of.
 */
const inFlight = new Set<string>();

/** Pending "try this held message again at the moment its gate clears" timers, by message id. */
const retryTimers = new Map<string, NodeJS.Timeout>();

/** Never retry sooner than this, or later than this: past it, the safety-net sweep is as good. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 15 * 60_000;

/**
 * Re-runs a held message when its gate says it will clear, instead of leaving it for the next
 * sweep (default 60 s). Purely a latency win: the gate is re-checked in full when the timer fires
 * and holds again if it still must, so this can never send something the gates would refuse.
 * A little random spread keeps a queue of messages that all clear together from stampeding.
 * Timers are unref'd, so they never keep a stopping process alive; the sweep stays the net.
 */
export function scheduleRetry(ctx: WorkContext, messageId: string, afterMs: number): void {
  const delay = Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, afterMs)) + Math.floor(Math.random() * 750);
  const existing = retryTimers.get(messageId);
  if (existing !== undefined) clearTimeout(existing);
  const timer = setTimeout(() => {
    retryTimers.delete(messageId);
    handleSend(ctx, messageId).catch((error: unknown) => {
      ctx.logger.error(
        { messageId, err: error instanceof Error ? error.message : String(error) },
        'scheduled retry of a held message failed'
      );
    });
  }, delay);
  timer.unref();
  retryTimers.set(messageId, timer);
}

/**
 * Sends one queued message.
 *
 * Every failure is recorded against that message and nothing else. In the previous system one
 * unsendable recipient threw and took down the whole engine, so the watchdog restarted it, the
 * operator retried, and it died again — a permanent crash loop for a single contact
 * (docs/00-prior-art.md, M26).
 *
 * There is no retry here yet, deliberately. Retrying into WhatsApp is exactly how a number gets
 * banned, so it belongs in the dispatcher with the rest of the pacing (P6) rather than in a
 * loop that has no idea how fast it is going.
 */
export async function handleSend(ctx: WorkContext, messageId: string): Promise<void> {
  if (inFlight.has(messageId)) return;
  inFlight.add(messageId);
  try {
    // One send decision at a time per number. The allowance check counts what has already *left*,
    // and a send does not count until after its pause, so two messages checked at once both see
    // the same headroom and both go: a queue whose holds clear together (or a NOTIFY landing
    // beside a sweep) overshoots the ceiling. Serialising per number makes check-then-send
    // atomic, which is also the human cadence the pacing is trying to produce.
    const owner = (await ctx.db.execute(sql`
      SELECT v.sender_identity_id AS "senderId", m.org_id AS "orgId"
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE m.id = ${messageId}`) as unknown as Array<{ senderId: string; orgId: string }>)[0];
    if (owner === undefined) return;
    // Everything from here on runs pinned to the message's own org (D-41).
    const scoped = scopedTo(ctx, owner.orgId);
    await withSenderLock(owner.senderId, () => handleSendOnce(scoped, messageId));
  } finally {
    inFlight.delete(messageId);
  }
}

/** The tail of each number's send queue, so the next send for that number waits its turn. */
const senderLocks = new Map<string, Promise<void>>();

/**
 * Runs `work` after every earlier piece of work for the same sender has finished, whether it
 * succeeded or threw. The map entry is dropped once the chain goes idle, so it cannot grow.
 */
async function withSenderLock(senderId: string, work: () => Promise<void>): Promise<void> {
  const previous = senderLocks.get(senderId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  senderLocks.set(senderId, tail);
  await previous.catch(() => undefined);
  try {
    await work();
  } finally {
    release();
    if (senderLocks.get(senderId) === tail) senderLocks.delete(senderId);
  }
}

/** The body of `handleSend`, run at most once at a time per message. */
async function handleSendOnce(ctx: WorkContext, messageId: string): Promise<void> {
  const rows = await ctx.db.execute(sql`
    SELECT m.id AS "messageId", m.org_id AS "orgId", m.body_enc AS "bodyEnc",
           ma.storage_key AS "mediaStorageKey", ma.content_type AS "mediaContentType",
           ma.filename AS "mediaFilename",
           si.id AS "senderIdentityId", si.phone_e164 AS "senderPhone",
           si.status AS "senderStatus", si.enforcement AS "enforcement",
           si.warmup_started_at AS "warmupStartedAt",
           si.daily_cap_override AS "dailyCapOverride",
           si.last_inbound_at AS "lastInboundAt",
           cs.last_connected_at AS "lastConnectedAt",
           si.recovery_incident AS "recoveryIncident",
           si.recovery_until AS "recoveryUntil", si.restriction_state AS "restrictionState",
           COALESCE((si.health->>'deliveryRatio')::float, 1) AS "deliveryRatio",
           v.contact_id AS "contactId", ct.do_not_contact AS "doNotContact",
           m.dnc_override AS "dncOverride",
           ci.value_normalized AS "recipientValue", ci.kind AS "recipientKind"
    FROM message m
    JOIN conversation v   ON v.id = m.conversation_id
    JOIN contact ct       ON ct.id = v.contact_id
    JOIN sender_identity si ON si.id = v.sender_identity_id
    LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
    LEFT JOIN media_asset ma ON ma.id = m.media_id AND ma.org_id = m.org_id
    JOIN contact_identity ci ON ci.contact_id = v.contact_id
                            AND ci.kind IN ('phone','wa_jid','wa_lid')
    WHERE m.id = ${messageId} AND m.direction = 'outbound' AND m.status = 'queued'
    ORDER BY CASE ci.kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END,
             ci.is_primary DESC
    LIMIT 1`);
  const job = (rows as unknown as QueuedSend[])[0];
  if (!job) return;                     // already sent, cancelled, or has no reachable identity

  if (job.bodyEnc === null) {
    await markMessageFailed(ctx.db, messageId, 'empty_body');
    return;
  }

  // The last line of the do-not-contact gate. It is checked when a message is created, but a contact
  // can be flagged after that, and advisory mode relaxes only number-protecting holds — never this.
  // Only an admin's explicit, audited per-message override lets it through.
  if (job.doNotContact && !job.dncOverride) {
    await markMessageFailed(ctx.db, messageId, 'do_not_contact');
    return;
  }

  // Why this message is still waiting, shown in the thread as "waiting: reason". Written each time
  // the gateway leaves it queued; cleared when it sends. Best-effort: never blocks the send path.
  const hold = async (reason: string): Promise<void> => {
    await ctx.db.execute(sql`
      UPDATE message SET hold_reason = ${reason}
      WHERE id = ${messageId} AND hold_reason IS DISTINCT FROM ${reason}`).catch(() => undefined);
  };

  try {
    const health = await ctx.provider.health(job.senderIdentityId);
    if (health.state !== 'open') {
      // Leave it queued rather than failing it: the boot sweep will pick it up once the
      // sender reconnects. A send is not wrong just because the socket is briefly down.
      ctx.logger.warn(
        { messageId, senderId: job.senderIdentityId, state: health.state },
        'sender not connected — leaving message queued'
      );
      await hold('sender_not_connected');
      return;
    }

    // Advisory mode (D-29): the number-protecting holds below are still *computed*, but an advisory
    // sender goes ahead anyway. Each hold it would have obeyed is counted and remembered, so the
    // operator sees what they are accepting. Do-not-contact and consent are not here — they stop a
    // message from ever being queued — and a disconnected socket above cannot be bypassed.
    const advisory = job.enforcement === 'advisory';
    const bypass = async (reason: string): Promise<void> => {
      ctx.logger.warn(
        { messageId, senderId: job.senderIdentityId, reason },
        `advisory mode: sending past an anti-ban hold (${reason})`
      );
      await ctx.db.execute(sql`
        UPDATE sender_identity
        SET advisory_bypass_count = advisory_bypass_count + 1, advisory_last_bypass = ${reason}
        WHERE id = ${job.senderIdentityId}`);
    };

    // ── the health gate ─────────────────────────────────────────────────────────────
    // A quarantined number is the engine's emergency brake: it has tripped enough risk signals
    // (docs/08-antiban.md, health scoring) that sending more is the last thing it should do.
    // Leave the message queued so it goes out if the number recovers to active, never fail it.
    if (job.senderStatus === 'quarantined') {
      if (!advisory) {
        ctx.logger.warn(
          { messageId, senderId: job.senderIdentityId },
          'sender quarantined — leaving message queued'
        );
        await hold('quarantined');
        return;
      }
      await bypass('quarantined');
    }

    // ── the recovery gate (Layer 6) ───────────────────────────────────────────────────
    // A number cooling off after a typed incident (463/429/soft-ban) is held entirely until its
    // pause lifts, then sends at a reduced daily cap that ramps back weekly. The pause is a hold,
    // exactly like quarantine (message left queued, never failed); the ramp is a fraction handed
    // to the pacing gate below, which can only lower the ceiling (docs/08-antiban.md).
    const recovery = recoveryState({
      incident: job.recoveryIncident,
      recoveryUntil: job.recoveryUntil === null ? null : new Date(job.recoveryUntil)
    });
    if (recovery.phase === 'paused') {
      if (!advisory) {
        ctx.logger.warn(
          {
            messageId, senderId: job.senderIdentityId,
            incident: recovery.incident, resumesAt: recovery.resumesAt?.toISOString()
          },
          'sender in recovery pause — leaving message queued'
        );
        await hold(`recovery_pause:${recovery.incident ?? 'incident'}`);
        if (recovery.resumesAt !== null && recovery.resumesAt !== undefined) {
          scheduleRetry(ctx, messageId, recovery.resumesAt.getTime() - Date.now());
        }
        return;
      }
      await bypass(`recovery_pause:${recovery.incident}`);
    }

    // ── the anti-ban gate ────────────────────────────────────────────────────────────
    // Nothing reaches a provider without passing this. It is the only thing between a loop
    // and a permanently banned number, and it is a ceiling rather than a target
    // (docs/08-antiban.md, P6 layers 1 and 2).
    const pacing = await checkSendAllowance(ctx.db, job.senderIdentityId, {
      perMinute: ctx.limits.perMinute,
      perDay: ctx.limits.perDay,
      dailyCapOverride: job.dailyCapOverride,
      warmupStartedAt: job.warmupStartedAt === null ? null : new Date(job.warmupStartedAt),
      lastInboundAt: job.lastInboundAt === null ? null : new Date(job.lastInboundAt),
      lastConnectedAt: job.lastConnectedAt === null ? null : new Date(job.lastConnectedAt),
      circadianTimezone: ctx.limits.circadianTimezone ?? null,
      // While ramping out of a recovery, the daily ceiling is scaled down to this fraction.
      ...(recovery.phase === 'ramping' ? { recoveryCapFraction: recovery.capFraction } : {})
    });

    let delayMs = pacing.allowed ? pacing.delayMs : 2_000;
    if (!pacing.allowed && advisory) {
      await bypass(`pacing:${pacing.reason}`);
    } else if (!pacing.allowed) {
      // Left queued, exactly like a disconnected sender: a message that is merely early is
      // not a failed message, and failing it would lose it. The sweep retries.
      ctx.logger.warn(
        {
          messageId, senderId: job.senderIdentityId, reason: pacing.reason,
          retryAfterMs: pacing.retryAfterMs
        },
        `send paced: ${pacing.detail}`
      );
      await hold(`paced:${pacing.reason}`);
      scheduleRetry(ctx, messageId, pacing.retryAfterMs);
      return;
    }

    // ── the contact-graph gate ───────────────────────────────────────────────────────
    // Who the message is going to. A stranger send waits longer than a reply, and starting too
    // many brand-new conversations too fast is refused outright — cold-blasting a fresh list is
    // one of the top ban signals (docs/08-antiban.md). Opt-in; skipped when unconfigured.
    if (ctx.contactGraph) {
      const graph = await checkContactGraph(
        ctx.db, job.senderIdentityId, job.contactId, ctx.contactGraph
      );
      if (!graph.allowed && advisory) {
        await bypass(`contact_graph:${graph.reason}`);
      } else if (!graph.allowed) {
        // Left queued like any paced message — a stranger held back by the new-contact throttle
        // has not failed, it is waiting its turn.
        ctx.logger.warn(
          {
            messageId, senderId: job.senderIdentityId, contactId: job.contactId,
            reason: graph.reason, retryAfterMs: graph.retryAfterMs
          },
          `send paced: ${graph.detail}`
        );
        await hold(`paced:${graph.reason}`);
        scheduleRetry(ctx, messageId, graph.retryAfterMs);
        return;
      }
      // Stretch the pause by the relationship multiplier, capped so a stranger at a slow hour is
      // paced, not parked for a minute. The base delay is already circadian-scaled.
      if (graph.allowed) delayMs = Math.min(30_000, Math.round(delayMs * graph.delayMultiplier));
    }

    // Recipient's day (Layer 3): circadian above is the sender's clock. Infer the recipient's zone
    // from their number and defer a send landing in their small hours, or stretch one in their
    // shoulders. Phone recipients only (a privacy id carries no country), and only when it
    // differs from the sender's own zone, so same-zone traffic is untouched.
    if (ctx.recipientTimezone && ctx.limits.circadianTimezone && job.recipientKind === 'phone') {
      const theirTz = timezoneForPhone(job.recipientValue);
      if (theirTz && theirTz !== ctx.limits.circadianTimezone) {
        const theirs = circadianActivity(localHour(new Date(), theirTz));
        if (theirs < CIRCADIAN_QUIET_THRESHOLD && advisory) {
          await bypass(`recipient_hours:${theirTz}`);
        } else if (theirs < CIRCADIAN_QUIET_THRESHOLD) {
          ctx.logger.warn(
            { messageId, senderId: job.senderIdentityId, recipientTimezone: theirTz },
            `send paced: recipient is outside their sending hours (${theirTz})`
          );
          await hold('recipient_hours');
          return;                       // left queued; the sweep tries again later
        }
        if (theirs < 1) delayMs = Math.min(30_000, circadianDelayMs(delayMs, theirs));
      }
    }

    // Layer 5 adaptive speed: scale the pause by the delivery-ratio curve (×1 healthy → ×4 when
    // delivery has collapsed), and keep a degraded sender to at least half speed whatever its
    // delivery looks like, since it may be degraded for failures or disconnects, not delivery.
    let healthFactor = deliveryDelayMultiplier(job.deliveryRatio);
    if (job.senderStatus === 'degraded') healthFactor = Math.max(healthFactor, 2);
    // A number WhatsApp may be limiting: slow down while the evidence is gathered, rather than keep
    // feeding a queue that is not being delivered.
    if (job.restrictionState !== 'ok') healthFactor = Math.max(healthFactor, 3);
    delayMs = Math.min(30_000, Math.round(delayMs * healthFactor));

    // The jittered pause. Deliberately before the send rather than after, so a burst arriving
    // at once is spread out rather than going at once and then waiting.
    if (ctx.sleep) await ctx.sleep(delayMs);

    const senderRef = { id: job.senderIdentityId, phoneE164: job.senderPhone ?? '' };
    const recipient = job.recipientKind === 'phone'
      ? { phoneE164: job.recipientValue }
      : { phoneE164: '', providerAddress: job.recipientValue };
    const body = ctx.decrypt(job.bodyEnc);

    // An attachment (D-25): read the file back from storage so the adapter can upload it. Done
    // before the pacing pause is spent on a message that cannot go. A file that cannot be read
    // fails this one message with a clear code — the inbox shows it, nothing else is affected.
    let media: { bytes: Uint8Array; contentType: string; filename: string | null } | undefined;
    if (job.mediaStorageKey !== null) {
      if (!ctx.storage) throw new Error('media_storage_unavailable');
      media = {
        bytes: await ctx.storage.get(job.mediaStorageKey),
        contentType: job.mediaContentType ?? 'application/octet-stream',
        filename: job.mediaFilename
      };
    }

    // ── typing simulation ─────────────────────────────────────────────────────────────
    // Show the "typing…" bubble and pause a beat proportional to the message length before
    // sending, so the send looks human rather than instant (docs/08-antiban.md, D-24). Opt-in,
    // and strictly cosmetic: presence is best-effort, so a failure to signal it is swallowed and
    // never fails the send it precedes.
    if (ctx.typingSimulation && ctx.provider.typing) {
      try {
        await ctx.provider.typing(senderRef, recipient, 'composing');
        if (ctx.sleep) await ctx.sleep(typingDelayMs(body.length));
        await ctx.provider.typing(senderRef, recipient, 'paused');
      } catch (presenceError) {
        ctx.logger.warn(
          { messageId, senderId: job.senderIdentityId, err: String(presenceError) },
          'typing presence failed — sending anyway'
        );
      }
    }

    const result = await ctx.provider.send(
      senderRef, recipient, { kind: 'freeform', body, ...(media ? { media } : {}) }
    );
    await markMessageSent(ctx.db, messageId, result.providerMessageId);
    ctx.logger.info({ messageId, providerMessageId: result.providerMessageId }, 'message sent');
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    await markMessageFailed(ctx.db, messageId, code);
    ctx.logger.error({ messageId, err: code }, 'send failed');
  }
}

/**
 * Turns campaign recipients into queued messages, never faster than the ceiling allows.
 *
 * **This is what stops a campaign being a ban.** A campaign does not queue its messages at
 * launch: the `campaign_recipient` rows are the queue, and this converts only as many as the
 * sender may still send today. Everything downstream — the pacing gate in `handleSend` — then
 * applies unchanged, so there is no second path to a provider and no way for a campaign to
 * bypass the gates (M12).
 *
 * It also keeps a campaign from burying an agent's reply: only a day's worth of campaign
 * messages is ever sitting in the send queue at once.
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
           si.warmup_started_at AS "warmupStartedAt",
           si.daily_cap_override AS "dailyCapOverride",
           si.last_inbound_at AS "lastInboundAt",
           c.gate_overrides AS "gateOverrides", si.enforcement AS "enforcement"
    FROM campaign c
    JOIN sender_identity si ON si.id = c.sender_identity_id
    WHERE c.status = 'running' AND si.status <> 'quarantined'
    ORDER BY c.started_at ASC
    LIMIT 20`);

  let queued = 0;
  for (const campaign of rows as unknown as Array<{
    id: string; orgId: string; body: string; senderIdentityId: string;
    warmupStartedAt: string | null; dailyCapOverride: number | null; lastInboundAt: string | null;
    gateOverrides: string[]; enforcement: string;
  }>) {
    const tenant = tenantRunner(ctx, campaign.orgId);
    const advisory = campaign.enforcement === 'advisory';

    // What this sender may still send today, after everything it has already sent —
    // including replies an agent sent by hand. A campaign gets the remainder, never a
    // separate allowance of its own.
    const usage = await ctx.db.execute(sql`
      SELECT count(*) FILTER (WHERE m.sent_at > now() - interval '1 day')::int AS "sentToday",
             count(*) FILTER (WHERE m.status = 'queued')::int AS "alreadyQueued",
             max(m.sent_at) AS "lastSentAt"
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.sender_identity_id = ${campaign.senderIdentityId} AND m.direction = 'outbound'`);
    const u = (usage as unknown as Array<{
      sentToday: number; alreadyQueued: number; lastSentAt: string | null;
    }>)[0]!;

    const ceiling = dailyCeiling(
      {
        perMinute: ctx.limits.perMinute, perDay: ctx.limits.perDay,
        dailyCapOverride: campaign.dailyCapOverride,
        warmupStartedAt: campaign.warmupStartedAt === null
          ? null : new Date(campaign.warmupStartedAt),
        lastInboundAt: campaign.lastInboundAt === null ? null : new Date(campaign.lastInboundAt)
      },
      u.lastSentAt === null ? null : new Date(u.lastSentAt),
      new Date()
    );
    // Messages already waiting count against the allowance, or a sweep every few seconds
    // would queue the whole audience before the first one had gone out.
    // Advisory mode (D-29) does not enforce the ceiling, but a sweep still queues a bounded batch
    // rather than the whole audience at once.
    const room = advisory
      ? Math.max(0, (ctx.sweepBatchSize ?? 200) - u.alreadyQueued)
      : Math.max(0, ceiling - u.sentToday - u.alreadyQueued);

    if (room > 0) {
      queued += await dispatchCampaign(tenant, ctx.kms, {
        orgId: campaign.orgId, campaignId: campaign.id,
        senderIdentityId: campaign.senderIdentityId, body: campaign.body, limit: room,
        identicalBodyCap: ctx.limits.identicalBodyCap ?? Number.MAX_SAFE_INTEGER,
        gateOverrides: campaign.gateOverrides, advisory
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

/** When the restriction sweep last ran in this process; it is a minutes-scale signal, not a seconds one. */
let lastRestrictionSweep = 0;

/**
 * Runs the silent-restriction detector over every linked number, at most once per
 * `restrictionSweepEveryMs` (default one minute). A number with too little recent traffic simply
 * classifies as `ok`, so this is cheap on an idle install.
 */
export async function sweepRestriction(ctx: WorkContext): Promise<number> {
  const counts = await inEachOrg(ctx, (c) => sweepRestrictionInOrg(c));
  return counts.reduce((a, b) => a + b, 0);
}

/** One org's share of `sweepRestriction`, run with a context already pinned to that org. */
async function sweepRestrictionInOrg(ctx: WorkContext): Promise<number> {
  const every = ctx.restrictionSweepEveryMs ?? 60_000;
  const now = Date.now();
  // `now >= last` guard: if the clock has moved backwards (a simulation restarting its timeline, or a
  // clock correction) the throttle must reset, not wait for the old time to be reached again.
  if (now >= lastRestrictionSweep && now - lastRestrictionSweep < every) return 0;
  lastRestrictionSweep = now;

  const rows = await ctx.db.execute(sql`
    SELECT id FROM sender_identity WHERE status IN ('active', 'degraded')`);
  let changed = 0;
  for (const r of rows as unknown as Array<{ id: string }>) {
    try {
      const outcome = await checkRestriction(ctx.db, r.id);
      if (outcome?.changed) {
        changed += 1;
        ctx.logger.warn(
          { senderId: r.id, from: outcome.from, to: outcome.to, signals: outcome.signals.map((s) => s.id) },
          'restriction state changed'
        );
      }
    } catch (error) {
      ctx.logger.error(
        { senderId: r.id, err: error instanceof Error ? error.message : String(error) },
        'restriction check failed'
      );
    }
  }
  return changed;
}

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

  const sendRows = await ctx.db.execute(sql`
    SELECT id FROM message
    WHERE direction = 'outbound' AND status = 'queued'
    ORDER BY created_at ASC LIMIT ${ctx.sweepBatchSize ?? 200}`);
  const sends = (sendRows as unknown as Array<{ id: string }>).map((r) => r.id);
  for (const id of sends) await handleSend(ctx, id);

  // Re-score sender health on the same cadence as the queue, so a number that has started to
  // struggle is degraded or quarantined — and a recovered one restored to active — before the
  // next batch of campaign sends is queued against it.
  await inEachOrg(ctx, (c) => scoreConnectedSenders(c.db));

  // A key rotation in progress (D-31): a small batch per sweep, never in the way of a send.
  await sweepKeyRotation(ctx);

  // Silent-restriction detection: delivery evidence per number, on its own (slower) cadence.
  await sweepRestriction(ctx);

  // Read receipts that have come due (human-like read delay, active hours only).
  await sweepReadReceipts(ctx);

  // Idle-time presence noise, so a number is not only ever active when a send is queued.
  await sweepEntropy(ctx);

  // After sending, not before: a campaign tops the queue up with whatever allowance is left
  // once this sweep's sends have been accounted for.
  await dispatchCampaigns(ctx);

  return { links: links.length, sends: sends.length };
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
      AND si.status IN ('active','degraded','quarantined')`)) as unknown as Array<{ id: string; phone: string | null }>);
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
async function pauseCampaignsFor(ctx: WorkContext, senderId: string, reason: 'ban_suspected'): Promise<number> {
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
    INSERT INTO channel_session (sender_identity_id, connection_state, disconnect_reason,
                                 disconnect_code, reconnect_attempts, last_connected_at)
    VALUES (${event.senderId}, ${event.state}, ${event.reason}, ${event.code ?? null}::int,
            ${event.state === 'open' ? 0 : event.state === 'closed' ? 1 : 0}, ${openedAt})
    ON CONFLICT (sender_identity_id) DO UPDATE
      SET connection_state = ${event.state},
          disconnect_reason = ${event.reason},
          -- The raw close code and the number of closes in a row feed the health score (401/403/463/429
          -- weights, reconnect churn). An open clears the run; a close extends it.
          disconnect_code = CASE WHEN ${event.state} = 'open' THEN NULL ELSE ${event.code ?? null}::int END,
          reconnect_attempts = CASE
            WHEN ${event.state} = 'open' THEN 0
            WHEN ${event.state} = 'closed' THEN channel_session.reconnect_attempts + 1
            ELSE channel_session.reconnect_attempts END,
          last_connected_at = COALESCE(${openedAt}, channel_session.last_connected_at),
          -- A completed link has no further use for the challenge, and leaving it behind would
          -- let the UI keep offering a QR for a number that is already connected.
          link_challenge = CASE WHEN ${event.state} = 'open'
            THEN NULL ELSE channel_session.link_challenge END,
          -- Same for the request itself: left set, the sweep kept asking for a link on a number that
          -- was already connected, and each attempt disturbed the live session.
          link_requested_at = CASE WHEN ${event.state} = 'open' THEN NULL ELSE channel_session.link_requested_at END,
          link_requested_mode = CASE WHEN ${event.state} = 'open' THEN NULL ELSE channel_session.link_requested_mode END,
          link_requested_phone = CASE WHEN ${event.state} = 'open' THEN NULL ELSE channel_session.link_requested_phone END,
          link_error = CASE WHEN ${event.state} = 'open' THEN NULL ELSE channel_session.link_error END,
          qr_expires_at = CASE WHEN ${event.state} = 'open' THEN NULL ELSE channel_session.qr_expires_at END,
          updated_at = now()`);

  // 403 is the code WhatsApp uses when it refuses a number outright (a ban or a block). It arrives as a
  // plain close, not a logout, so it needs its own branch: say so loudly and stop the campaigns.
  if (event.code === 403) {
    await suspectBan(ctx, event.senderId, 'forbidden', event.at, { code: 403, reason: event.reason });
  }

  if (event.state === 'open') {
    // Promote on first successful connection. Until this existed only the wa:link script set
    // 'active', so a number linked through the API stayed 'linking' forever and POST /messages
    // kept answering NO_ACTIVE_SENDER.
    await ctx.db.execute(sql`
      UPDATE sender_identity
      SET status = 'active', warmup_started_at = COALESCE(warmup_started_at, now()),
          updated_at = now()
      WHERE id = ${event.senderId} AND status IN ('linking', 'degraded')`);

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
    // Terminal: the number was unlinked from the phone. Say so rather than leaving it looking
    // active, which would keep the dispatcher queueing sends that can never leave. Deliberately
    // *not* auto-retired: a genuine 401 ban and a user-initiated unlink look identical at the
    // socket, and retiring a number the operator just unlinked would be wrong (docs/08-antiban.md).
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
    const recent = (await ctx.db.execute(sql`
      SELECT 1 FROM sender_health_event
      WHERE sender_identity_id = ${event.senderId} AND kind = 'hard_ban_suspected'
        AND at > now() - interval '30 minutes' LIMIT 1`) as unknown as unknown[]).length > 0;
    if (!deliberateUnlink && !alreadyLoggedOut && !recent) {
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

  // Layer 6: a typed reachout-timelock (463) or rate overlimit (429) starts a timed recovery — a
  // pause then a ramped-back cap. `beginRecovery` is a no-op if the number is already cooling off,
  // so a burst of the same disconnect does not perpetually reset the pause (docs/08-antiban.md).
  const incident = recoveryIncidentFor(event.reason);
  if (incident !== null) {
    await beginRecovery(ctx.db, event.senderId, incident, event.at);
    ctx.logger.warn(
      { senderId: event.senderId, reason: event.reason, incident },
      'recovery opened for connection incident'
    );
  }

  ctx.logger.info(
    { senderId: event.senderId, state: event.state, reason: event.reason },
    'connection state changed'
  );
}

/** Maps a disconnect reason to the recovery incident it triggers, or null when it triggers none. */
function recoveryIncidentFor(reason: NormalisedConnectionEvent['reason']): RecoveryIncident | null {
  if (reason === 'reachout_timelock') return 'timelock_463';
  if (reason === 'rate_limited') return 'rate_429';
  return null;
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
