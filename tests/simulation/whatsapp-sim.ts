import { FakeChannelProvider } from '@crm/channel-fake';
import type { OutboundContent, Recipient, SendResult, SenderRef } from '@crm/channels';

/**
 * A virtual WhatsApp that bans you if you misbehave (docs/12-testing.md, "The simulation harness").
 *
 * It watches every send and scores it against the heuristics documented in docs/08-antiban.md:
 * bursts, volume beyond what an account of this age earns, night sending, robotic timing,
 * identical bodies, strangers who never answered, a collapsing reply ratio, and a flood right
 * after a reconnect. Risk points accumulate over a rolling 24 hours; crossing `DOWNGRADE_AT`
 * degrades the number (deliveries start to fail — the soft-ban symptom the engine must react to)
 * and crossing `BAN_AT` bans it, after which every send is refused as `logged_out`.
 *
 * **These thresholds are deliberately independent of, and looser than, the engine's own limits.**
 * They stand in for WhatsApp, whose real thresholds are unknown; importing the engine's constants
 * would make the test circular. The property under test is the one in the testing doc: the engine
 * must trip *its own* breakers before this trips a ban.
 */
export const BAN_AT = 100;

/** Risk at which the number is downgraded: deliveries begin to fail. */
export const DOWNGRADE_AT = 60;

/** What a day-N account may plausibly send: the documented warmup ramp, then steady state. */
const WARMUP_CURVE = [20, 36, 65, 117, 210, 378, 680];
const STEADY_STATE = 1500;
/** How far past the ramp the simulated WhatsApp tolerates before it counts as unnatural volume. */
const VOLUME_TOLERANCE = 2.2;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** One send the simulated WhatsApp accepted. */
export interface SentRecord {
  readonly at: Date;
  readonly phone: string;
  readonly body: string;
  readonly providerMessageId: string;
}

/** The ceiling the simulated WhatsApp considers natural for an account `ageDays` old. */
export function naturalDailyVolume(ageDays: number): number {
  const day = Math.floor(ageDays);
  return day < WARMUP_CURVE.length ? WARMUP_CURVE[Math.max(0, day)]! : STEADY_STATE;
}

/** Options for the simulated account. */
export interface SimOptions {
  readonly clock: () => Date;
  /** When the account started sending — drives the warmup curve. */
  readonly accountStartedAt: Date;
  /** The number's own timezone, for the night-sending heuristic. */
  readonly timezone: string;
}

/** A scored event, kept for 24 hours. */
interface RiskEvent { readonly t: number; readonly pts: number; readonly rule: string }

/** The simulated WhatsApp. Extends the fake adapter so the real gateway code can drive it. */
export class SimulatedWhatsApp extends FakeChannelProvider {
  bannedAt: Date | null = null;
  peakRisk = 0;
  readonly sends: SentRecord[] = [];
  readonly repliedPhones = new Set<string>();
  /** Points per rule over the whole run, so a scenario can say *which* heuristic fired. */
  readonly byRule = new Map<string, number>();

  readonly #events: RiskEvent[] = [];
  readonly #sim: SimOptions;
  #reconnectAt: number | null = null;
  #reconnectFired = false;
  readonly #strangers = new Map<string, number>();

  constructor(sim: SimOptions) {
    super();
    this.#sim = sim;
  }

  /** The number's current 24h risk, 0–100+. */
  risk(): number {
    const cut = this.#sim.clock().getTime() - DAY;
    return this.#events.filter((e) => e.t > cut).reduce((n, e) => n + e.pts, 0);
  }

  /** What fraction of deliveries succeed: a downgraded number silently drops many. */
  deliveryMultiplier(): number {
    return this.risk() >= DOWNGRADE_AT ? 0.4 : 1;
  }

  /** Called by the world when the socket is re-established, so a post-reconnect flood is judged. */
  noteReconnect(): void {
    this.#reconnectAt = this.#sim.clock().getTime();
    this.#reconnectFired = false;
  }

  /** Judges one send, then lets the fake record it. A banned number refuses everything. */
  override async send(sender: SenderRef, to: Recipient, content: OutboundContent): Promise<SendResult> {
    if (this.bannedAt !== null) throw new Error('logged_out');
    const now = this.#sim.clock();
    const body = content.kind === 'freeform' ? content.body : '';
    this.#judge(now, to.phoneE164, body);
    if (this.risk() >= BAN_AT) {
      this.bannedAt = now;
      throw new Error('logged_out');
    }
    const result = await super.send(sender, to, content);
    this.sends.push({ at: now, phone: to.phoneE164, body, providerMessageId: result.providerMessageId });
    return result;
  }

  /** Adds points for any heuristic this send trips, then updates the peak. */
  #judge(now: Date, phone: string, body: string): void {
    const t = now.getTime();
    const add = (rule: string, pts: number) => {
      this.#events.push({ t, pts, rule });
      this.byRule.set(rule, (this.byRule.get(rule) ?? 0) + pts);
    };
    const recent = (ms: number) => this.sends.filter((s) => s.at.getTime() > t - ms);

    // Burst: more than 20 in a minute.
    if (recent(MIN).length + 1 > 20) add('burst', 25);

    // Volume beyond what an account this age earns, in the trailing 24h.
    const ageDays = (t - this.#sim.accountStartedAt.getTime()) / DAY;
    const limit = naturalDailyVolume(ageDays) * VOLUME_TOLERANCE;
    if (recent(DAY).length + 1 > limit) add('volume', 10);

    // Night: 02:00–06:00 in the number's own timezone.
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: this.#sim.timezone, hour: '2-digit', hour12: false
    }).format(now)) % 24;
    if (hour >= 2 && hour < 6) add('night', 8);

    // Robotic timing: every 20th send, a near-zero spread in the last 20 gaps.
    const n = this.sends.length + 1;
    if (n % 20 === 0 && this.sends.length >= 20) {
      const times = [...this.sends.slice(-19).map((s) => s.at.getTime()), t];
      const gaps = times.slice(1).map((x, i) => x - times[i]!);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
      if (mean > 0 && sd / mean < 0.05) add('regular_timing', 30);
    }

    // Identical bodies in the trailing 24h.
    if (recent(DAY).filter((s) => s.body === body).length + 1 > 30) add('identical_bodies', 10);

    // Strangers who never answered, distinct, in the trailing 24h.
    if (!this.repliedPhones.has(phone)) {
      this.#strangers.set(phone, t);
      for (const [p, at] of this.#strangers) if (at <= t - DAY) this.#strangers.delete(p);
      if (this.#strangers.size > 60) add('strangers', 6);
    }

    // Reply ratio across distinct recipients in the trailing 72h, once there is enough to judge.
    const window = this.sends.filter((s) => s.at.getTime() > t - 3 * DAY);
    const distinct = new Set(window.map((s) => s.phone));
    if (distinct.size >= 40) {
      const ratio = [...distinct].filter((p) => this.repliedPhones.has(p)).length / distinct.size;
      if (ratio < 0.05) add('reply_ratio', 4);
      else if (ratio < 0.10) add('reply_ratio', 1.5);
    }

    // A flood right after a reconnect: more than 30 sends in the first 5 minutes.
    if (this.#reconnectAt !== null && !this.#reconnectFired && t - this.#reconnectAt < 5 * MIN) {
      const since = this.sends.filter((s) => s.at.getTime() >= this.#reconnectAt!).length + 1;
      if (since > 30) { add('reconnect_burst', 50); this.#reconnectFired = true; }
    }

    this.peakRisk = Math.max(this.peakRisk, this.risk());
  }
}
