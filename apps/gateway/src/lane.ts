import { sql } from 'drizzle-orm';
import type { Recipient, SenderRef } from '@crm/channels';
import {
  clearHold, contactHoldOf, drawGapMs, laneCandidates, lastSentAtOf, loadNumberState, loadQuietHours, makeAntiBanPolicy, markMessageFailed,
  markMessageSent, recordHold, startsRun, typingMs, PRESENCE_IDLE_MS, READ_LEAD_MAX_MS, READ_LEAD_MIN_MS, REGISTERED_CACHE_MS,
  TYPING_REFRESH_MS,
  type AntiBanPolicy, type LaneCandidate, type SendDecision
} from '@crm/core';
import { chooseRecipientNumber } from './number-fallback.js';
import type { WorkContext } from './work.js';

/**
 * The send lane (F6 S1): one queue per number, and the only way a message reaches the provider.
 *
 * Every outbound message of a number, whoever queued it, waits here. The lane takes the next message in order (a reply first, then
 * what an agent typed, then the AI, then campaign messages; oldest first), asks the policy about it, and either sends it, waits,
 * or leaves it held with a reason. Two messages from one number never leave at the same time (AC-1.1): the lane is single-flight.
 *
 * Waiting is scheduling, not sleeping. A message that must wait longer than its typing takes is left alone and the lane comes back
 * when it is due (`WorkContext.schedule`); the only time the lane holds the line open is the typing itself (25 s at most), and the
 * wait for a read receipt. So a long gap, a timelock or a hundred held messages never keep a sweep busy.
 */

/** What one pass of the lane did, and when it needs to run again. */
export interface LaneResult {
  /** Messages that went out. */
  readonly sent: number;
  /** Messages the lane marked failed (a gate refused them, WhatsApp refused them, the send threw). */
  readonly failed: number;
  /** The earliest moment something can change by itself (a gap ends, a hold expires, the number goes idle), or null. */
  readonly nextWakeAt: Date | null;
}

/** The v2 policy, used when the context does not bring its own. */
const defaultPolicy: AntiBanPolicy = makeAntiBanPolicy();

/** A number is shown online while it is sending. In memory only: after a restart the socket starts offline anyway. */
const presenceOf = new Map<string, 'available' | 'unavailable'>();
/** Messages whose "typing…" has already been shown, and when it ended: the pass that comes next sends without typing again. */
const typedAt = new Map<string, number>();
/** Messages whose wait was already spent in an inline sleep (a context with `sleep` but no `schedule`), so it is not waited twice. */
const waited = new Set<string>();
/** How long a finished typing beat stays valid, for the pass that follows it. */
const TYPED_VALID_MS = 60_000;

const clock = (ctx: WorkContext): Date => (ctx.now ?? (() => new Date()))();

/** A queued outbound message joined to everything needed to actually send it. */
interface QueuedSend {
  readonly messageId: string;
  readonly orgId: string;
  readonly senderIdentityId: string;
  readonly senderPhone: string | null;
  /** Who the message is to, for the number-fallback lookup. */
  readonly contactId: string;
  /** Flagged do-not-contact; refused unless an admin overrode it for this message (`dncOverride`). */
  readonly doNotContact: boolean;
  readonly dncOverride: boolean;
  /** An agent typed it (a signed-in person, not a campaign, the AI or an API key). */
  readonly byAgent: boolean;
  /** The contact has written to us since they were flagged, so an agent may answer by hand (F6 AC-6.5). */
  readonly dncReopened: boolean;
  readonly recipientValue: string;
  readonly recipientKind: string;
  readonly bodyEnc: Uint8Array | null;
  /** The attachment this message carries (D-25), or null for plain text. */
  readonly mediaStorageKey: string | null;
  readonly mediaContentType: string | null;
  readonly mediaGifPlayback: boolean | null;
  readonly mediaFilename: string | null;
}

