import { renderBody } from '../body-variation.js';
import { seededRandom } from './gap.js';
import { splitFirstMessage, type FirstMessageSplit } from './first-message.js';

/** The pieces of a contact a campaign body can use. */
export interface RecipientText {
  readonly campaignId: string;
  readonly contactId: string;
  readonly displayName: string | null;
  readonly customFields: Record<string, unknown> | null;
}

/**
 * One recipient's copy of a campaign body (AC-7.2). `{Hi|Hello|Hey}` picks one wording from a draw seeded by the campaign and the
 * contact, so the same person always gets the same pick (the schedule and the ETA can be worked out before anything is sent, and a
 * re-render never changes the text). `{{name}}`, `{{first_name}}` and the org's custom fields are filled from the contact.
 */
export function renderRecipientBody(template: string, r: RecipientText): string {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.customFields ?? {})) vars[k.toLowerCase()] = String(v);
  const name = r.displayName ?? '';
  return renderBody(
    template, { ...vars, name, first_name: name.trim().split(/\s+/)[0] ?? '' },
    seededRandom(`${r.campaignId}:${r.contactId}`)
  );
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
