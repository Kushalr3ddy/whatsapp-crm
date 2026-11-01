import { NEW_NUMBER_DAYS } from './constants.js';

/** One piece of advice for a number. Never blocks anything (AC-7.6). */
export interface NumberHint {
  readonly code: 'new_number' | 'use_phone_too';
  readonly text: string;
}

/**
 * Advice about a number, from what is known about it: a number linked in the last 7 days should go gently, and one whose
 * timelock type is `WEB_COMPANION_ONLY` should also be used on the phone itself. Advice only: nothing here changes what is sent.
 */
export function numberHints(input: {
  readonly linkedSince: Date | null; readonly timelockType: string | null; readonly now: Date;
}): NumberHint[] {
  const out: NumberHint[] = [];
  if (input.linkedSince !== null && input.now.getTime() - input.linkedSince.getTime() < NEW_NUMBER_DAYS * 24 * 3_600_000) {
    out.push({ code: 'new_number', text: 'This number was linked less than 7 days ago. New numbers do best when they start gently.' });
  }
  if (input.timelockType === 'WEB_COMPANION_ONLY') {
    out.push({ code: 'use_phone_too', text: 'WhatsApp limits this number because it is only used through a linked device. Use WhatsApp on the phone itself too.' });
  }
  return out;
}
