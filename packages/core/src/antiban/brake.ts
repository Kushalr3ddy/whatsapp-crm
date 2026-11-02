import {
  BRAKE_BLOCKED_RATIO, BRAKE_MIN_SENT, BRAKE_REPLY_RATIO
} from './constants.js';

/** How the number's latest new-chat sends went (the newest `BRAKE_WINDOW` of them). */
export interface NewChatOutcomes {
  /** New-chat first messages sent. */
  readonly sent: number;
  /** Of those, how many got a reply. */
  readonly replied: number;
  /** Of those, how many contacts are now marked `likely_blocked` (S4). */
  readonly likelyBlocked: number;
}

/**
 * The reaction brake (AC-7.4): the people being messaged are the best signal of how the number is doing. Over the latest 50
 * new-chat sends, if 10% or more probably blocked us, or (with at least 30 sent) fewer than 5% replied, new-chat gaps double.
 * Stateless on purpose: it is read again from the same window each time, so it lifts by itself once both figures recover.
 */
export function reactionBrakeOn(o: NewChatOutcomes): boolean {
  if (o.sent <= 0) return false;
  if (o.likelyBlocked / o.sent >= BRAKE_BLOCKED_RATIO) return true;
  return o.sent >= BRAKE_MIN_SENT && o.replied / o.sent < BRAKE_REPLY_RATIO;
}