/** Loads a queued message with its recipient and attachment, or null when it is already sent, cancelled or has no reachable identity. */
async function loadJob(ctx: WorkContext, messageId: string): Promise<QueuedSend | null> {
  const rows = await ctx.db.execute(sql`
    SELECT m.id AS "messageId", m.org_id AS "orgId", m.body_enc AS "bodyEnc",
           ma.storage_key AS "mediaStorageKey", ma.content_type AS "mediaContentType", ma.gif_playback AS "mediaGifPlayback",
           ma.filename AS "mediaFilename",
           si.id AS "senderIdentityId", si.phone_e164 AS "senderPhone",
           v.contact_id AS "contactId", ct.do_not_contact AS "doNotContact",
           m.dnc_override AS "dncOverride",
           (m.sent_by_user_id IS NOT NULL AND m.campaign_id IS NULL AND m.sent_by <> 'agent') AS "byAgent",
           (ct.dnc_at IS NOT NULL AND EXISTS (
              SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound' AND i.created_at > ct.dnc_at)) AS "dncReopened",
           ci.value_normalized AS "recipientValue", ci.kind AS "recipientKind"
    FROM message m
    JOIN conversation v   ON v.id = m.conversation_id
    JOIN contact ct       ON ct.id = v.contact_id
    JOIN sender_identity si ON si.id = v.sender_identity_id
    LEFT JOIN media_asset ma ON ma.id = m.media_id AND ma.org_id = m.org_id
    JOIN contact_identity ci ON ci.contact_id = v.contact_id
                            AND ci.kind IN ('phone','wa_jid','wa_lid')
    WHERE m.id = ${messageId} AND m.direction = 'outbound' AND m.status = 'queued'
    ORDER BY CASE ci.kind WHEN 'phone' THEN 0 WHEN 'wa_jid' THEN 1 ELSE 2 END,
             ci.is_primary DESC
    LIMIT 1`);
  return (rows as unknown as QueuedSend[])[0] ?? null;
}

/** Whether a send failed because WhatsApp refused it with a 463. The cause of 463 is not known yet (an RCA is open). */
function isRefused463(error: unknown): boolean {
  const e = error as { statusCode?: unknown; output?: { statusCode?: unknown }; data?: unknown } | null;
  return e?.statusCode === 463 || e?.output?.statusCode === 463 || e?.data === 463;
}

/** The recipient of a queued message, in the form the provider takes. */
function recipientOf(job: QueuedSend, value: string): Recipient {
  return job.recipientKind === 'phone' ? { phoneE164: value } : { phoneE164: '', providerAddress: value };
}

/**
 * Before the first message to a new chat, asks WhatsApp whether the number has an account, and remembers the answer for 30 days
 * (F6 AC-7.1). One number, at the moment of the send, never a batch: a stream of lookups from one session is itself a pattern that
 * gets numbers restricted. Returns false only when WhatsApp said there is no account; "could not tell" is not a no.
 */
async function hasAccount(ctx: WorkContext, job: QueuedSend, sender: SenderRef, recipientValue: string, now: Date): Promise<boolean> {
  if (job.recipientKind !== 'phone' || ctx.provider.isRegistered === undefined) return true;
  const known = (await ctx.db.execute(sql`
    SELECT id, wa_registered AS "registered", wa_checked_at AS "checkedAt"
    FROM contact_identity WHERE contact_id = ${job.contactId} AND kind = 'phone' AND value_normalized = ${recipientValue}`
  ) as unknown as Array<{ id: string; registered: boolean | null; checkedAt: string | null }>)[0];
  if (known === undefined) return true;
  if (known.registered !== null && known.checkedAt !== null
      && now.getTime() - new Date(known.checkedAt).getTime() < REGISTERED_CACHE_MS) {
    return known.registered;
  }
  let answer: boolean | null;
  try {
    answer = await ctx.provider.isRegistered(sender, recipientValue);
  } catch (error) {
    ctx.logger.warn({ messageId: job.messageId, err: String(error) }, 'registration lookup failed; sending anyway');
    return true;
  }
  if (answer === null) return true;
  await ctx.db.execute(sql`
    UPDATE contact_identity SET wa_registered = ${answer}, wa_checked_at = ${now.toISOString()} WHERE id = ${known.id}`);
  ctx.logger.info({ messageId: job.messageId, contactId: job.contactId, registered: answer }, 'asked WhatsApp whether the number has an account');
  return answer;
}

