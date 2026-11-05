import { sql } from 'drizzle-orm';
import type { NumberState, QuietHoursSetting } from '../antiban.js';
import { planFirstMessage, renderRecipientBody } from './campaign-text.js';
import { GAP_MAX_MS, GAP_MIN_MS, RUN_BREAK_MS } from './constants.js';
import { typingMs } from './gap.js';
import type { Queryable } from './holds.js';
import { loadNumberState, loadQuietHours, lastSentAtOf } from './lane-state.js';
import { quietHoursEnd } from './quiet-hours.js';
import { gapFactorFor } from './policy.js';

/** One message still to go, in the order the lane will take it. */
export interface EtaItem {
  /** The gap drawn for it at launch (AC-3.1). */
  readonly gapMs: number;
  /** Characters of the text that goes first; the typing time comes from this. */
  readonly chars: number;
  readonly newChat: boolean;
  /** A campaign message waits out quiet hours; something an agent typed does not. */
  readonly campaign: boolean;
}

/** Why the finish moved, and by how many seconds (AC-3.5). */
export interface EtaDelay {
  readonly reason: 'reply_priority' | 'timelock' | 'new_chat_cap' | 'quiet_hours';
  readonly seconds: number;
}

/** The answer of `GET /campaigns/:id/eta` (AC-3.2). */
export interface Eta {
  /** When the last message is expected to go, or null when nothing is left to send. */
  readonly finishAt: Date | null;
  /** Messages that go in the current stretch. */
  readonly goNow: number;
  /** New chats beyond what WhatsApp lets this number start before its next reset. */
  readonly afterReset: number;
  /** When WhatsApp's limit lifts (cap cycle end or timelock end), or null. */
  readonly resetAt: Date | null;
  /** `quota` when WhatsApp has told us how many new chats are left, `time_only` when it has not. */
  readonly basis: 'quota' | 'time_only';
  readonly delayedBy: EtaDelay[];
}

/** Everything the estimate is worked out from. */
export interface EtaInput {
  readonly now: Date;
  readonly lastSentAt: Date | null;
  /** The campaign's messages still to go, in lane order. */
  readonly items: readonly EtaItem[];
  /** Messages that outrank the campaign and are already waiting (replies, agent messages, AI): they go first. */
  readonly ahead: readonly EtaItem[];
  readonly number: NumberState;
  readonly quietHours: QuietHoursSetting;
}

/** Plays the lane forward from `start`, message by message, the way the gateway will: each waits max(gap, typing). */
function play(
  items: readonly EtaItem[], start: Date, lastSentAt: Date | null, factorOf: (i: EtaItem) => number,
  quiet: QuietHoursSetting, quietWait: { seconds: number }
): { end: Date; lastSentAt: Date | null } {
  let t = start.getTime();
  let prev = lastSentAt?.getTime() ?? null;
  for (const item of items) {
    const gap = prev === null || t - prev >= RUN_BREAK_MS ? 0 : Math.max(0, Math.round(item.gapMs * factorOf(item)) - (t - prev));
    t += Math.max(gap, typingMs(item.chars));
    if (item.campaign) {
      const end = quietHoursEnd(new Date(t), quiet);
      if (end !== null) {
        quietWait.seconds += Math.round((end.getTime() - t) / 1000);
        t = end.getTime() + typingMs(item.chars);
      }
    }
    prev = t;
  }
  return { end: new Date(t), lastSentAt: prev === null ? null : new Date(prev) };
}

/**
 * When a campaign will finish, from the gaps stored on its recipients (S3). No randomness: with no holds, 500 recipients finish
 * exactly the sum of their gaps later (the first message of a run has none), and where typing is longer than a gap the typing
 * is what counts (AC-3.4). New chats beyond what WhatsApp lets this number start are placed after its reset (AC-3.3).
 */
