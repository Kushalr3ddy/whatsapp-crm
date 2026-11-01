import {
  FAST_DELIVERY_LOOKBACK, FAST_DELIVERY_MS, STUCK_HOLD_AT, STUCK_LIFT_BELOW
} from './constants.js';

/** What a contact's profile showed (or shows) this number: whether the photo and the about could be fetched. */
export interface ProfileSeen { readonly photo: boolean; readonly about: boolean }
/** What it showed at the last delivery to them, and when. */
export interface ProfileSnapshot extends ProfileSeen { readonly at: string }
/** What a message stuck at one tick most likely means. */
export type UnreachedVerdict = 'likely_blocked' | 'likely_offline';

/**
 * A message is still at one tick 30 minutes after it went (F6 AC-4.3, AC-4.4). Blocking hides a profile photo and the about text, so
 * both visible at the last delivery and both gone now is the pattern of a block. Anything less (either still visible, nothing to compare
 * with, or only one of the two was ever visible, which could just as well be a changed privacy setting) is read as a phone that is
 * switched off or out of coverage. A guess either way, which is why it never resends and only stops campaigns and the AI.
 */
export function judgeUnreached(before: ProfileSnapshot | null, now: ProfileSeen): UnreachedVerdict {
  if (before !== null && before.photo && before.about && !now.photo && !now.about) return 'likely_blocked';
  return 'likely_offline';
}

/**
 * Whether a contact "delivers fast" (F6 AC-4.5): one of the last 3 messages we sent them (newest first) was delivered within 5 minutes.
 * A slow phone being behind is not evidence of anything; a phone that always delivered within minutes and now does not, is.
 */
export function deliversFast(lastThree: ReadonlyArray<{ sentAt: Date; deliveredAt: Date | null }>): boolean {
  return lastThree.slice(0, FAST_DELIVERY_LOOKBACK).some((m) =>
    m.deliveredAt !== null && m.deliveredAt.getTime() - m.sentAt.getTime() <= FAST_DELIVERY_MS);
}

/**
 * What to do with the number's campaigns given how many of its latest sends to fast-delivering contacts are still at one tick after 30
 * minutes (F6 AC-4.6, AC-4.7): hold at 8 or more, lift below 4, and in between leave things as they are, so the hold does not flap.
 */
export function stuckDecision(i: { stuck: number; held: boolean }): 'hold' | 'lift' | 'none' {
  if (!i.held) return i.stuck >= STUCK_HOLD_AT ? 'hold' : 'none';
  return i.stuck < STUCK_LIFT_BELOW ? 'lift' : 'none';
}
