import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/**
 * Sender health scoring — P6 anti-ban, the feedback loop (docs/08-antiban.md).
 *
 * Layers 1–2 cap volume, circadian shapes the time of day, contact-graph gates the recipient —
 * all open-loop rules. This is the closed loop: it watches the *outcomes* (are messages being
 * delivered? are sends failing? has the socket dropped badly?), rolls them into a per-sender risk
 * score, and **acts** — degrading or quarantining a number before it is banned, and, just as
 * important, **recovering** it when the signals improve.
 *
 * That both-directions rule is the trap this project has hit three times (docs/00-prior-art.md):
 * a column describing live state that only ever moves one way. `status` here can go
 * active → degraded → quarantined and all the way back, with hysteresis so it does not flap.
 *
 * First slice: the score is computed from the `message` and `channel_session` rows that already
 * exist, and the evidence is stored in `sender_identity.health` (jsonb). The normalised
 * `send_risk_event` table the spec describes is a later refinement, not a prerequisite.
 */

/** The business state of a number. `linking`/`retired` are set elsewhere and never scored here. */
export type SenderStatus = 'linking' | 'active' | 'degraded' | 'quarantined' | 'retired';

/** Risk band, from the 0–100 score. Drives the status transition and the send-time throttle. */
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

/** Below this many recent sends, delivery and failure rates are too noisy to score on. */
const MIN_SENDS_TO_SCORE = 10;

/** Delivery ratios: at or above HEALTHY is fine; below POOR is a soft-ban signal. */
const DELIVERY_HEALTHY = 0.85;
const DELIVERY_POOR = 0.55;

/** Band thresholds on the 0–100 score (docs/08-antiban.md). */
const BAND_MEDIUM = 30;
const BAND_HIGH = 60;
const BAND_CRITICAL = 85;

/** What the health scorer reads about one sender, straight from the tables that record it. */
export interface HealthSignals {
  /** Messages that left the system recently (`sent`/`delivered`/`read`). */
  readonly sentRecent: number;
  /** Of those, how many WhatsApp confirmed delivered or read. */
  readonly deliveredRecent: number;
  /** Sends that failed recently. */
  readonly failedRecent: number;
  /** The socket's current state — a bad disconnect only counts while it is not open. */
  readonly connectionState: string;
  /** The last typed disconnect code (401 logged out, 429 rate, 463 timelock, …), or null. */
  readonly disconnectCode: number | null;
  /** Reconnect churn — a number that keeps dropping and re-opening is unhealthy. */
  readonly reconnectAttempts: number;
}

/** The delivery ratio, or a healthy 1.0 when there is nothing to judge it on. */
export function deliveryRatio(signals: HealthSignals): number {
  return signals.sentRecent > 0 ? signals.deliveredRecent / signals.sentRecent : 1;
}

/**
 * Rolls the signals into a 0–100 risk score. Every contribution is additive and capped at 100,
 * so the score reads as "how many, and how serious, the warning signs are right now".
 *
 * Delivery and failure only count once there is enough volume to be meaningful — a brand-new
 * number with three sends must not be quarantined for one that has not been marked delivered yet.
 * A bad disconnect only counts while the socket is actually down; once it reconnects, it recovered.
 */
export function computeRiskScore(signals: HealthSignals): number {
  let score = 0;

  if (signals.sentRecent >= MIN_SENDS_TO_SCORE) {
    const ratio = deliveryRatio(signals);
    if (ratio < DELIVERY_POOR) score += 40;
    else if (ratio < DELIVERY_HEALTHY) score += 20;
  }

  const attempts = signals.sentRecent + signals.failedRecent;
  if (attempts >= MIN_SENDS_TO_SCORE) {
    const failureRate = signals.failedRecent / attempts;
    if (failureRate > 0.2) score += 30;
    else if (failureRate > 0.1) score += 15;
  }

  // A typed disconnect is only a live signal while the socket is down; a reconnected number has
  // recovered from it. 401 (logged out) is the most serious — the phone has dropped the link.
  if (signals.connectionState !== 'open') {
    if (signals.disconnectCode === 401) score += 60;
    else if (signals.disconnectCode === 403) score += 40;
    else if (signals.disconnectCode === 463) score += 25;
    else if (signals.disconnectCode === 429) score += 25;
  }
  if (signals.reconnectAttempts >= 5) score += 15;

  return Math.min(100, score);
}

/** Which band a score falls in. */
export function riskBand(score: number): RiskBand {
  if (score >= BAND_CRITICAL) return 'critical';
  if (score >= BAND_HIGH) return 'high';
  if (score >= BAND_MEDIUM) return 'medium';
  return 'low';
}

/**
 * The status a band implies for a sender, or null to leave it unchanged.
 *
 * Movement is deliberately hysteretic so a score bouncing around a threshold does not flap the
 * status every sweep: a number only fully recovers to `active` once it reaches `low`, and a
 * `medium` reading holds whatever elevated state it was already in. `linking` and `retired` are
 * owned by the linking lifecycle, not by scoring, so they are never touched.
 */
