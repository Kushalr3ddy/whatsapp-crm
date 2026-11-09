import { sql } from 'drizzle-orm';
import type { CappingStatus, LanePriority, NumberState, QuietHoursSetting } from '../antiban.js';
import { reactionBrakeOn, type NewChatOutcomes } from './brake.js';
import {
  BRAKE_WINDOW, DEFAULT_TIME_ZONE, QUIET_HOURS_DEFAULT_END, QUIET_HOURS_DEFAULT_START, REPLY_WINDOW_MS
} from './constants.js';
import { CLOSING_MESSAGE_MARK } from './constants.js';
import { numberHoldOf, type Queryable } from './holds.js';

/** One queued outbound message of a number, with what the lane needs to order it and ask the policy about it. */
export interface LaneCandidate {
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly priority: LanePriority;
  /** The contact has never sent this number a message. */
  readonly newChat: boolean;
  readonly plannedGapMs: number | null;
  readonly holdReason: string | null;
  readonly holdUntil: Date | null;
  readonly campaignId: string | null;
}

/**
 * Every queued outbound message of one number, in lane order (S1): a reply (answers an inbound from the last 24 hours), then
 * what an agent typed, then what the AI wrote, then campaign messages; oldest first within each. A held message stays in its
 * place, so when its hold lifts it goes in its original order (AC-8.2).
 */
export async function laneCandidates(
  db: Queryable, senderIdentityId: string, now: Date, limit = 100
): Promise<LaneCandidate[]> {
  const since = new Date(now.getTime() - REPLY_WINDOW_MS).toISOString();
  const rows = await db.execute(sql`
    WITH q AS (
      SELECT m.id AS "messageId", v.id AS "conversationId", v.contact_id AS "contactId",
             m.planned_gap_ms AS "plannedGapMs", m.hold_reason AS "holdReason", m.hold_until AS "holdUntil",
             m.campaign_id AS "campaignId", m.created_at AS "createdAt",
             EXISTS (SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound') AS "known",
             EXISTS (SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound'
                     AND i.created_at > ${since}) AS "recentInbound",
             m.sent_by AS "sentBy",
             -- The closing message sent when someone opts out goes at reply priority, whenever they last wrote (F6 AC-6.2).
             coalesce(m.dnc_override_reason = ${CLOSING_MESSAGE_MARK}, false) AS "closing"
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound' AND m.status = 'queued'
        -- In flight: already handed to WhatsApp by a run that has not recorded it yet. Never a candidate again (no second send).
        AND m.send_started_at IS NULL
    )
    SELECT "messageId", "conversationId", "contactId", "plannedGapMs", "holdReason", "holdUntil", "campaignId",
           NOT "known" AS "newChat",
           CASE WHEN "recentInbound" OR "closing" THEN 'reply'
                WHEN "campaignId" IS NOT NULL THEN 'campaign'
                WHEN "sentBy" = 'agent' THEN 'ai'
                ELSE 'manual' END AS "priority"
    FROM q
    ORDER BY CASE WHEN "recentInbound" OR "closing" THEN 0 WHEN "campaignId" IS NOT NULL THEN 3 WHEN "sentBy" = 'agent' THEN 2 ELSE 1 END,
             "createdAt" ASC, "messageId" ASC
    LIMIT ${limit}`);
  return (rows as unknown as Array<Omit<LaneCandidate, 'holdUntil'> & { holdUntil: string | null }>).map((r) => ({
    ...r, holdUntil: r.holdUntil === null ? null : new Date(r.holdUntil)
  }));
}

/**
 * The first message sent to each chat, newest first: the "new-chat sends" that WhatsApp's quota and the reaction brake count.
 * A message sent from the owner's own phone is not ours to judge and is left out.
 */
const newChatSends = (senderIdentityId: string) => sql`
  SELECT m.id, m.sent_at, v.id AS conversation_id, v.contact_id
  FROM message m JOIN conversation v ON v.id = m.conversation_id
  WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound' AND m.status IN ('sent', 'delivered', 'read') AND m.sent_at IS NOT NULL
    AND m.sent_by <> 'phone'
    AND NOT EXISTS (
      SELECT 1 FROM message e WHERE e.conversation_id = v.id AND e.direction = 'outbound'
        AND e.status IN ('sent', 'delivered', 'read') AND e.sent_at IS NOT NULL AND e.sent_by <> 'phone'
        AND (e.sent_at, e.id) < (m.sent_at, m.id))
    AND NOT EXISTS (
      SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound' AND i.created_at < m.sent_at)`;

/** How the number's latest new-chat sends went, for the reaction brake. */
export async function newChatOutcomes(db: Queryable, senderIdentityId: string): Promise<NewChatOutcomes> {
  const rows = await db.execute(sql`
    WITH n AS (${newChatSends(senderIdentityId)})
    SELECT count(*)::int AS sent,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM message i WHERE i.conversation_id = x.conversation_id AND i.direction = 'inbound'
               AND i.created_at > x.sent_at))::int AS replied,
           -- S4: the contacts of these sends that probably blocked the number.
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM conversation c WHERE c.id = x.conversation_id AND c.likely_blocked_at IS NOT NULL))::int AS blocked
    FROM (
      SELECT n.* FROM n ORDER BY n.sent_at DESC LIMIT ${BRAKE_WINDOW}
    ) x`);
  const row = (rows as unknown as Array<{ sent: number; replied: number; blocked: number }>)[0] ?? { sent: 0, replied: 0, blocked: 0 };
  return { sent: row.sent, replied: row.replied, likelyBlocked: row.blocked };
}

