import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { LocalKms } from '@crm/kms-local';
import { createLogger } from '@crm/shared';
import {
  snapshotAudience, storeInboundMessage, applyDeliveryStatus
} from '@crm/core';
import { sweepPendingWork, type WorkContext } from '../../apps/gateway/src/work.js';
import { setSimTime, type SimDb } from './sim-clock.js';
import { SimulatedWhatsApp } from './whatsapp-sim.js';

/**
 * The world the engine is run in: one org, one number, a population of contacts who reply and
 * receive messages with configurable probability, and a clock the harness owns.
 *
 * Crucially it runs the REAL gateway code — `sweepPendingWork`, which sends, scores health,
 * dispatches campaigns and fires read receipts and presence noise — against the simulated
 * WhatsApp. Nothing about the engine is mocked; only time, the network and the people are.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** How the simulated people behave. */
export interface Behaviour {
  /** Probability a delivered message gets a reply. */
  readonly replyRate: number;
  /** Probability a message is delivered at all (before any downgrade). */
  readonly deliveryRate: number;
}

/** What to build. */
export interface WorldOptions {
  readonly start: Date;
  /** How long the number has existed; 0 is a brand-new number. */
  readonly accountAgeDays: number;
  /** Whether the number has ever received a reply (lifts the outbound-only clamp). */
  readonly hasInboundHistory: boolean;
  readonly behaviour: Behaviour;
  readonly limits?: Partial<WorkContext['limits']>;
  /** Replaces parts of the engine context — used by the negative control to switch protections off. */
  readonly ctxOverrides?: Partial<WorkContext>;
}

/** A scheduled consequence of a send: a delivery receipt or a reply. */
interface Pending {
  readonly at: number;
  readonly kind: 'deliver' | 'reply';
  readonly phone: string;
  readonly providerMessageId: string;
}

/** The simulation world. */
export class World {
  readonly sim: SimulatedWhatsApp;
  readonly ctx: WorkContext;
  now: Date;
  senderId = '';
  orgId = '';
  /**
   * A silent restriction: from `from` on, deliveries stop arriving (or arrive far too late) for
   * `who`, with no error and no disconnect — which is how WhatsApp really does it. `null` is healthy.
   */
  #restriction: { from: number; who: 'everyone' | 'strangers' } | null = null;
  readonly #pending: Pending[] = [];
  readonly #seen = new Set<string>();
  readonly #kms: LocalKms;
  #rng: () => number;

  private constructor(
    readonly db: SimDb, readonly options: WorldOptions, sim: SimulatedWhatsApp,
    ctx: WorkContext, kms: LocalKms, rng: () => number
  ) {
    this.sim = sim; this.ctx = ctx; this.#kms = kms; this.#rng = rng; this.now = options.start;
  }

