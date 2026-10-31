import type { AntiBanPolicy, NumberState, SendContext, SendDecision } from '../antiban.js';
import {
  BRAKE_GAP_FACTOR, CAMPAIGN_QUEUE_AHEAD, FIRST_WARNING_GAP_FACTOR, SECOND_WARNING_GAP_FACTOR
} from './constants.js';
import { quietHoursEnd } from './quiet-hours.js';

/**
 * How much longer the gap before a message is than the one drawn for it. Only new chats are slowed: a known contact is a
 * conversation already open, which is not what WhatsApp's new-chat warnings are about (AC-2.3). The reaction brake stacks
 * with the cap's warning, because they are two separate signals.
 */
export function gapFactorFor(newChat: boolean, number: NumberState): number {
  if (!newChat) return 1;
  const status = number.capping.status;
  let factor = status === 'FIRST_WARNING' ? FIRST_WARNING_GAP_FACTOR : status === 'SECOND_WARNING' ? SECOND_WARNING_GAP_FACTOR : 1;
  if (number.brakeOn) factor *= BRAKE_GAP_FACTOR;
  return factor;
}

/**
 * The v2 anti-ban policy (F6). It acts on what WhatsApp tells the number and on the state of the contact, spaces sends with the
 * gap drawn for each message, and keeps campaign and AI first messages out of quiet hours. It decides; it does not send, wait
 * or sleep: the lane in the gateway does, and records why.
 *
 * Pure on purpose: everything it reads is in the context, so the same context always gives the same answer and a test can
 * pin any situation. There are no daily caps and no per-day counters (a user decision); the only limits are WhatsApp's own signals.
 */
export function makeAntiBanPolicy(): AntiBanPolicy {
  return {
    beforeSend(ctx: SendContext): Promise<SendDecision> {
      return Promise.resolve(decide(ctx));
    },
    campaignBatch({ waiting }) {
      return Math.max(0, CAMPAIGN_QUEUE_AHEAD - waiting);
    }
  };
}

/** The decision for one message, in the order the reasons matter: the whole number, then the contact, then the clock. */
function decide(ctx: SendContext): SendDecision {
  const { message, number, now } = ctx;

  if (number.hold !== null) return { action: 'hold', ...number.hold };
  if (ctx.contactHold !== null) return { action: 'hold', ...ctx.contactHold };

  if (message.newChat) {
    // AC-2.1: a timelock holds new chats until it ends; known contacts still get their messages.
    const lock = number.timelock;
    if (lock.active && (lock.until === null || lock.until.getTime() > now.getTime())) {
      return { action: 'hold', reason: 'timelock', until: lock.until };
    }
    // AC-2.4: the new-chat cap is used up. Either WhatsApp says CAPPED, or the quota it gave us has run out.
    const cap = number.capping;
    const cycleOpen = cap.cycleEnd !== null && cap.cycleEnd.getTime() > now.getTime();
    if (cap.status === 'CAPPED' && (cap.cycleEnd === null || cycleOpen)) {
      return { action: 'hold', reason: 'new_chat_cap', until: cap.cycleEnd };
    }
    if (cap.remaining !== null && cap.remaining <= 0 && cycleOpen) {
      return { action: 'hold', reason: 'new_chat_cap', until: cap.cycleEnd };
    }
  }

  // AC-7.5: campaign and AI first messages wait out quiet hours. A reply or something an agent typed still goes.
  if (message.priority === 'campaign' || message.priority === 'ai') {
    const quietEnds = quietHoursEnd(now, ctx.quietHours);
    if (quietEnds !== null) return { action: 'hold', reason: 'quiet_hours', until: quietEnds };
  }

  // AC-1.3: the first message of a run goes without a gap; the next waits the gap drawn for it, counted from the previous send.
  // After a silence of 90 s or more (a new run) the gap has long passed, so it needs no rule of its own: the remainder is below zero.
  if (ctx.lastSentAt === null) return { action: 'send' };
  const gap = Math.round(message.plannedGapMs * gapFactorFor(message.newChat, number));
  const remaining = gap - (now.getTime() - ctx.lastSentAt.getTime());
  return remaining > 0 ? { action: 'wait', ms: remaining } : { action: 'send' };
}
