import { sql } from 'drizzle-orm';
import { recordHealthEvent } from '../health-events.js';
import {
  PROFILE_PROBE_MIN_INTERVAL_MS, PROFILE_SNAPSHOT_MAX_AGE_MS, PROBES_PER_SWEEP, STUCK_WINDOW, TICK_CHECK_AFTER_MS, TICK_SWEEP_BATCH
} from './constants.js';
import type { Queryable } from './holds.js';
import {
  deliversFast, judgeUnreached, stuckDecision, type ProfileSeen, type ProfileSnapshot
} from './ticks.js';

/** Looks at a contact's profile from the number and says what it shows, or null when it could not be asked. */
export type ProbeFn = (conversationId: string) => Promise<ProfileSeen | null>;

/** What one pass of the check did. */
export interface UnreachedResult {
  /** Messages given a verdict. */
  readonly judged: number;
  /** Contacts newly marked `likely_blocked`. */
  readonly likelyBlocked: number;
  /** Profile lookups made. */
  readonly probes: number;
}

/** One stuck message with what the check needs to judge it. */
interface StuckRow {
  readonly id: string;
  readonly conversationId: string;
  readonly retryRequests: number;
  readonly snapshot: ProfileSnapshot | null;
  readonly probeAt: string | null;
}

/**
 * Judges every outbound message of a number that is still at one tick 30 minutes after it went (F6 S4). A message the contact asked for
 * again belongs to S5 and is only marked (AC-4.1). For the rest, the contact's profile photo and about are probed, at most once per
 * contact per 24 hours (AC-4.2), and compared with how they looked at the last delivery: both visible then and both gone now is
 * `likely_blocked` (AC-4.3), anything else `likely_offline` (AC-4.4). Nothing is resent, ever.
 *
 * A contact probed less than a day ago is left alone, their messages unjudged until the day is up, rather than judged on old evidence.
 * A probe that could not tell is not an answer: the messages stay unjudged for the next pass. At most a few lookups run in one pass, so a
 * backlog never turns into a stream of profile requests.
 */
export async function checkUnreached(
  db: Queryable, input: { readonly senderIdentityId: string; readonly now: Date; readonly probe: ProbeFn; readonly maxProbes?: number }
): Promise<UnreachedResult> {
  const { now } = input;
  const iso = now.toISOString();
  const stuckBefore = new Date(now.getTime() - TICK_CHECK_AFTER_MS).toISOString();
  const rows = (await db.execute(sql`
    SELECT m.id, m.conversation_id AS "conversationId", m.retry_requests AS "retryRequests",
           v.profile_snapshot AS snapshot, v.profile_probe_at AS "probeAt"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE v.sender_identity_id = ${input.senderIdentityId} AND m.direction = 'outbound' AND m.status = 'sent'
      AND m.sent_by <> 'phone' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL
      AND m.sent_at <= ${stuckBefore} AND m.tick_checked_at IS NULL
    ORDER BY m.sent_at ASC
    LIMIT ${TICK_SWEEP_BATCH}`)) as unknown as StuckRow[];

  let judged = 0;
  let likelyBlocked = 0;
  let probes = 0;
  const maxProbes = input.maxProbes ?? PROBES_PER_SWEEP;

  // AC-4.1: the contact asked for it again, so S5 owns it. Marked so the sweep does not come back to it.
  const retried = rows.filter((r) => r.retryRequests > 0);
  if (retried.length > 0) {
    await db.execute(sql`
      UPDATE message SET tick_checked_at = ${iso}, tick_verdict = 'decrypt_retry'
      WHERE id IN (${sql.join(retried.map((r) => sql`${r.id}::uuid`), sql`, `)})`);
    judged += retried.length;
  }

  const byConversation = new Map<string, StuckRow[]>();
  for (const r of rows.filter((x) => x.retryRequests === 0)) byConversation.set(r.conversationId, [...(byConversation.get(r.conversationId) ?? []), r]);

  for (const [conversationId, messages] of byConversation) {
    const first = messages[0]!;
    if (first.probeAt !== null && now.getTime() - new Date(first.probeAt).getTime() < PROFILE_PROBE_MIN_INTERVAL_MS) continue;
    if (probes >= maxProbes) break;
    probes += 1;
    let seen: ProfileSeen | null;
    try { seen = await input.probe(conversationId); } catch { seen = null; }
    await db.execute(sql`UPDATE conversation SET profile_probe_at = ${iso} WHERE id = ${conversationId}`);
    if (seen === null) continue;

    const verdict = judgeUnreached(first.snapshot, seen);
    await db.execute(sql`
      UPDATE message SET tick_checked_at = ${iso}, tick_verdict = ${verdict}
      WHERE id IN (${sql.join(messages.map((m) => sql`${m.id}::uuid`), sql`, `)})`);
    judged += messages.length;
    if (verdict === 'likely_blocked') {
      const marked = await db.execute(sql`
        UPDATE conversation SET likely_blocked_at = ${iso} WHERE id = ${conversationId} AND likely_blocked_at IS NULL RETURNING id`);
      if ((marked as unknown as unknown[]).length > 0) likelyBlocked += 1;
    }
  }
  return { judged, likelyBlocked, probes };
}