/** The inbound messages of a chat that WhatsApp has not been told were read. */
async function unreadInbound(ctx: WorkContext, conversationId: string): Promise<Array<{ id: string; providerMessageId: string }>> {
  return (await ctx.db.execute(sql`
    SELECT id, provider_message_id AS "providerMessageId" FROM message
    WHERE conversation_id = ${conversationId} AND direction = 'inbound' AND read_marked_at IS NULL
      AND provider_message_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 20`) as unknown as Array<{ id: string; providerMessageId: string }>);
}

/** Tells WhatsApp these inbound messages were read, and records that it did. Best-effort: a failure leaves them unread. */
export async function markInboundRead(
  ctx: WorkContext, sender: SenderRef, to: Recipient, ids: ReadonlyArray<{ id: string; providerMessageId: string }>
): Promise<boolean> {
  if (ctx.provider.markRead === undefined || ids.length === 0) return false;
  try {
    await ctx.provider.markRead(sender, to, ids.map((m) => m.providerMessageId));
  } catch (error) {
    ctx.logger.warn({ senderId: sender.id, err: String(error) }, 'could not mark messages read');
    return false;
  }
  await ctx.db.execute(sql`
    UPDATE message SET read_marked_at = ${clock(ctx).toISOString()}
    WHERE id IN (${sql.join(ids.map((m) => sql`${m.id}::uuid`), sql`, `)})`);
  return true;
}

/** The earliest of two optional moments. */
const earliest = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null ? a : (a.getTime() <= b.getTime() ? a : b);

/** Sleeps in the context's way; a context with no sleep does not wait at all. */
async function pause(ctx: WorkContext, ms: number): Promise<void> {
  if (ms > 0 && ctx.sleep) await ctx.sleep(ms);
}

/** Shows "typing…" for `ms`, sending `composing` again every few seconds, then `paused`. Cosmetic: a failure never fails the send. */
async function typeFor(ctx: WorkContext, sender: SenderRef, to: Recipient, ms: number, messageId: string): Promise<void> {
  const typing = ctx.provider.typing?.bind(ctx.provider);
  if (typing === undefined) return;
  try {
    let left = ms;
    await typing(sender, to, 'composing');
    while (left > 0) {
      const step = Math.min(TYPING_REFRESH_MS, left);
      await pause(ctx, step);
      left -= step;
      if (left > 0) await typing(sender, to, 'composing');
    }
    await typing(sender, to, 'paused');
  } catch (presenceError) {
    ctx.logger.warn({ messageId, senderId: sender.id, err: String(presenceError) }, 'typing presence failed — sending anyway');
  }
}

/** Shows the number online. Cosmetic like typing; remembered so it is sent once per run. */
async function goOnline(ctx: WorkContext, sender: SenderRef): Promise<void> {
  if (presenceOf.get(sender.id) === 'available' || ctx.provider.presence === undefined) return;
  try {
    await ctx.provider.presence(sender, 'available');
    presenceOf.set(sender.id, 'available');
  } catch (error) {
    ctx.logger.warn({ senderId: sender.id, err: String(error) }, 'could not show the number online — sending anyway');
  }
}

/**
 * Runs the lane of one number until nothing can go right now. `ctx` is already pinned to the number's org. Sends what is due in
 * order, leaves what is held with a reason, and reports when to come back.
 */