export function computeEta(input: EtaInput): Eta {
  const { now, number, items } = input;
  const factorOf = (i: EtaItem): number => gapFactorFor(i.newChat, number);
  const delayedBy: EtaDelay[] = [];

  // What stops new chats right now, and until when.
  const lock = number.timelock;
  const lockUntil = lock.active && lock.until !== null && lock.until.getTime() > now.getTime() ? lock.until : null;
  const capUntil = number.capping.status === 'CAPPED' && number.capping.cycleEnd !== null && number.capping.cycleEnd.getTime() > now.getTime()
    ? number.capping.cycleEnd : null;
  const blockedUntil = lockUntil ?? capUntil;
  const blockedReason: EtaDelay['reason'] = lockUntil !== null ? 'timelock' : 'new_chat_cap';
  const cycleEnd = number.capping.cycleEnd !== null && number.capping.cycleEnd.getTime() > now.getTime() ? number.capping.cycleEnd : null;
  const quotaKnown = number.capping.remaining !== null;

  // Split the campaign: known contacts, and the new chats that fit, go now; the rest wait for the reset.
  const goNow: EtaItem[] = [];
  const later: EtaItem[] = [];
  let newChatsGoing = 0;
  let resetAt: Date | null = blockedUntil;
  for (const item of items) {
    if (!item.newChat) { goNow.push(item); continue; }
    if (blockedUntil !== null) { later.push(item); continue; }
    if (quotaKnown && cycleEnd !== null && newChatsGoing >= Math.max(0, number.capping.remaining!)) {
      later.push(item);
      resetAt = cycleEnd;
      continue;
    }
    newChatsGoing += 1;
    goNow.push(item);
  }

  const quietWait = { seconds: 0 };
  let cursor = now;
  let last = input.lastSentAt;
  if (input.ahead.length > 0) {
    const before = cursor.getTime();
    ({ end: cursor, lastSentAt: last } = play(input.ahead, cursor, last, factorOf, input.quietHours, { seconds: 0 }));
    delayedBy.push({ reason: 'reply_priority', seconds: Math.round((cursor.getTime() - before) / 1000) });
  }
  ({ end: cursor, lastSentAt: last } = play(goNow, cursor, last, factorOf, input.quietHours, quietWait));

  if (later.length > 0 && resetAt !== null) {
    const idle = Math.max(0, Math.round((resetAt.getTime() - cursor.getTime()) / 1000));
    if (idle > 0) delayedBy.push({ reason: blockedUntil !== null ? blockedReason : 'new_chat_cap', seconds: idle });
    const start = new Date(Math.max(cursor.getTime(), resetAt.getTime()));
    ({ end: cursor } = play(later, start, last, factorOf, input.quietHours, quietWait));
  }
  if (quietWait.seconds > 0) delayedBy.push({ reason: 'quiet_hours', seconds: quietWait.seconds });

  return {
    finishAt: items.length === 0 ? null : cursor,
    goNow: goNow.length, afterReset: later.length,
    resetAt: later.length > 0 ? resetAt : null,
    basis: quotaKnown ? 'quota' : 'time_only',
    delayedBy
  };
}

/** The mean of the gap distribution, for a recipient that has no gap stored (a campaign launched before gaps were drawn at launch). */
const MEAN_GAP_MS = Math.round((GAP_MIN_MS + GAP_MAX_MS) / 2);

/**
 * Reads a campaign and its number from the database and works out its ETA. The text a recipient will get is rendered the same way
 * the dispatcher renders it (seeded), so the typing time in the estimate is the typing time of the real message.
 */
export async function campaignEta(db: Queryable, orgId: string, campaignId: string, now: Date): Promise<Eta | null> {
  const campaign = (await db.execute(sql`
    SELECT c.body, c.sender_identity_id AS "senderIdentityId", c.media_asset_id IS NOT NULL AS "hasMedia",
           c.media_after_reply AS "mediaAfterReply"
    FROM campaign c WHERE c.id = ${campaignId} AND c.org_id = ${orgId}`) as unknown as Array<{
      body: string; senderIdentityId: string; hasMedia: boolean; mediaAfterReply: boolean }>)[0];
  if (campaign === undefined) return null;

  const rows = await db.execute(sql`
    SELECT cr.planned_gap_ms AS "gapMs", cr.contact_id AS "contactId", c.display_name AS "displayName",
           c.custom_fields AS "customFields",
           NOT EXISTS (
             SELECT 1 FROM message i JOIN conversation v ON v.id = i.conversation_id
             WHERE v.contact_id = cr.contact_id AND v.sender_identity_id = ${campaign.senderIdentityId}
               AND i.direction = 'inbound') AS "newChat"
    FROM campaign_recipient cr
    JOIN contact c ON c.id = cr.contact_id AND c.org_id = cr.org_id
    LEFT JOIN message m ON m.id = cr.message_id
    WHERE cr.campaign_id = ${campaignId} AND cr.org_id = ${orgId}
      AND (cr.status = 'pending' OR (cr.status = 'queued' AND (m.id IS NULL OR m.status = 'queued')))
    ORDER BY cr.id`);
  const items: EtaItem[] = (rows as unknown as Array<{
    gapMs: number | null; contactId: string; displayName: string | null; customFields: Record<string, unknown> | null; newChat: boolean;
  }>).map((r) => {
    const rendered = renderRecipientBody(campaign.body, { campaignId, contactId: r.contactId, displayName: r.displayName, customFields: r.customFields });
    const plan = planFirstMessage({ rendered, hasMedia: campaign.hasMedia, newChat: r.newChat, mediaAfterReply: campaign.mediaAfterReply });
    return { gapMs: r.gapMs ?? MEAN_GAP_MS, chars: plan.text.length, newChat: r.newChat, campaign: true };
  });

  // Messages that outrank the campaign and are already waiting for this number.
  const aheadRows = await db.execute(sql`
    SELECT m.planned_gap_ms AS "gapMs",
           NOT EXISTS (SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound') AS "newChat"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${campaign.senderIdentityId} AND m.org_id = ${orgId}
      AND m.direction = 'outbound' AND m.status = 'queued' AND m.campaign_id IS NULL
    ORDER BY m.created_at`);
  const ahead: EtaItem[] = (aheadRows as unknown as Array<{ gapMs: number | null; newChat: boolean }>)
    .map((r) => ({ gapMs: r.gapMs ?? MEAN_GAP_MS, chars: 0, newChat: r.newChat, campaign: false }));

  return computeEta({
    now, items, ahead,
    lastSentAt: await lastSentAtOf(db, campaign.senderIdentityId),
    number: await loadNumberState(db, campaign.senderIdentityId),
    quietHours: await loadQuietHours(db, orgId)
  });
}
