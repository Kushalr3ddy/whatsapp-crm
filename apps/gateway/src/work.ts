import { sql } from 'drizzle-orm';
import { setTenant, type Database, type Transaction } from '@crm/db';
import type { ChannelProvider, NormalisedConnectionEvent } from '@crm/channels';
import {
  markMessageFailed, markMessageSent, checkSendAllowance, checkContactGraph,
  scoreConnectedSenders, dispatchCampaign, reconcileCampaign, dailyCeiling, typingDelayMs
} from '@crm/core';
import type { Logger } from '@crm/shared';
import type { KmsDriver } from '@crm/kms-local';

/** A queued outbound message, joined to everything needed to actually send it. */
interface QueuedSend {
  readonly messageId: string;
  readonly orgId: string;
  readonly senderIdentityId: string;
  readonly senderPhone: string | null;
  /** The sender's health status, so a quarantined number does not send. */
  readonly senderStatus: string;
  /** Who the message is to, for the contact-graph gate's relationship lookup. */
  readonly contactId: string;
  readonly recipientValue: string;
  readonly recipientKind: string;
  readonly bodyEnc: Uint8Array | null;
  /** Pacing inputs, read with the job so the gate costs no extra round trip. */
  readonly warmupStartedAt: string | null;
  readonly dailyCapOverride: number | null;
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
  } | null;
  /**
   * Emit a `composing` presence and pause a human-like beat before each send (docs/08-antiban.md,
   * D-24). Opt-in like circadian and the contact-graph gate, so tests that do not exercise it are
   * unaffected and add no real delay. Cosmetic anti-ban — a failure to signal presence never fails
   * the send.
   */
  readonly typingSimulation?: boolean;
  /**
   * Waits before a send. Injected so tests do not spend real seconds on jitter — production
   * passes a real sleep, and skipping it entirely would defeat the point of the jitter.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Starts the linking handshake the API asked for, and writes the challenge back.
 *
 * The API cannot call the provider itself — the socket lives in this process — so the request
 * is left on `channel_session` and the QR or pairing code is returned through the same row.
 */