export async function runLane(ctx: WorkContext, orgId: string, senderId: string): Promise<LaneResult> {
  const policy = ctx.antiBan ?? defaultPolicy;
  let sent = 0;
  let failed = 0;
  let wake: Date | null = null;

  const health = await ctx.provider.health(senderId);
  if (health.state !== 'open') {
    // Left queued rather than failed: a send is not wrong just because the socket is briefly down; the sweep picks it up when the
    // sender reconnects.
    const queued = await laneCandidates(ctx.db, senderId, clock(ctx), ctx.sweepBatchSize ?? 100);
    if (queued.length > 0) {
      ctx.logger.warn({ senderId, state: health.state, waiting: queued.length }, 'sender not connected — leaving messages queued');
      for (const c of queued) await recordHold(ctx.db, c.messageId, { reason: 'sender_not_connected', until: null });
    }
    return { sent, failed, nextWakeAt: null };
  }

  // Messages that passed the gates in this pass (kept, so the body is not decrypted and the job not loaded twice).
  const jobs = new Map<string, QueuedSend>();

  for (let pass = 0; pass < 10_000; pass++) {
    const now = clock(ctx);
    const candidates = await laneCandidates(ctx.db, senderId, now, ctx.sweepBatchSize ?? 100);
    if (candidates.length === 0) break;

    const number = await loadNumberState(ctx.db, senderId);
    const quietHours = await loadQuietHours(ctx.db, orgId);
    const lastSentAt = await lastSentAtOf(ctx.db, senderId);

    // The first message that is not held is the next one. A held message does not block the ones behind it (a new chat held by a
    // timelock lets a known contact through), but a message that only has to wait does: the gap is for the whole lane.
    let next: { c: LaneCandidate; job: QueuedSend; decision: SendDecision } | null = null;
    let failedOne = false;
    for (const c of candidates) {
      let job = jobs.get(c.messageId) ?? null;
      if (job === null) {
        job = await loadJob(ctx, c.messageId);
        if (job === null) continue;                    // sent, cancelled, or has no reachable identity
        const refusal = gateFailure(job);
        if (refusal !== null) {
          await markMessageFailed(ctx.db, c.messageId, refusal);
          ctx.logger.warn({ messageId: c.messageId, senderId, code: refusal }, 'message refused before the policy');
          failed += 1;
          failedOne = true;
          break;                                       // the queue changed: look again
        }
        jobs.set(c.messageId, job);
      }

      const gap = c.plannedGapMs ?? await draw(ctx, c.messageId);
      const contactHold = await contactHoldOf(ctx.db, { conversationId: c.conversationId });
      const decision = await policy.beforeSend({
        senderIdentityId: senderId, now, lastSentAt,
        message: { id: c.messageId, contactId: c.contactId, priority: c.priority, newChat: c.newChat, plannedGapMs: gap },
        number, contactHold, quietHours
      });

      if (decision.action === 'hold') {
        const changed = await recordHold(ctx.db, c.messageId, decision);
        if (changed) {
          ctx.logger.info({
            messageId: c.messageId, senderId, decision: 'hold', reason: decision.reason, until: decision.until?.toISOString() ?? null,
            priority: c.priority, newChat: c.newChat, timelock: number.timelock.active, cappingStatus: number.capping.status,
            quotaRemaining: number.capping.remaining
          }, 'anti-ban decision');
        }
        wake = earliest(wake, decision.until);
        continue;
      }
      next = { c, job, decision };
      break;
    }
    if (failedOne) continue;
    if (next === null) break;

    const { c, job } = next;
    // It is no longer held: it is next, and what is left is the gap and the typing.
    if (c.holdReason !== null) await clearHold(ctx.db, c.messageId);
    let decision = next.decision;
    if (decision.action === 'wait' && waited.has(c.messageId)) decision = { action: 'send' };

    const body = ctx.decrypt(job.bodyEnc!);
    const typing = ctx.typingSimulation === true && ctx.provider.typing !== undefined;
    const typeMs = typing ? typingMs(body.length) : 0;
    const remaining = decision.action === 'wait' ? decision.ms : 0;
    const typedRecently = (typedAt.get(c.messageId) ?? -Infinity) > now.getTime() - TYPED_VALID_MS;
    const log = (extra: Record<string, unknown>): void => {
      ctx.logger.info({
        messageId: c.messageId, senderId, priority: c.priority, newChat: c.newChat, plannedGapMs: c.plannedGapMs,
        lastSentAt: lastSentAt?.toISOString() ?? null, quotaRemaining: number.capping.remaining, cappingStatus: number.capping.status,
        brakeOn: number.brakeOn, ...extra
      }, 'anti-ban decision');
    };

    // Too early to start typing: come back when it is due. The wait is the longer of the gap and the typing, and the typing sits at
    // the end of it, so typing starts `remaining - typeMs` from now.
    if (decision.action === 'wait' && remaining > typeMs) {
      if (ctx.schedule !== undefined) {
        const startAt = new Date(now.getTime() + remaining - typeMs);
        log({ decision: 'wait', waitMs: remaining, typingMs: typeMs, startsTypingAt: startAt.toISOString() });
        wake = earliest(wake, startAt);
        break;
      }
      if (ctx.sleep !== undefined) {
        log({ decision: 'wait', waitMs: remaining, typingMs: typeMs, inline: true });
        await ctx.sleep(remaining - typeMs);
        waited.add(c.messageId);
        continue;
      }
      decision = { action: 'send' };                    // no clock at all: a context that never waits
    }

    const senderRef: SenderRef = { id: senderId, phoneE164: job.senderPhone ?? '' };
    // A contact with more than one phone number: make sure the one we send to has a WhatsApp account, and move to the next that does
    // if not (D-60). Just in time, like the lookup below.
    let recipientValue = job.recipientValue;
    if (ctx.verifyFallbackNumbers) {
      const pick = await chooseRecipientNumber(ctx, job, senderRef);
      if (pick.kind === 'none') {
        await markMessageFailed(ctx.db, c.messageId, 'no_whatsapp_number');
        ctx.logger.warn({ messageId: c.messageId, contactId: job.contactId }, 'none of this contact\'s numbers has a WhatsApp account');
        failed += 1;
        continue;
      }
      if (pick.kind === 'switched') {
        recipientValue = pick.phone;
        // Remembered for the pass after the typing, which must not switch the number a second time.
        jobs.set(c.messageId, { ...job, recipientValue });
      }
    }
    // F6 AC-7.1: the first message to a new chat checks that one number has an account, from the cache when it has been asked in 30 days.
    if (c.newChat && !typedRecently && !(await hasAccount(ctx, job, senderRef, recipientValue, now))) {
      await markMessageFailed(ctx.db, c.messageId, 'not_on_whatsapp');
      ctx.logger.warn({ messageId: c.messageId, contactId: job.contactId }, 'the number is not on WhatsApp — message failed, not sent');
      failed += 1;
      continue;
    }
    const recipient = recipientOf(job, recipientValue);

    // An attachment (D-25): read the file back from storage so the adapter can upload it. Done before the typing is spent on a message
    // that cannot go. A file that cannot be read fails this one message with a clear code.
    let media: { bytes: Uint8Array; contentType: string; filename: string | null; gifPlayback?: boolean } | undefined;
    try {
      if (job.mediaStorageKey !== null) {
        if (!ctx.storage) throw new Error('media_storage_unavailable');
        media = {
          bytes: await ctx.storage.get(job.mediaStorageKey),
          contentType: job.mediaContentType ?? 'application/octet-stream',
          filename: job.mediaFilename,
          ...(job.mediaGifPlayback === true ? { gifPlayback: true } : {})
        };
      }
    } catch (error) {
      await failSend(ctx, c.messageId, error);
      failed += 1;
      continue;
    }

    // Typing sits inside the wait (AC-1.4): `composing`, refreshed every 5 s, then `paused`, then the send on the next pass. The pass
    // that follows asks the policy again, so a hold that arrived while typing still wins.
    if (typing && !typedRecently) {
      // Reading before replying (AC-1.7): the contact's messages are marked read a few seconds before the reply starts typing.
      let readLeadMs = 0;
      if (c.priority === 'reply' && ctx.provider.markRead !== undefined && ctx.sleep !== undefined) {
        const unread = await unreadInbound(ctx, c.conversationId);
        if (unread.length > 0 && await markInboundRead(ctx, senderRef, recipient, unread)) {
          readLeadMs = READ_LEAD_MIN_MS + Math.floor((ctx.random ?? Math.random)() * (READ_LEAD_MAX_MS - READ_LEAD_MIN_MS + 1));
          log({ decision: 'mark_read', readLeadMs, messages: unread.length });
          await pause(ctx, readLeadMs);
        }
      }
      await goOnline(ctx, senderRef);
      log({ decision: 'type', waitMs: remaining, typingMs: typeMs, startsRun: startsRun(lastSentAt, now) });
      await typeFor(ctx, senderRef, recipient, typeMs, c.messageId);
      typedAt.set(c.messageId, clock(ctx).getTime());
      if (decision.action === 'wait') waited.add(c.messageId);
      continue;
    }

    // Send. The message is marked in flight first, so that if this process dies, or the database goes, between WhatsApp taking the
    // message and the send being recorded, nothing sends it a second time (the sweep marks it `send_unconfirmed` instead).
    await goOnline(ctx, senderRef);
    if (!(await claimSend(ctx, c.messageId))) {
      jobs.delete(c.messageId);
      continue;                                        // sent or claimed by someone else meanwhile
    }
    log({ decision: 'send' });
    let result: { providerMessageId: string } | null = null;
    try {
      result = await ctx.provider.send(senderRef, recipient, { kind: 'freeform', body, ...(media ? { media } : {}) });
    } catch (error) {
      typedAt.delete(c.messageId);
      waited.delete(c.messageId);
      jobs.delete(c.messageId);
      // The connection went between the check at the top and this send: the message is not wrong, the number is down. It waits for
      // the number to come back, like everything else queued on it, and this run stops (every send after it would fail the same way).
      if ((await ctx.provider.health(senderId)).state !== 'open') {
        await releaseSend(ctx, c.messageId);
        await recordHold(ctx.db, c.messageId, { reason: 'sender_not_connected', until: null });
        ctx.logger.warn({ messageId: c.messageId, senderId, err: error instanceof Error ? error.message : String(error) },
          'the number disconnected during a send: the message stays queued');
        break;
      }
      await failSend(ctx, c.messageId, error, c.conversationId);
      failed += 1;
      continue;
    }
    // WhatsApp has it. Recording that is retried, because a send that is not written down would be sent again.
    await recordSent(ctx, c.messageId, result.providerMessageId);
    ctx.logger.info({ messageId: c.messageId, providerMessageId: result.providerMessageId }, 'message sent');
    sent += 1;
    typedAt.delete(c.messageId);
    waited.delete(c.messageId);
    jobs.delete(c.messageId);
  }

  // Nothing is left to send right now. A number that has been quiet for 90 s goes offline; one that has not is checked again then.
  if (presenceOf.get(senderId) === 'available') {
    const last = await lastSentAtOf(ctx.db, senderId);
    const idleAt = last === null ? null : new Date(last.getTime() + PRESENCE_IDLE_MS);
    if (idleAt === null || idleAt.getTime() <= clock(ctx).getTime()) {
      try { await ctx.provider.presence?.({ id: senderId, phoneE164: '' }, 'unavailable'); }
      catch (error) { ctx.logger.warn({ senderId, err: String(error) }, 'could not show the number offline'); }
      presenceOf.set(senderId, 'unavailable');
    } else {
      wake = earliest(wake, idleAt);
    }
  }
  return { sent, failed, nextWakeAt: wake };
}