  /** Builds the org, the number, and the engine context, with the clock at `options.start`. */
  static async create(db: SimDb, options: WorldOptions, seed = 1): Promise<World> {
    vi.useFakeTimers({ toFake: ['Date'] });
    await setSimTime(db, options.start);

    await db.execute(sql`DELETE FROM org`);
    const orgId = ((await db.execute(sql`
      INSERT INTO org(name,slug) VALUES ('sim','sim-org') RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    const startedAt = new Date(options.start.getTime() - options.accountAgeDays * DAY);
    const lastInbound = options.hasInboundHistory ? new Date(options.start.getTime() - 3 * DAY) : null;
    const senderId = ((await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status, warmup_started_at,
                                   last_inbound_at)
      VALUES (${orgId}, 'fake', 'sim', '+919000000000', 'active', ${startedAt.toISOString()},
              ${lastInbound === null ? null : lastInbound.toISOString()})
      RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, connection_state, last_connected_at)
      VALUES (${senderId}, 'open', ${options.start.toISOString()})`);

    const kms = new LocalKms({
      keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex')
    });
    // A tiny deterministic PRNG so a scenario is reproducible from its seed.
    let s = seed >>> 0;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };

    const ref: { world?: World } = {};
    const sim = new SimulatedWhatsApp({
      clock: () => ref.world!.now, accountStartedAt: startedAt, timezone: 'Asia/Kolkata'
    });
    await sim.connect({ id: senderId, phoneE164: '+919000000000' });

    const ctx: WorkContext = {
      db, provider: sim, logger: createLogger({ LOG_LEVEL: 'fatal', NODE_ENV: 'test' }),
      decrypt: (c) => new TextDecoder().decode(kms.decrypt(c)), kms,
      limits: {
        perMinute: 8, perDay: 1500, circadianTimezone: 'Asia/Kolkata', identicalBodyCap: 50,
        ...options.limits
      },
      contactGraph: { newContactsPerHour: 5, newContactsPerDay: 20, replyFloor: {
        windowDays: 7, graceHours: 48, minSample: 10, minRatio: 0.3, startPerDay: 5 } },
      typingSimulation: true, readReceipts: true, recipientTimezone: true,
      sweepBatchSize: 25,
      // Every pause the engine takes is simulated time passing.
      sleep: async (ms: number) => { await ref.world!.advance(ms); },
      ...options.ctxOverrides
    };
    const world = new World(db, options, sim, ctx, kms, rng);
    ref.world = world;
    world.senderId = senderId; world.orgId = orgId;
    return world;
  }

  /** Starts a silent restriction now: sends still succeed, but deliveries stop arriving. */
  restrict(who: 'everyone' | 'strangers' = 'everyone'): void {
    this.#restriction = { from: this.now.getTime(), who };
  }

  /** Ends the restriction: deliveries flow again. */
  heal(): void {
    this.#restriction = null;
  }

  /** The detector's current verdict for the number, read straight from the database. */
  async restrictionState(): Promise<string> {
    const r = await this.db.execute(sql`
      SELECT restriction_state AS s FROM sender_identity WHERE id = ${this.senderId}`);
    return (r as unknown as Array<{ s: string }>)[0]!.s;
  }

  /** The kinds of health events recorded so far, oldest first. */
  async healthEvents(): Promise<string[]> {
    const r = await this.db.execute(sql`
      SELECT kind FROM sender_health_event WHERE sender_identity_id = ${this.senderId} ORDER BY at, id`);
    return (r as unknown as Array<{ kind: string }>).map((x) => x.kind);
  }

  /** Moves the clock forward and lets the world react to anything that has become due. */
  async advance(ms: number): Promise<void> {
    this.now = new Date(this.now.getTime() + ms);
    await setSimTime(this.db, this.now);
  }

  /** Creates `n` contacts with phones and names; `known` ones already replied once (a real thread). */
  async addContacts(n: number, known: boolean, prefix = 90): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const phone = `+91${prefix}${String(10_000_000 + this.#counter++).padStart(8, '0')}`;
      const id = ((await this.db.execute(sql`
        INSERT INTO contact (org_id, display_name, source) VALUES (${this.orgId}, ${`Person ${String(i)}`}, 'sim')
        RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
      await this.db.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        VALUES (${this.orgId}, ${id}, 'phone', ${phone}, true)`);
      if (known) {
        const conv = ((await this.db.execute(sql`
          INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_inbound_at)
          VALUES (${this.orgId}, ${id}, ${this.senderId}, ${new Date(this.now.getTime() - 5 * DAY).toISOString()})
          RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
        await this.db.execute(sql`
          INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                               provider_message_id, created_at)
          VALUES (${this.orgId}, ${conv}, 'inbound', 'delivered', 'text', ${`seed-${randomUUID()}`},
                  ${new Date(this.now.getTime() - 5 * DAY).toISOString()})`);
        this.sim.repliedPhones.add(phone);
      }
      ids.push(id);
    }
    return ids;
  }
  #counter = 0;

  /** Creates and starts a campaign over exactly these contacts. */
  async startCampaign(contactIds: string[], body: string): Promise<string> {
    const id = ((await this.db.execute(sql`
      INSERT INTO campaign (org_id, name, body, sender_identity_id, explicit_contact_ids, status)
      VALUES (${this.orgId}, 'sim', ${body}, ${this.senderId}, ${JSON.stringify(contactIds)}::jsonb, 'draft')
      RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${this.orgId}, true)`);
      await snapshotAudience(tx, this.orgId, id);
      await tx.execute(sql`UPDATE campaign SET status = 'running', started_at = now() WHERE id = ${id}`);
    });
    return id;
  }

  /** Simulates the socket dropping and coming back: the backlog it queued meanwhile can now drain. */
  async reconnect(): Promise<void> {
    await this.sim.disconnect(this.senderId);
    await this.db.execute(sql`UPDATE channel_session SET connection_state = 'closed' WHERE sender_identity_id = ${this.senderId}`);
  }

  /** Brings the socket back up, as the gateway's connection handler would. */
  async reopen(): Promise<void> {
    await this.sim.connect({ id: this.senderId, phoneE164: '+919000000000' });
    this.sim.noteReconnect();
    await this.db.execute(sql`
      UPDATE channel_session SET connection_state = 'open', last_connected_at = now()
      WHERE sender_identity_id = ${this.senderId}`);
  }

  /**
   * Runs the engine for `ms` of simulated time: sweep, react to deliveries and replies, and move
   * on. Idle stretches step in `idleMs` so a quiet day does not cost a thousand sweeps.
   */
  async run(ms: number, idleMs = 5 * MIN): Promise<void> {
    const end = this.now.getTime() + ms;
    while (this.now.getTime() < end) {
      const before = this.sim.sends.length;
      const t0 = this.now.getTime();
      await sweepPendingWork(this.ctx);
      this.#record();
      await this.#react();
      if (this.sim.bannedAt !== null) return;
      const sent = this.sim.sends.length - before;
      // After a productive sweep, step briefly; after an idle one, step to the next thing due.
      const step = sent > 0 ? Math.max(30_000, 60_000 - (this.now.getTime() - t0)) : idleMs;
      await this.advance(Math.max(1000, step));
    }
  }

  /** Schedules the consequences of each newly accepted send. */
  #record(): void {
    for (const s of this.sim.sends) {
      if (this.#seen.has(s.providerMessageId)) continue;
      this.#seen.add(s.providerMessageId);
      const t = s.at.getTime();
      this.#pending.push({ at: t + 2_000 + this.#rng() * 40_000, kind: 'deliver', phone: s.phone, providerMessageId: s.providerMessageId });
      this.#pending.push({ at: t + HOUR + this.#rng() * 5 * HOUR, kind: 'reply', phone: s.phone, providerMessageId: s.providerMessageId });
    }
  }

  /** Applies every delivery and reply that has come due. */
  async #react(): Promise<void> {
    const due = this.#pending.filter((p) => p.at <= this.now.getTime()).sort((a, b) => a.at - b.at);
    if (due.length === 0) return;
    const keep = this.#pending.filter((p) => p.at > this.now.getTime());
    this.#pending.length = 0; this.#pending.push(...keep);

    const delivered = new Set<string>();
    for (const p of due) {
      if (p.kind === 'deliver') {
        // Silently restricted: the send was accepted, the receipt never comes.
        const r = this.#restriction;
        const withheld = r !== null && p.at >= r.from
          && (r.who === 'everyone' || !this.sim.repliedPhones.has(p.phone));
        if (withheld) continue;
        const ok = this.#rng() < this.options.behaviour.deliveryRate * this.sim.deliveryMultiplier();
        if (ok) { delivered.add(p.providerMessageId); await applyDeliveryStatus(this.db, this.orgId, p.providerMessageId, 'delivered'); }
      } else if (this.#rng() < this.options.behaviour.replyRate) {
        this.sim.repliedPhones.add(p.phone);
        await storeInboundMessage(this.db, this.#kms, {
          orgId: this.orgId, senderIdentityId: this.senderId, providerMessageId: `reply-${randomUUID()}`,
          fromPhoneE164: p.phone, fromProviderAddress: `${p.phone.slice(1)}@s.whatsapp.net`,
          body: 'yes', contentType: 'text', receivedAt: new Date(p.at)
        });
        await this.db.execute(sql`UPDATE sender_identity SET last_inbound_at = now() WHERE id = ${this.senderId}`);
      }
    }
  }

  /** Sends per calendar day since the start, indexed 0.., for assertions about daily volume. */
  sendsPerDay(): number[] {
    const out: number[] = [];
    for (const s of this.sim.sends) {
      const d = Math.floor((s.at.getTime() - this.options.start.getTime()) / DAY);
      out[d] = (out[d] ?? 0) + 1;
    }
    return Array.from(out, (v) => v ?? 0);
  }
}
