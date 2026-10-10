import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { beginRecovery } from './recovery.js';

/**
 * Silent-restriction detection (docs/27-restriction-tracking.md).
 *
 * WhatsApp does not tell you when it restricts a number. Nothing disconnects and nothing errors:
 * messages simply sit at one tick, arrive hours late, or never leave. The older system could not see
 * this at all. This module infers it from **delivery evidence** — how many recent sends are still
 * undelivered, how slow delivery has become, whether the people who normally reply are affected — and
 * keeps a small state machine (`ok` → `suspected` → `likely`) that moves in both directions.
 *
 * `classifyRestriction` is pure so the thresholds are testable without a database; `checkRestriction`
 * gathers the evidence, applies the transition and acts.
 */
export type RestrictionState = 'ok' | 'suspected' | 'likely';

/** A send must be this old before "still undelivered" means anything: phones sleep, networks lag. */
export const STUCK_AFTER_MS = 30 * 60_000;
/** "Recent" delivery evidence covers sends from STUCK_AFTER_MS to this long ago. */
export const RECENT_WINDOW_MS = 4 * 3_600_000;
/** The baseline is everything older than the recent window, back this far. */
export const BASELINE_WINDOW_MS = 7 * 86_400_000;
/** Fewer considered sends than this and there is nothing to judge. */
export const MIN_SENDS = 8;
/** How long a state must hold before the detector may step back down — prevents flapping. */
export const HOLD_MS: Record<RestrictionState, number> = { ok: 0, suspected: 3_600_000, likely: 6 * 3_600_000 };

/** The delivery evidence for one number, as counted by `gatherRestrictionStats`. */
export interface RestrictionStats {
  /** Sends in the recent window (older than STUCK_AFTER_MS), and how many are still undelivered. */
  readonly recentSent: number;
  readonly recentStuck: number;
  /** The same over the baseline window. */
  readonly baselineSent: number;
  readonly baselineStuck: number;
  /** Recent sends to people who have replied before ("known") and to those who have not. */
  readonly knownSent: number;
  readonly knownStuck: number;
  readonly strangerSent: number;
  readonly strangerStuck: number;
  /** Median send→delivered time recently and over the baseline, in ms; null without enough data. */
  readonly p50Ms: number | null;
  readonly baselineP50Ms: number | null;
  /** How many delivered messages the recent median is made of. */
  readonly deliveredSample: number;
  /** Hours since anyone last wrote to this number, and how much it has sent in the last day. */
  readonly hoursSinceInbound: number | null;
  readonly outbound24h: number;
}

/** One reason the detector gives for its verdict. */
export interface RestrictionSignal {
  readonly id: 'stuck_spike' | 'slow_delivery' | 'known_contacts_stuck' | 'strangers_only_stuck' | 'inbound_silence';
  readonly detail: string;
}