export async function handleLinkRequest(ctx: WorkContext, sessionId: string): Promise<void> {
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
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db.execute(sql`
      UPDATE channel_session SET link_error = ${message.slice(0, 500)}, updated_at = now()
      WHERE id = ${req.sessionId}`);
    ctx.logger.error({ senderId: req.senderIdentityId, err: message }, 'link request failed');
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
  const rows = await ctx.db.execute(sql`
    SELECT m.id AS "messageId", m.org_id AS "orgId", m.body_enc AS "bodyEnc",
           si.id AS "senderIdentityId", si.phone_e164 AS "senderPhone",
           si.status AS "senderStatus",
           si.warmup_started_at AS "warmupStartedAt",
           si.daily_cap_override AS "dailyCapOverride",
           v.contact_id AS "contactId",
           ci.value_normalized AS "recipientValue", ci.kind AS "recipientKind"
    FROM message m
    JOIN conversation v   ON v.id = m.conversation_id
    JOIN sender_identity si ON si.id = v.sender_identity_id
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

  try {
    const health = await ctx.provider.health(job.senderIdentityId);
    if (health.state !== 'open') {
      // Leave it queued rather than failing it: the boot sweep will pick it up once the
      // sender reconnects. A send is not wrong just because the socket is briefly down.
      ctx.logger.warn(
        { messageId, senderId: job.senderIdentityId, state: health.state },
        'sender not connected — leaving message queued'
      );
      return;
    }

    // ── the health gate ─────────────────────────────────────────────────────────────
    // A quarantined number is the engine's emergency brake: it has tripped enough risk signals
    // (docs/08-antiban.md, health scoring) that sending more is the last thing it should do.
    // Leave the message queued so it goes out if the number recovers to active, never fail it.
    if (job.senderStatus === 'quarantined') {
      ctx.logger.warn(
        { messageId, senderId: job.senderIdentityId },
        'sender quarantined — leaving message queued'
      );
      return;
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
      circadianTimezone: ctx.limits.circadianTimezone ?? null
    });

    if (!pacing.allowed) {
      // Left queued, exactly like a disconnected sender: a message that is merely early is
      // not a failed message, and failing it would lose it. The sweep retries.
      ctx.logger.warn(
        {
          messageId, senderId: job.senderIdentityId, reason: pacing.reason,
          retryAfterMs: pacing.retryAfterMs
        },
        `send paced: ${pacing.detail}`
      );
      return;
    }

    // ── the contact-graph gate ───────────────────────────────────────────────────────
    // Who the message is going to. A stranger send waits longer than a reply, and starting too
    // many brand-new conversations too fast is refused outright — cold-blasting a fresh list is
    // one of the top ban signals (docs/08-antiban.md). Opt-in; skipped when unconfigured.
    let delayMs = pacing.delayMs;
    if (ctx.contactGraph) {
      const graph = await checkContactGraph(
        ctx.db, job.senderIdentityId, job.contactId, ctx.contactGraph
      );
      if (!graph.allowed) {
        // Left queued like any paced message — a stranger held back by the new-contact throttle
        // has not failed, it is waiting its turn.
        ctx.logger.warn(
          {
            messageId, senderId: job.senderIdentityId, contactId: job.contactId,
            reason: graph.reason, retryAfterMs: graph.retryAfterMs
          },
          `send paced: ${graph.detail}`
        );
        return;
      }
      // Stretch the pause by the relationship multiplier, capped so a stranger at a slow hour is
      // paced, not parked for a minute. The base delay is already circadian-scaled.
      delayMs = Math.min(30_000, Math.round(delayMs * graph.delayMultiplier));
    }

    // A degraded sender (elevated risk, not yet quarantined) sends at half speed — the adaptive
    // throttle that gives a struggling number room to recover rather than pushing it to a ban.
    if (job.senderStatus === 'degraded') {
      delayMs = Math.min(30_000, delayMs * 2);
    }

    // The jittered pause. Deliberately before the send rather than after, so a burst arriving
    // at once is spread out rather than going at once and then waiting.
    if (ctx.sleep) await ctx.sleep(delayMs);

    const senderRef = { id: job.senderIdentityId, phoneE164: job.senderPhone ?? '' };
    const recipient = job.recipientKind === 'phone'
      ? { phoneE164: job.recipientValue }
      : { phoneE164: '', providerAddress: job.recipientValue };
    const body = ctx.decrypt(job.bodyEnc);

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

    const result = await ctx.provider.send(senderRef, recipient, { kind: 'freeform', body });
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
  if (!ctx.kms) return 0;

  const rows = await ctx.db.execute(sql`
    SELECT c.id, c.org_id AS "orgId", c.body, c.sender_identity_id AS "senderIdentityId",
           si.warmup_started_at AS "warmupStartedAt",
           si.daily_cap_override AS "dailyCapOverride"
    FROM campaign c
    JOIN sender_identity si ON si.id = c.sender_identity_id
    WHERE c.status = 'running' AND si.status <> 'quarantined'
    ORDER BY c.started_at ASC
    LIMIT 20`);

  let queued = 0;
  for (const campaign of rows as unknown as Array<{
    id: string; orgId: string; body: string; senderIdentityId: string;
    warmupStartedAt: string | null; dailyCapOverride: number | null;
  }>) {
    const tenant = tenantRunner(ctx, campaign.orgId);

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
          ? null : new Date(campaign.warmupStartedAt)
      },
      u.lastSentAt === null ? null : new Date(u.lastSentAt),
      new Date()
    );
    // Messages already waiting count against the allowance, or a sweep every few seconds
    // would queue the whole audience before the first one had gone out.
    const room = Math.max(0, ceiling - u.sentToday - u.alreadyQueued);

    if (room > 0) {
      queued += await dispatchCampaign(tenant, ctx.kms, {
        orgId: campaign.orgId, campaignId: campaign.id,
        senderIdentityId: campaign.senderIdentityId, body: campaign.body, limit: room
      });
    }
    await tenant((tx) => reconcileCampaign(tx, campaign.orgId, campaign.id));
  }
  return queued;
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
    ORDER BY created_at ASC LIMIT 200`);
  const sends = (sendRows as unknown as Array<{ id: string }>).map((r) => r.id);
  for (const id of sends) await handleSend(ctx, id);

  // Re-score sender health on the same cadence as the queue, so a number that has started to
  // struggle is degraded or quarantined — and a recovered one restored to active — before the
  // next batch of campaign sends is queued against it.
  await scoreConnectedSenders(ctx.db);

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
 */
export async function restoreSessions(ctx: WorkContext): Promise<number> {
  const rows = await ctx.db.execute(sql`
    SELECT si.id, si.phone_e164 AS phone FROM sender_identity si
    WHERE si.provider = 'baileys' AND si.status IN ('active','degraded','quarantined')`);
  const senders = rows as unknown as Array<{ id: string; phone: string | null }>;

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
 * Records a connection state change, and promotes or demotes the sender to match.
 *
 * This is the only writer of `channel_session.connection_state`, which is what the UI reads to
 * answer "is this number actually linked?". `sender_identity.status` cannot answer that: it is
 * a business state that says nothing about whether a socket is open.
 */
export async function applyConnectionEvent(
  ctx: WorkContext, event: NormalisedConnectionEvent
): Promise<void> {
  const openedAt = event.state === 'open' ? event.at.toISOString() : null;

  await ctx.db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, connection_state, disconnect_reason,
                                 last_connected_at)
    VALUES (${event.senderId}, ${event.state}, ${event.reason}, ${openedAt})
    ON CONFLICT (sender_identity_id) DO UPDATE
      SET connection_state = ${event.state},
          disconnect_reason = ${event.reason},
          last_connected_at = COALESCE(${openedAt}, channel_session.last_connected_at),
          -- A completed link has no further use for the challenge, and leaving it behind would
          -- let the UI keep offering a QR for a number that is already connected.
          link_challenge = CASE WHEN ${event.state} = 'open'
            THEN NULL ELSE channel_session.link_challenge END,
          updated_at = now()`);

  if (event.state === 'open') {
    // Promote on first successful connection. Until this existed only the wa:link script set
    // 'active', so a number linked through the API stayed 'linking' forever and POST /messages
    // kept answering NO_ACTIVE_SENDER.
    await ctx.db.execute(sql`
      UPDATE sender_identity
      SET status = 'active', warmup_started_at = COALESCE(warmup_started_at, now()),
          updated_at = now()
      WHERE id = ${event.senderId} AND status IN ('linking', 'degraded')`);
  }

  if (event.state === 'logged_out') {
    // Terminal: the number was unlinked from the phone. Say so rather than leaving it looking
    // active, which would keep the dispatcher queueing sends that can never leave.
    await ctx.db.execute(sql`
      UPDATE sender_identity SET status = 'linking', updated_at = now()
      WHERE id = ${event.senderId}`);
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
  const rows = await ctx.db.execute(sql`
    UPDATE channel_session
    SET connection_state = 'closed', updated_at = now()
    WHERE connection_state <> 'closed'
    RETURNING sender_identity_id`);
  return (rows as unknown as unknown[]).length;
}