/** New chats this number started after `since`: the ones WhatsApp's last quota figure does not know about yet. */
export async function newChatsSince(db: Queryable, senderIdentityId: string, since: Date): Promise<number> {
  const rows = await db.execute(sql`
    WITH n AS (${newChatSends(senderIdentityId)})
    SELECT count(*)::int AS n FROM n WHERE n.sent_at > ${since.toISOString()}`);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

/** What WhatsApp last said about the number's limits, as stored on its connection row (AC-2.5). */
export interface StoredWarnings {
  readonly timelockActive: boolean;
  readonly timelockUntil: Date | null;
  readonly timelockType: string | null;
  readonly cappingStatus: CappingStatus | null;
  readonly cappingTotalQuota: number | null;
  readonly cappingUsedQuota: number | null;
  readonly cappingCycleStart: Date | null;
  readonly cappingCycleEnd: Date | null;
  readonly cappingUpdatedAt: Date | null;
  readonly linkedSince: Date | null;
}

const asDate = (v: string | null): Date | null => (v === null ? null : new Date(v));

/** Reads the stored warnings of a number; all empty when it has no connection row yet. */
export async function storedWarnings(db: Queryable, senderIdentityId: string): Promise<StoredWarnings> {
  const row = (await db.execute(sql`
    SELECT timelock_active AS "timelockActive", timelock_until AS "timelockUntil", timelock_type AS "timelockType",
           capping_status AS "cappingStatus", capping_total_quota AS "cappingTotalQuota",
           capping_used_quota AS "cappingUsedQuota", capping_cycle_start AS "cappingCycleStart",
           capping_cycle_end AS "cappingCycleEnd", capping_updated_at AS "cappingUpdatedAt", linked_since AS "linkedSince"
    FROM channel_session WHERE sender_identity_id = ${senderIdentityId}`) as unknown as Array<Record<string, unknown>>)[0];
  return {
    timelockActive: row?.timelockActive === true,
    timelockUntil: asDate((row?.timelockUntil as string | null | undefined) ?? null),
    timelockType: (row?.timelockType as string | null | undefined) ?? null,
    cappingStatus: (row?.cappingStatus as CappingStatus | null | undefined) ?? null,
    cappingTotalQuota: (row?.cappingTotalQuota as number | null | undefined) ?? null,
    cappingUsedQuota: (row?.cappingUsedQuota as number | null | undefined) ?? null,
    cappingCycleStart: asDate((row?.cappingCycleStart as string | null | undefined) ?? null),
    cappingCycleEnd: asDate((row?.cappingCycleEnd as string | null | undefined) ?? null),
    cappingUpdatedAt: asDate((row?.cappingUpdatedAt as string | null | undefined) ?? null),
    linkedSince: asDate((row?.linkedSince as string | null | undefined) ?? null)
  };
}

/** The state of the number the policy reads: WhatsApp's warnings, the quota left, any hold on the whole number, the brake. */
export async function loadNumberState(db: Queryable, senderIdentityId: string): Promise<NumberState> {
  const w = await storedWarnings(db, senderIdentityId);
  let remaining: number | null = null;
  if (w.cappingTotalQuota !== null && w.cappingUsedQuota !== null) {
    // WhatsApp's figure is as of its last update; new chats started since are not in it.
    const since = w.cappingUpdatedAt === null ? 0 : await newChatsSince(db, senderIdentityId, w.cappingUpdatedAt);
    remaining = w.cappingTotalQuota - w.cappingUsedQuota - since;
  }
  const outcomes = await newChatOutcomes(db, senderIdentityId);
  return {
    timelock: { active: w.timelockActive, until: w.timelockUntil, type: w.timelockType },
    capping: { status: w.cappingStatus, remaining, cycleEnd: w.cappingCycleEnd },
    hold: await numberHoldOf(db, { senderIdentityId }),
    brakeOn: reactionBrakeOn(outcomes)
  };
}

/** The org's quiet hours: its own setting, or the default (22:00 to 08:00, on) when it has not set one. */
export async function loadQuietHours(db: Queryable, orgId: string): Promise<QuietHoursSetting> {
  const row = (await db.execute(sql`
    SELECT quiet_hours_enabled AS "enabled", quiet_hours_start AS "start", quiet_hours_end AS "end", time_zone AS "timeZone"
    FROM antiban_setting WHERE org_id = ${orgId}`) as unknown as Array<QuietHoursSetting>)[0];
  return row ?? { enabled: true, start: QUIET_HOURS_DEFAULT_START, end: QUIET_HOURS_DEFAULT_END, timeZone: DEFAULT_TIME_ZONE };
}

/** When this number last sent anything, or null if never. Includes messages the owner sent from the phone: they used the line too. */
export async function lastSentAtOf(db: Queryable, senderIdentityId: string): Promise<Date | null> {
  const row = (await db.execute(sql`
    SELECT max(m.sent_at) AS "lastSentAt"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound'`) as unknown as Array<{ lastSentAt: string | null }>)[0];
  return asDate(row?.lastSentAt ?? null);
}