export function nextStatus(current: SenderStatus, band: RiskBand): SenderStatus | null {
  if (current === 'linking' || current === 'retired') return null;

  switch (band) {
    case 'critical':
      return current === 'quarantined' ? null : 'quarantined';
    case 'high':
      // Escalate from active, or step DOWN from quarantined — a recovering number lands here.
      return current === 'degraded' ? null : 'degraded';
    case 'medium':
      // Hold: neither escalate nor fully recover. This is the hysteresis gap.
      return null;
    case 'low':
      return current === 'active' ? null : 'active';
  }
}

/** The result of scoring one sender: the number, its band, and any status change made. */
export interface HealthResult {
  readonly riskScore: number;
  readonly band: RiskBand;
  readonly deliveryRatio: number;
  /** The status after scoring — the new one if it changed, otherwise the one it already had. */
  readonly status: SenderStatus;
  /** True when this scoring pass moved the sender between states. */
  readonly statusChanged: boolean;
}

/**
 * Scores one sender: reads its recent signals, computes the score, and writes it back — the
 * number to `risk_score`, the evidence to `health`, and the resulting `status` transition (in
 * both directions). Returns what it decided so the caller can log or alert on a change.
 *
 * Runs on the gateway's connection, by sender id, like the rest of the gateway's writes.
 */
export async function scoreSenderHealth(
  db: Database, senderIdentityId: string, now: Date = new Date()
): Promise<HealthResult | null> {
  const at = now.toISOString();
  const rows = await db.execute(sql`
    SELECT
      si.status AS "status",
      count(m.*) FILTER (
        WHERE m.direction = 'outbound' AND m.status IN ('sent','delivered','read')
          AND m.sent_at > ${at}::timestamptz - interval '1 day'
      )::int AS "sentRecent",
      count(m.*) FILTER (
        WHERE m.direction = 'outbound' AND m.status IN ('delivered','read')
          AND m.sent_at > ${at}::timestamptz - interval '1 day'
      )::int AS "deliveredRecent",
      count(m.*) FILTER (
        WHERE m.direction = 'outbound' AND m.status = 'failed'
          AND m.created_at > ${at}::timestamptz - interval '1 day'
      )::int AS "failedRecent",
      cs.connection_state AS "connectionState",
      cs.disconnect_code AS "disconnectCode",
      coalesce(cs.reconnect_attempts, 0) AS "reconnectAttempts"
    FROM sender_identity si
    LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
    LEFT JOIN conversation v ON v.sender_identity_id = si.id
    LEFT JOIN message m ON m.conversation_id = v.id
    WHERE si.id = ${senderIdentityId}
    GROUP BY si.id, si.status, cs.connection_state, cs.disconnect_code, cs.reconnect_attempts`);

  const row = (rows as unknown as Array<{
    status: SenderStatus; sentRecent: number; deliveredRecent: number; failedRecent: number;
    connectionState: string | null; disconnectCode: number | null; reconnectAttempts: number;
  }>)[0];
  if (!row) return null;

  const signals: HealthSignals = {
    sentRecent: row.sentRecent, deliveredRecent: row.deliveredRecent,
    failedRecent: row.failedRecent, connectionState: row.connectionState ?? 'closed',
    disconnectCode: row.disconnectCode, reconnectAttempts: row.reconnectAttempts
  };

  const score = computeRiskScore(signals);
  const band = riskBand(score);
  const ratio = deliveryRatio(signals);
  const moveTo = nextStatus(row.status, band);
  const status = moveTo ?? row.status;

  // The health jsonb carries the evidence, not just the number, so the dashboard (and a person
  // reading the row) can see WHY a sender was degraded rather than trusting a bare score.
  const evidence = {
    score, band, deliveryRatio: Number(ratio.toFixed(3)),
    sentRecent: signals.sentRecent, deliveredRecent: signals.deliveredRecent,
    failedRecent: signals.failedRecent, disconnectCode: signals.disconnectCode,
    reconnectAttempts: signals.reconnectAttempts, computedAt: at
  };

  await db.execute(sql`
    UPDATE sender_identity
    SET risk_score = ${score},
        health = ${JSON.stringify(evidence)}::jsonb,
        status = ${status},
        updated_at = now()
    WHERE id = ${senderIdentityId}`);

  return { riskScore: score, band, deliveryRatio: ratio, status, statusChanged: moveTo !== null };
}

/**
 * Scores every sender that is in a scorable state (`active`/`degraded`/`quarantined`). Called
 * from the gateway sweep, so health is re-evaluated on the same cadence as the send queue.
 * `linking` and `retired` numbers are skipped — their state is not the scorer's to set.
 */
export async function scoreConnectedSenders(
  db: Database, now: Date = new Date()
): Promise<HealthResult[]> {
  const rows = await db.execute(sql`
    SELECT id FROM sender_identity WHERE status IN ('active','degraded','quarantined')`);
  const results: HealthResult[] = [];
  for (const r of rows as unknown as Array<{ id: string }>) {
    const result = await scoreSenderHealth(db, r.id, now);
    if (result) results.push(result);
  }
  return results;
}