/** Draws and stores the gap for a message that has none yet (a reply or an agent's message: campaigns draw theirs at launch). */
async function draw(ctx: WorkContext, messageId: string): Promise<number> {
  const gap = drawGapMs(ctx.random);
  const row = (await ctx.db.execute(sql`
    UPDATE message SET planned_gap_ms = ${gap} WHERE id = ${messageId} AND planned_gap_ms IS NULL
    RETURNING planned_gap_ms AS "gap"`) as unknown as Array<{ gap: number }>)[0];
  if (row !== undefined) return row.gap;
  const kept = (await ctx.db.execute(sql`SELECT planned_gap_ms AS "gap" FROM message WHERE id = ${messageId}`)
    ) as unknown as Array<{ gap: number | null }>;
  return kept[0]?.gap ?? gap;
}

/**
 * The checks that protect people and the number, before the policy is asked (AC-9.2): they cannot be relaxed by it. Returns the
 * failure code, or null when the message may go on.
 */
function gateFailure(job: QueuedSend): string | null {
  if (job.bodyEnc === null) return 'empty_body';
  // Never send from a number to itself. A linked device's message to its own account cannot be decrypted on the phone: it shows
  // "Waiting for this message" and keeps asking for a resend (31 retry requests in one day, 2026-10-22).
  if (job.recipientKind === 'phone' && job.senderPhone !== null && job.recipientValue === job.senderPhone) return 'own_number';
  // The last line of the do-not-contact gate. It is checked when a message is created, but a contact can be flagged after that.
  // Only an admin's explicit, audited per-message override lets it through, or an agent answering a contact who wrote again after
  // being flagged (F6 AC-6.5). Campaigns and the AI never get past it.
  if (job.doNotContact && !job.dncOverride && !(job.byAgent && job.dncReopened)) return 'do_not_contact';
  return null;
}

