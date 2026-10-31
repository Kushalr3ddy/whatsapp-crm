import { describe, expect, it } from 'vitest';
import type { AntiBanPolicy, NumberState, SendContext, SendDecision } from '../antiban.js';
import { HOLD_REASONS } from '../antiban.js';
import { CAMPAIGN_QUEUE_AHEAD } from './constants.js';
import { gapFactorFor, makeAntiBanPolicy } from './policy.js';

const policy = makeAntiBanPolicy();
const T0 = new Date('2026-11-02T09:00:00.000Z');       // 14:30 in Asia/Kolkata: outside quiet hours
const at = (ms: number): Date => new Date(T0.getTime() + ms);

const OPEN: NumberState = {
  timelock: { active: false, until: null, type: null },
  capping: { status: null, remaining: null, cycleEnd: null },
  hold: null, brakeOn: false
};

function ctx(over: {
  now?: Date; lastSentAt?: Date | null; newChat?: boolean; priority?: SendContext['message']['priority']; gap?: number;
  number?: Partial<NumberState>; contactHold?: SendContext['contactHold']; quiet?: Partial<SendContext['quietHours']>;
} = {}): SendContext {
  return {
    senderIdentityId: 's1', now: over.now ?? T0, lastSentAt: over.lastSentAt === undefined ? null : over.lastSentAt,
    message: { id: 'm1', contactId: 'c1', priority: over.priority ?? 'campaign', newChat: over.newChat ?? true, plannedGapMs: over.gap ?? 20_000 },
    number: { ...OPEN, ...over.number },
    contactHold: over.contactHold ?? null,
    quietHours: { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Kolkata', ...over.quiet }
  };
}

const ask = (c: SendContext): Promise<SendDecision> => policy.beforeSend(c);

describe('AC-1.3 the gap between sends', () => {
  it('AC-1.3 the first message of a run goes without a gap', async () => {
    expect(await ask(ctx({ lastSentAt: null }))).toEqual({ action: 'send' });
  });

  it('AC-1.3 the next one waits what is left of the gap drawn for it, counted from the previous send', async () => {
    const d = await ask(ctx({ lastSentAt: at(-8_000), gap: 20_000 }));
    expect(d).toEqual({ action: 'wait', ms: 12_000 });
  });

  it('AC-1.3 goes once the gap has passed, and a silence of 90 s or more starts a new run with no gap', async () => {
    expect(await ask(ctx({ lastSentAt: at(-20_000), gap: 20_000 }))).toEqual({ action: 'send' });
    expect(await ask(ctx({ lastSentAt: at(-95_000), gap: 50_000 }))).toEqual({ action: 'send' });
  });

  it('AC-1.3 the same context always gives the same answer: the policy draws nothing', async () => {
    const c = ctx({ lastSentAt: at(-1_000), gap: 30_000 });
    expect(await ask(c)).toEqual(await ask(c));
  });
});

describe('S2 WhatsApp warnings in the policy', () => {
  const lockUntil = at(3_600_000);

  it('AC-2.1 a timelock holds new chats until it ends, with the time it ends', async () => {
    const d = await ask(ctx({ newChat: true, number: { timelock: { active: true, until: lockUntil, type: 'DEFAULT' } } }));
    expect(d).toEqual({ action: 'hold', reason: 'timelock', until: lockUntil });
  });

  it('AC-2.1 known contacts still get messages while a timelock is on', async () => {
    const d = await ask(ctx({ newChat: false, number: { timelock: { active: true, until: lockUntil, type: 'DEFAULT' } } }));
    expect(d).toEqual({ action: 'send' });
  });

  it('AC-2.2 the hold lifts when the time passes, or when an inactive update arrives', async () => {
    const lock = { active: true, until: lockUntil, type: 'DEFAULT' };
    expect((await ask(ctx({ now: at(3_600_001), number: { timelock: lock } }))).action).toBe('send');
    expect((await ask(ctx({ number: { timelock: { active: false, until: null, type: null } } }))).action).toBe('send');
  });

  it('AC-2.3 FIRST_WARNING doubles the gap before new chats and SECOND_WARNING triples it; known contacts are unchanged', async () => {
    const first = { capping: { status: 'FIRST_WARNING' as const, remaining: 50, cycleEnd: at(86_400_000) } };
    const second = { capping: { status: 'SECOND_WARNING' as const, remaining: 10, cycleEnd: at(86_400_000) } };
    const base = { lastSentAt: at(-5_000), gap: 20_000 };
    expect(await ask(ctx({ ...base, newChat: true }))).toEqual({ action: 'wait', ms: 15_000 });
    expect(await ask(ctx({ ...base, newChat: true, number: first }))).toEqual({ action: 'wait', ms: 35_000 });
    expect(await ask(ctx({ ...base, newChat: true, number: second }))).toEqual({ action: 'wait', ms: 55_000 });
    expect(await ask(ctx({ ...base, newChat: false, number: second }))).toEqual({ action: 'wait', ms: 15_000 });
  });

  it('AC-2.4 CAPPED holds new chats until the cycle ends; known contacts go', async () => {
    const cycleEnd = at(7_200_000);
    const capped = { capping: { status: 'CAPPED' as const, remaining: 0, cycleEnd } };
    expect(await ask(ctx({ newChat: true, number: capped }))).toEqual({ action: 'hold', reason: 'new_chat_cap', until: cycleEnd });
    expect(await ask(ctx({ newChat: false, number: capped }))).toEqual({ action: 'send' });
  });

  it('AC-2.4 a quota that has run out holds new chats the same way, even before WhatsApp says CAPPED', async () => {
    const cycleEnd = at(7_200_000);
    const d = await ask(ctx({ newChat: true, number: { capping: { status: 'SECOND_WARNING', remaining: 0, cycleEnd } } }));
    expect(d).toEqual({ action: 'hold', reason: 'new_chat_cap', until: cycleEnd });
  });

  it('AC-2.4 once the cycle has ended the old quota no longer holds anything', async () => {
    const d = await ask(ctx({ newChat: true, number: { capping: { status: 'CAPPED', remaining: 0, cycleEnd: at(-1_000) } } }));
    expect(d.action).toBe('send');
  });
});

describe('S7 extra protection in the policy', () => {
  it('AC-7.4 the reaction brake doubles new-chat gaps and stacks with the cap warning', () => {
    const braked = { ...OPEN, brakeOn: true };
    expect(gapFactorFor(true, braked)).toBe(2);
    expect(gapFactorFor(false, braked)).toBe(1);
    expect(gapFactorFor(true, { ...braked, capping: { status: 'SECOND_WARNING', remaining: 5, cycleEnd: null } })).toBe(6);
  });

  it('AC-7.5 holds campaign and AI first messages in quiet hours, until they end', async () => {
    const night = new Date('2026-11-02T17:30:00.000Z');          // 23:00 in Asia/Kolkata
    const morning = new Date('2026-11-03T02:30:00.000Z');         // 08:00 in Asia/Kolkata
    for (const priority of ['campaign', 'ai'] as const) {
      expect(await ask(ctx({ now: night, priority }))).toEqual({ action: 'hold', reason: 'quiet_hours', until: morning });
    }
  });

  it('AC-7.5 replies and messages an agent typed still go in quiet hours', async () => {
    const night = new Date('2026-11-02T17:30:00.000Z');
    for (const priority of ['reply', 'manual'] as const) {
      expect((await ask(ctx({ now: night, priority, newChat: false }))).action).toBe('send');
    }
  });

  it('AC-7.5 quiet hours can be switched off for the org', async () => {
    const night = new Date('2026-11-02T17:30:00.000Z');
    expect((await ask(ctx({ now: night, quiet: { enabled: false } }))).action).toBe('send');
  });
});

describe('holds on one contact or the whole number', () => {
  it('AC-2.6 a contact hold from the lookup holds the message with its reason', async () => {
    const d = await ask(ctx({ contactHold: { reason: 'refused_463', until: null } }));
    expect(d).toEqual({ action: 'hold', reason: 'refused_463', until: null });
  });

  it('AC-8.1 every hold names a reason from the typed list and when it is expected to lift, or null', async () => {
    const holds: SendDecision[] = [
      await ask(ctx({ number: { timelock: { active: true, until: at(1000), type: null } } })),
      await ask(ctx({ number: { capping: { status: 'CAPPED', remaining: 0, cycleEnd: at(1000) } } })),
      await ask(ctx({ now: new Date('2026-11-02T17:30:00.000Z') })),
      await ask(ctx({ contactHold: { reason: 'refused_463', until: null } })),
      await ask(ctx({ number: { hold: { reason: 'many_undelivered', until: null } } }))
    ];
    for (const d of holds) {
      expect(d.action).toBe('hold');
      if (d.action !== 'hold') continue;
      expect(HOLD_REASONS).toContain(d.reason);
      expect(d.until === null || d.until instanceof Date).toBe(true);
    }
  });

  it('AC-8.1 the typed list already carries the codes of S4 to S6, so those stories add holds without touching the policy', () => {
    for (const code of ['many_undelivered', 'decrypt_retry', 'decrypt_wave', 'likely_blocked', 'dnc', 'refused_463', 'unlinked']) {
      expect(HOLD_REASONS).toContain(code);
    }
  });

  it('a hold on the whole number wins over everything else', async () => {
    const d = await ask(ctx({ number: { hold: { reason: 'decrypt_wave', until: null } }, contactHold: { reason: 'refused_463', until: null } }));
    expect(d).toEqual({ action: 'hold', reason: 'decrypt_wave', until: null });
  });
});

describe('S9 the policy is a driver', () => {
  it('AC-9.1 the v2 policy implements the AntiBanPolicy seam, and a fixed policy fits the same type', async () => {
    const real: AntiBanPolicy = makeAntiBanPolicy();
    const fixed: AntiBanPolicy = { beforeSend: () => Promise.resolve({ action: 'send' }), campaignBatch: () => 3 };
    expect(await real.beforeSend(ctx())).toEqual({ action: 'send' });
    expect(await fixed.beforeSend(ctx({ number: { timelock: { active: true, until: null, type: null } } }))).toEqual({ action: 'send' });
  });

  it('AC-9.1 queues campaign messages a few at a time per number, counting what already waits', () => {
    expect(policy.campaignBatch({ senderIdentityId: 's1', waiting: 0 })).toBe(CAMPAIGN_QUEUE_AHEAD);
    expect(policy.campaignBatch({ senderIdentityId: 's1', waiting: 5 })).toBe(CAMPAIGN_QUEUE_AHEAD - 5);
    expect(policy.campaignBatch({ senderIdentityId: 's1', waiting: 500 })).toBe(0);
  });
});
