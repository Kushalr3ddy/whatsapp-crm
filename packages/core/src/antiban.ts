/**
 * The seam every outbound message passes through on its way to the provider.
 *
 * The gateway gathers what it knows about the number, the contact and the message into a `SendContext` and asks the policy
 * two questions and nothing else: may this message go now (`beforeSend`), and how many more campaign messages may be queued
 * for this number (`campaignBatch`). Everything that decides how fast, how many and when lives behind this interface, so a
 * replacement driver plugs in here and the send path does not change. `antiban/policy.ts` is the v2 driver; a test can pass
 * a fixed one.
 *
 * What does not go through the policy, and cannot be relaxed by it (AC-9.2): who may be messaged at all (do-not-contact, the
 * recipient policy gates in `policy-gates.ts`), a number that is not connected, and the typing beat.
 */

/**
 * Why a message is held in the lane. Typed, so the screens (S10) and the other stories (S4 to S6) share one list. The codes
 * `many_undelivered`, `decrypt_retry`, `decrypt_wave`, `likely_blocked` and `dnc` belong to the stories that are not built yet:
 * they are here so their hold can be returned from `numberHold` / `contactHold` in `antiban/holds.ts` without touching the policy.
 */
export const HOLD_REASONS = [
  'timelock', 'new_chat_cap', 'refused_463', 'unlinked', 'many_undelivered', 'decrypt_retry', 'decrypt_wave',
  'likely_blocked', 'dnc', 'quiet_hours', 'sender_not_connected'
] as const;
/** One of the reasons a message can be held. */
export type HoldReason = typeof HOLD_REASONS[number];

/** A hold and when it is expected to lift, or null when it waits for something (AC-8.1). */
export interface Hold {
  readonly reason: HoldReason;
  readonly until: Date | null;
}

/**
 * The lane's order, highest first: a reply (answers an inbound from the last 24 hours), a message an agent typed, a message the
 * AI wrote, a campaign message. Within one priority, oldest first.
 */
export const LANE_PRIORITIES = ['reply', 'manual', 'ai', 'campaign'] as const;
/** One place in the lane's order. */
export type LanePriority = typeof LANE_PRIORITIES[number];

/** WhatsApp's own scale for how close a number is to its new-chat limit. */
export type CappingStatus = 'NONE' | 'FIRST_WARNING' | 'SECOND_WARNING' | 'CAPPED';

/** What WhatsApp last said about the number's limits (S2), plus the figures derived from it. */
export interface NumberState {
  readonly timelock: { readonly active: boolean; readonly until: Date | null; readonly type: string | null };
  readonly capping: {
    readonly status: CappingStatus | null;
    /** New chats left in this cycle: the quota WhatsApp reported less the new chats we started since, or null when unknown. */
    readonly remaining: number | null;
    readonly cycleEnd: Date | null;
  };
  /** A hold on the whole number (unlinked, many undelivered, decrypt wave), or null. */
  readonly hold: Hold | null;
  /** The reaction brake is on: new-chat gaps are doubled (AC-7.4). */
  readonly brakeOn: boolean;
}

/** Quiet hours as the org has set them (AC-7.5). */
export interface QuietHoursSetting {
  readonly enabled: boolean;
  /** Local `HH:MM`. The window may cross midnight. */
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
}

/** The message about to go out. */
export interface SendMessage {
  readonly id: string;
  readonly contactId: string;
  readonly priority: LanePriority;
  /** The contact has never sent this number a message. */
  readonly newChat: boolean;
  /** The gap this message waits after the previous send, drawn once and stored (AC-3.1). The policy applies its multipliers. */
  readonly plannedGapMs: number;
}

/** What the gateway tells the policy about the message about to go out. */
export interface SendContext {
  readonly senderIdentityId: string;
  readonly now: Date;
  /** When this number last sent anything (a reply, an AI message or a campaign message), or null if never. */
  readonly lastSentAt: Date | null;
  readonly message: SendMessage;
  readonly number: NumberState;
  /** A hold on this one contact (refused 463, decrypt retry, likely blocked, do-not-contact), or null. */
  readonly contactHold: Hold | null;
  readonly quietHours: QuietHoursSetting;
}

/** The policy's answer: go, go after a pause, or leave the message queued with a reason shown in the thread. */
export type SendDecision =
  | { readonly action: 'send' }
  | { readonly action: 'wait'; readonly ms: number }
  | { readonly action: 'hold'; readonly reason: HoldReason; readonly until: Date | null };

/** What the gateway tells the policy when it is about to top a campaign's queue up. */
export interface BatchContext {
  readonly senderIdentityId: string;
  /** Messages already queued and not yet sent for this number, from any source. */
  readonly waiting: number;
}

/** What a driver provides: the two questions the gateway asks, and nothing else. */
export interface AntiBanPolicy {
  /** Called once per send attempt, after the gates that protect people and before anything reaches the provider. */
  beforeSend(ctx: SendContext): Promise<SendDecision>;
  /** How many more campaign messages the dispatcher may queue for this number right now. */
  campaignBatch(ctx: BatchContext): number;
}