/** Marks a queued message as being handed to WhatsApp now. False when it is no longer queued, or another run already has it. */
async function claimSend(ctx: WorkContext, messageId: string): Promise<boolean> {
  const rows = await ctx.db.execute(sql`
    UPDATE message SET send_started_at = ${clock(ctx).toISOString()}
    WHERE id = ${messageId} AND status = 'queued' AND send_started_at IS NULL
    RETURNING id`);
  return (rows as unknown as unknown[]).length > 0;
}

/** Puts a message back in the queue after a send that certainly did not leave (the number was not connected). */
async function releaseSend(ctx: WorkContext, messageId: string): Promise<void> {
  await ctx.db.execute(sql`UPDATE message SET send_started_at = NULL WHERE id = ${messageId} AND status = 'queued'`);
}

/** How long to wait between tries at recording a send, when the database is briefly away. */
const RECORD_SENT_RETRY_MS = [250, 1_000, 3_000] as const;

/**
 * Records a send WhatsApp accepted. Tried again a few times, because the alternative to a missing record is a message sent twice. If
 * the database stays away, the message keeps its in-flight mark and the sweep reports it as `send_unconfirmed` later.
 */
async function recordSent(ctx: WorkContext, messageId: string, providerMessageId: string): Promise<void> {
  const at = clock(ctx);
  for (let attempt = 0; ; attempt++) {
    try {
      await markMessageSent(ctx.db, messageId, providerMessageId, at);
      return;
    } catch (error) {
      const wait = RECORD_SENT_RETRY_MS[attempt];
      if (wait === undefined) {
        ctx.logger.error({ messageId, providerMessageId, err: error instanceof Error ? error.message : String(error) },
          'WhatsApp accepted a message but it could not be recorded as sent: it will be reported as unconfirmed, not sent again');
        throw error;
      }
      await new Promise((r) => { setTimeout(r, wait); });
    }
  }
}

/**
 * Records a send that failed, with a code from the fixed list (F6 AC-1.9). A 463 refusal also holds new sends to that contact
 * (AC-2.6): a containment, not a fix, while the cause of 463 is investigated. Nothing is retried.
 */
async function failSend(ctx: WorkContext, messageId: string, error: unknown, conversationId?: string): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (isRefused463(error)) {
    await markMessageFailed(ctx.db, messageId, 'whatsapp_refused_463', message);
    if (conversationId !== undefined) {
      await ctx.db.execute(sql`UPDATE conversation SET refused_463_at = ${clock(ctx).toISOString()} WHERE id = ${conversationId}`);
    }
    ctx.logger.error({ messageId, conversationId: conversationId ?? null, err: message }, 'WhatsApp refused the message (463): new sends to this contact are held');
    return;
  }
  await markMessageFailed(ctx.db, messageId, message === 'media_storage_unavailable' ? message : 'send_error', message);
  ctx.logger.error({ messageId, err: message }, 'send failed');
}