/** Whether the contact's snapshot of what their profile shows is missing or older than a day, so a delivery should take a new one. */
export async function snapshotDue(db: Queryable, conversationId: string, now: Date): Promise<boolean> {
  const row = (await db.execute(sql`
    SELECT profile_snapshot AS snapshot FROM conversation WHERE id = ${conversationId}`) as unknown as Array<{ snapshot: ProfileSnapshot | null }>)[0];
  if (row === undefined) return false;
  if (row.snapshot === null || typeof row.snapshot.at !== 'string') return true;
  return now.getTime() - new Date(row.snapshot.at).getTime() >= PROFILE_SNAPSHOT_MAX_AGE_MS;
}

/** Stores what the contact's profile shows, taken when a message to them was delivered (F6 AC-4.2). */
export async function saveSnapshot(db: Queryable, conversationId: string, seen: ProfileSeen, now: Date): Promise<void> {
  const snapshot: ProfileSnapshot = { photo: seen.photo, about: seen.about, at: now.toISOString() };
  await db.execute(sql`
    UPDATE conversation SET profile_snapshot = ${JSON.stringify(snapshot)}::jsonb, profile_probe_at = ${now.toISOString()}
    WHERE id = ${conversationId}`);
}

/** The message and conversation a provider message id belongs to, for a number's outbound messages. */
export async function conversationOfSent(
  db: Queryable, providerMessageId: string
): Promise<{ conversationId: string; senderIdentityId: string } | null> {
  const row = (await db.execute(sql`
    SELECT v.id AS "conversationId", v.sender_identity_id AS "senderIdentityId"
    FROM message m JOIN conversation v ON v.id = m.conversation_id
    WHERE m.provider_message_id = ${providerMessageId} AND m.direction = 'outbound'`) as unknown as Array<{ conversationId: string; senderIdentityId: string }>)[0];
  return row ?? null;
}

/**
 * How many of the number's latest sends to contacts that deliver fast are still at one tick after 30 minutes (F6 AC-4.5, AC-4.6).
 * Each contact counts once, by their latest send; messages sent from the phone itself are left out; only sends old enough to judge are
 * looked at, and only those after an agent last resumed the number. Looks at the newest 20 such contacts.
 */
export async function stuckCount(
  db: Queryable, senderIdentityId: string, now: Date, resumedAt: Date | null
): Promise<{ stuck: number; considered: number }> {
  const stuckBefore = new Date(now.getTime() - TICK_CHECK_AFTER_MS).toISOString();
  const after = resumedAt === null ? sql`` : sql`AND m.sent_at > ${resumedAt.toISOString()}`;
  const rows = (await db.execute(sql`
    SELECT ls.status, ls.last3
    FROM (
      SELECT DISTINCT ON (v.id) v.id AS conversation_id, m.status, m.sent_at,
        (SELECT json_agg(json_build_object('sentAt', l.sent_at, 'deliveredAt', l.delivered_at) ORDER BY l.sent_at DESC)
         FROM (SELECT x.sent_at, x.delivered_at FROM message x
               WHERE x.conversation_id = v.id AND x.direction = 'outbound' AND x.sent_by <> 'phone' AND x.sent_at IS NOT NULL
               ORDER BY x.sent_at DESC LIMIT 3) l) AS last3
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound' AND m.sent_by <> 'phone'
        AND m.status IN ('sent', 'delivered', 'read') AND m.sent_at IS NOT NULL AND m.sent_at <= ${stuckBefore} ${after}
      ORDER BY v.id, m.sent_at DESC
    ) ls
    ORDER BY ls.sent_at DESC
    LIMIT ${STUCK_WINDOW * 5}`)) as unknown as Array<{ status: string; last3: Array<{ sentAt: string; deliveredAt: string | null }> | null }>;

  const fast = rows.filter((r) => deliversFast((r.last3 ?? []).map((l) => ({
    sentAt: new Date(l.sentAt), deliveredAt: l.deliveredAt === null ? null : new Date(l.deliveredAt)
  })))).slice(0, STUCK_WINDOW);
  return { stuck: fast.filter((r) => r.status === 'sent').length, considered: fast.length };
}

