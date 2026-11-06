import { blankFillIns, renderBody } from '../body-variation.js';
import { seededRandom } from './gap.js';
import { splitFirstMessage, type FirstMessageSplit } from './first-message.js';

/** The pieces of a contact a campaign body can use. */
export interface RecipientText {
  readonly campaignId: string;
  readonly contactId: string;
  readonly displayName: string | null;
  readonly customFields: Record<string, unknown> | null;
  /** Text for a fill-in this person has no value for (CW-7.7); without one, a blank fill-in stays empty. */
  readonly fallback?: string | null | undefined;
}

/** The values one contact offers to `{{fill-ins}}`: the name, its first word, and every custom field they have set. */
export function recipientVars(r: RecipientText): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.customFields ?? {})) if (v !== null && v !== undefined) vars[k.toLowerCase()] = String(v);
  // A person with no name saved reads "there" ("Hi there"): never blank, never skipped, nothing for anyone to decide.
  const saved = (r.displayName ?? '').trim();
  // A name that is only a phone number (how a person saved without a name used to be named) is no name: nobody greets "Hi +91…".
  const name = /^\+?[\d\s().-]{6,}$/.test(saved) ? '' : saved;
  return { ...vars, name: name === '' ? 'there' : name, first_name: name === '' ? 'there' : name.split(/\s+/)[0] ?? 'there' };
}

/** The fill-ins in a body that this person has no value for, limited to `known` keys (CW-7.7: an unknown key is not "missing"). */
export function missingFillIns(template: string, r: RecipientText, known: readonly string[]): string[] {
  const have = new Set(known.map((k) => k.toLowerCase()));
  return blankFillIns(template, recipientVars(r)).filter((k) => have.has(k));
}

/**
 * One recipient's copy of a campaign body (AC-7.2). `{Hi|Hello|Hey}` picks one wording from a draw seeded by the campaign and the
 * contact, so the same person always gets the same pick (the schedule and the ETA can be worked out before anything is sent, and a
 * re-render never changes the text). `{{name}}`, `{{first_name}}` and the org's custom fields are filled from the contact.
 */
export function renderRecipientBody(template: string, r: RecipientText): string {
  return renderBody(template, recipientVars(r), seededRandom(`${r.campaignId}:${r.contactId}`), r.fallback);
}

/**
 * What goes to a recipient in the first message (AC-7.3). A new chat on a campaign with "media after reply" on gets the text
 * alone; the picture or link is held for when they reply. Everyone else gets it all at once. `split` is null in that case.
 */
export function planFirstMessage(input: {
  readonly rendered: string; readonly hasMedia: boolean; readonly newChat: boolean; readonly mediaAfterReply: boolean;
}): { readonly text: string; readonly withMedia: boolean; readonly split: FirstMessageSplit | null } {
  const split = input.newChat && input.mediaAfterReply ? splitFirstMessage(input.rendered, input.hasMedia) : null;
  return split === null
    ? { text: input.rendered, withMedia: input.hasMedia, split: null }
    : { text: split.text, withMedia: split.withMedia, split };
}