/** What the evidence says, before any hysteresis. */
export interface RestrictionVerdict {
  readonly proposed: RestrictionState;
  readonly signals: readonly RestrictionSignal[];
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const fmtPct = (x: number): string => `${String(Math.round(x * 100))}%`;

/**
 * Reads the evidence and says which state it supports. Two independent signals are needed for
 * `suspected`, because any single one has an innocent explanation (a recipient's phone is off, a
 * network is slow). `likely` needs the broad pattern: a stuck spike that also hits the people who
 * normally reply, or an overwhelming one on enough volume.
 */
export function classifyRestriction(s: RestrictionStats): RestrictionVerdict {
  const signals: RestrictionSignal[] = [];
  const recentRatio = pct(s.recentStuck, s.recentSent);
  const baselineRatio = s.baselineSent >= MIN_SENDS ? pct(s.baselineStuck, s.baselineSent) : 0.1;

  // 1. A spike of sends that never got a delivery receipt, well above this number's normal.
  const spike = s.recentSent >= MIN_SENDS && recentRatio >= 0.5 && recentRatio >= baselineRatio + 0.3;
  if (spike) {
    signals.push({
      id: 'stuck_spike',
      detail: `${String(s.recentStuck)} of ${String(s.recentSent)} recent sends (${fmtPct(recentRatio)}) are still undelivered; normally ${fmtPct(baselineRatio)}`
    });
  }

  // 2. Delivery has become much slower than this number's own history (or very slow outright).
  const slow = s.deliveredSample >= MIN_SENDS && s.p50Ms !== null
    && (s.baselineP50Ms !== null
      ? s.p50Ms > Math.max(5 * s.baselineP50Ms, 5 * 60_000)
      : s.p50Ms > 15 * 60_000);
  if (slow) {
    signals.push({
      id: 'slow_delivery',
      detail: `median delivery is ${String(Math.round((s.p50Ms ?? 0) / 60_000))} min${s.baselineP50Ms !== null ? `, normally ${String(Math.max(1, Math.round(s.baselineP50Ms / 60_000)))} min` : ''}`
    });
  }

  // 3. The people who normally reply are stuck too — that is not "some phones are off".
  if (s.knownSent >= 5 && pct(s.knownStuck, s.knownSent) >= 0.5) {
    signals.push({
      id: 'known_contacts_stuck',
      detail: `${String(s.knownStuck)} of ${String(s.knownSent)} sends to people who have replied before are undelivered`
    });
  }

  // 4. Only strangers are affected: the shape of a reachout timelock (new-contact messaging is limited).
  if (s.strangerSent >= MIN_SENDS && pct(s.strangerStuck, s.strangerSent) >= 0.6
    && pct(s.knownStuck, Math.max(1, s.knownSent)) < 0.3) {
    signals.push({
      id: 'strangers_only_stuck',
      detail: `${String(s.strangerStuck)} of ${String(s.strangerSent)} sends to new contacts are undelivered while known contacts are fine`
    });
  }

  // 5. A weak corroborator: heavy sending, nobody answering for two days.
  if (s.hoursSinceInbound !== null && s.hoursSinceInbound >= 48 && s.outbound24h >= 20) {
    signals.push({
      id: 'inbound_silence',
      detail: `no reply for ${String(Math.round(s.hoursSinceInbound))} h despite ${String(s.outbound24h)} sends in the last day`
    });
  }

  const has = (id: RestrictionSignal['id']): boolean => signals.some((x) => x.id === id);
  const broad = has('stuck_spike')
    && (has('known_contacts_stuck') || (s.recentSent >= 20 && recentRatio >= 0.6));
  const proposed: RestrictionState = broad ? 'likely' : signals.length >= 2 ? 'suspected' : 'ok';
  return { proposed, signals };
}

/**
 * Applies hysteresis: the state may rise at once, but only falls after it has held for its minimum
 * time — and only one step at a time — so a number does not flap between states every sweep.
 */
export function nextRestrictionState(
  current: RestrictionState, proposed: RestrictionState, heldMs: number
): RestrictionState {
  const rank: Record<RestrictionState, number> = { ok: 0, suspected: 1, likely: 2 };
  if (rank[proposed] >= rank[current]) return proposed;
  if (heldMs < HOLD_MS[current]) return current;
  return current === 'likely' ? 'suspected' : 'ok';
}

/** Counts the delivery evidence for one number as of `now`. */
export async function gatherRestrictionStats(
  db: Database, senderIdentityId: string, now: Date
): Promise<RestrictionStats> {
  const at = now.toISOString();
  const rows = await db.execute(sql`
    WITH sends AS (
      SELECT m.status, m.sent_at, m.delivered_at,
             EXISTS (SELECT 1 FROM message i WHERE i.conversation_id = v.id AND i.direction = 'inbound') AS known
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound'
        AND m.status IN ('sent', 'delivered', 'read') AND m.sent_at IS NOT NULL
        AND m.sent_at > ${at}::timestamptz - ${String(BASELINE_WINDOW_MS / 1000)} * interval '1 second'
        AND m.sent_at <= ${at}::timestamptz - ${String(STUCK_AFTER_MS / 1000)} * interval '1 second'
    ), recent AS (
      SELECT * FROM sends WHERE sent_at > ${at}::timestamptz - ${String(RECENT_WINDOW_MS / 1000)} * interval '1 second'
    ), baseline AS (
      SELECT * FROM sends WHERE sent_at <= ${at}::timestamptz - ${String(RECENT_WINDOW_MS / 1000)} * interval '1 second'
    )
    SELECT
      (SELECT count(*) FROM recent)::int AS "recentSent",
      (SELECT count(*) FROM recent WHERE status = 'sent')::int AS "recentStuck",
      (SELECT count(*) FROM baseline)::int AS "baselineSent",
      (SELECT count(*) FROM baseline WHERE status = 'sent')::int AS "baselineStuck",
      (SELECT count(*) FROM recent WHERE known)::int AS "knownSent",
      (SELECT count(*) FROM recent WHERE known AND status = 'sent')::int AS "knownStuck",
      (SELECT count(*) FROM recent WHERE NOT known)::int AS "strangerSent",
      (SELECT count(*) FROM recent WHERE NOT known AND status = 'sent')::int AS "strangerStuck",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (delivered_at - sent_at)) * 1000)
         FROM recent WHERE delivered_at IS NOT NULL) AS "p50Ms",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (delivered_at - sent_at)) * 1000)
         FROM baseline WHERE delivered_at IS NOT NULL) AS "baselineP50Ms",
      (SELECT count(*) FROM recent WHERE delivered_at IS NOT NULL)::int AS "deliveredSample",
      (SELECT extract(epoch FROM (${at}::timestamptz - si.last_inbound_at)) / 3600
         FROM sender_identity si WHERE si.id = ${senderIdentityId}) AS "hoursSinceInbound",
      (SELECT count(*)::int FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.sender_identity_id = ${senderIdentityId} AND m.direction = 'outbound'
          AND m.sent_at > ${at}::timestamptz - interval '1 day') AS "outbound24h"`);
  const r = (rows as unknown as Array<Record<string, number | string | null | undefined>>)[0]!;
  const num = (v: number | string | null | undefined): number | null =>
    (v === null || v === undefined ? null : Number(v));
  return {
    recentSent: Number(r.recentSent), recentStuck: Number(r.recentStuck),
    baselineSent: Number(r.baselineSent), baselineStuck: Number(r.baselineStuck),
    knownSent: Number(r.knownSent), knownStuck: Number(r.knownStuck),
    strangerSent: Number(r.strangerSent), strangerStuck: Number(r.strangerStuck),
    p50Ms: num(r.p50Ms), baselineP50Ms: num(r.baselineP50Ms),
    deliveredSample: Number(r.deliveredSample),
    hoursSinceInbound: num(r.hoursSinceInbound), outbound24h: Number(r.outbound24h)
  };
}

/** Writes one entry on a number's health timeline. */
export async function recordHealthEvent(
  db: Database,
  e: {
    orgId: string; senderIdentityId: string; kind: string;
    severity: 'info' | 'warning' | 'critical'; summary: string; evidence?: unknown; at?: Date;
  }
): Promise<void> {
  await db.execute(sql`
    INSERT INTO sender_health_event (org_id, sender_identity_id, at, kind, severity, summary, evidence)
    VALUES (${e.orgId}, ${e.senderIdentityId}, ${(e.at ?? new Date()).toISOString()}, ${e.kind},
            ${e.severity}, ${e.summary}, ${JSON.stringify(e.evidence ?? {})}::jsonb)`);
}

/** What `checkRestriction` did, for logging and tests. */
export interface RestrictionOutcome {
  readonly from: RestrictionState;
  readonly to: RestrictionState;
  readonly changed: boolean;
  readonly signals: readonly RestrictionSignal[];
}

/**
 * Evaluates one number: gathers its evidence, decides the state (with hysteresis), and on a change
 * writes a timeline event and acts — `suspected` warns and slows sends (the send gate reads the
 * state); `likely` also opens a soft-ban recovery and pauses that number's running campaigns, so
 * nothing keeps feeding a number that is not delivering.
 */
export async function checkRestriction(
  db: Database, senderIdentityId: string, now: Date = new Date()
): Promise<RestrictionOutcome | null> {
  const found = await db.execute(sql`
    SELECT org_id AS "orgId", restriction_state AS "state", restriction_since AS "since"
    FROM sender_identity WHERE id = ${senderIdentityId}`);
  const sender = (found as unknown as Array<{ orgId: string; state: RestrictionState; since: string | null }>)[0];
  if (!sender) return null;

  const stats = await gatherRestrictionStats(db, senderIdentityId, now);
  const verdict = classifyRestriction(stats);
  const heldMs = sender.since === null ? Number.POSITIVE_INFINITY : now.getTime() - new Date(sender.since).getTime();
  const to = nextRestrictionState(sender.state, verdict.proposed, heldMs);
  if (to === sender.state) {
    return { from: sender.state, to, changed: false, signals: verdict.signals };
  }

  await db.execute(sql`
    UPDATE sender_identity
    SET restriction_state = ${to}, restriction_since = ${now.toISOString()}, updated_at = now()
    WHERE id = ${senderIdentityId}`);

  const why = verdict.signals.map((x) => x.detail).join('; ');
  const evidence = { stats, signals: verdict.signals };
  if (to === 'ok') {
    await recordHealthEvent(db, {
      orgId: sender.orgId, senderIdentityId, kind: 'restriction_cleared', severity: 'info',
      summary: 'Delivery looks normal again.', evidence, at: now
    });
  } else if (to === 'suspected' && sender.state === 'likely') {
    await recordHealthEvent(db, {
      orgId: sender.orgId, senderIdentityId, kind: 'restriction_easing', severity: 'info',
      summary: 'Delivery is recovering. The number is still being watched before it is cleared.',
      evidence, at: now
    });
  } else if (to === 'suspected') {
    await recordHealthEvent(db, {
      orgId: sender.orgId, senderIdentityId, kind: 'restriction_suspected', severity: 'warning',
      summary: `WhatsApp may be limiting this number: ${why || 'delivery has slowed'}. Sending is slowed while this is checked.`,
      evidence, at: now
    });
  } else {
    await recordHealthEvent(db, {
      orgId: sender.orgId, senderIdentityId, kind: 'restriction_likely', severity: 'critical',
      summary: `This number looks restricted: ${why}. Its campaigns are paused and it is cooling off.`,
      evidence, at: now
    });
    await beginRecovery(db, senderIdentityId, 'soft_ban', now);
    await db.execute(sql`
      UPDATE campaign SET status = 'paused', pause_reason = 'restriction_likely', updated_at = now()
      WHERE sender_identity_id = ${senderIdentityId} AND status = 'running'`);
  }
  return { from: sender.state, to, changed: true, signals: verdict.signals };
}