/**
 * Holds the number's campaigns when 8 or more of its latest 20 sends to fast-delivering contacts are stuck, and lifts the hold when the
 * count falls below 4 (F6 AC-4.6, AC-4.7). Each change is one health event, so the number's timeline says when and why.
 */
export async function reviewManyUndelivered(
  db: Queryable, input: { readonly orgId: string; readonly senderIdentityId: string; readonly now: Date }
): Promise<{ stuck: number; change: 'hold' | 'lift' | 'none' }> {
  const session = (await db.execute(sql`
    SELECT many_undelivered_at AS "heldAt", many_undelivered_resumed_at AS "resumedAt"
    FROM channel_session WHERE sender_identity_id = ${input.senderIdentityId}`) as unknown as Array<{ heldAt: string | null; resumedAt: string | null }>)[0];
  if (session === undefined) return { stuck: 0, change: 'none' };
  const { stuck, considered } = await stuckCount(db, input.senderIdentityId, input.now, session.resumedAt === null ? null : new Date(session.resumedAt));
  const change = stuckDecision({ stuck, held: session.heldAt !== null });
  const iso = input.now.toISOString();
  if (change === 'hold') {
    const set = await db.execute(sql`
      UPDATE channel_session SET many_undelivered_at = ${iso}, updated_at = now()
      WHERE sender_identity_id = ${input.senderIdentityId} AND many_undelivered_at IS NULL RETURNING id`);
    if ((set as unknown as unknown[]).length === 0) return { stuck, change: 'none' };
    await recordHealthEvent(db, {
      orgId: input.orgId, senderIdentityId: input.senderIdentityId, kind: 'many_undelivered', severity: 'warning', at: input.now,
      summary: `${String(stuck)} of the last ${String(considered)} messages to people whose phones normally deliver within minutes are still at one tick `
        + 'after 30 minutes. WhatsApp may be limiting this number, so its campaigns are on hold. Replies and messages typed by an agent still go. '
        + 'Check the phone, then resume from the number card.',
      evidence: { stuck, considered }
    });
  } else if (change === 'lift') {
    const cleared = await db.execute(sql`
      UPDATE channel_session SET many_undelivered_at = NULL, updated_at = now()
      WHERE sender_identity_id = ${input.senderIdentityId} AND many_undelivered_at IS NOT NULL RETURNING id`);
    if ((cleared as unknown as unknown[]).length === 0) return { stuck, change: 'none' };
    await recordHealthEvent(db, {
      orgId: input.orgId, senderIdentityId: input.senderIdentityId, kind: 'many_undelivered_lifted', severity: 'info', at: input.now,
      summary: `Messages are reaching people again (${String(stuck)} stuck now), so the number's campaigns are no longer on hold.`,
      evidence: { stuck, considered }
    });
  }
  return { stuck, change };
}

/**
 * An agent resumes the number's campaigns from the number card (F6 AC-4.7). Returns whether it was held. Only sends after this moment
 * count toward the next hold, or the stuck messages that caused this one would bring it straight back.
 */
export async function resumeNumber(db: Queryable, orgId: string, senderIdentityId: string, now: Date): Promise<boolean> {
  const cleared = await db.execute(sql`
    UPDATE channel_session SET many_undelivered_at = NULL, many_undelivered_resumed_at = ${now.toISOString()}, updated_at = now()
    WHERE sender_identity_id = ${senderIdentityId} AND many_undelivered_at IS NOT NULL RETURNING id`);
  if ((cleared as unknown as unknown[]).length === 0) return false;
  await recordHealthEvent(db, {
    orgId, senderIdentityId, kind: 'many_undelivered_resumed', severity: 'info', at: now,
    summary: 'An agent resumed this number\'s campaigns after the hold for messages not reaching people.'
  });
  return true;
}
