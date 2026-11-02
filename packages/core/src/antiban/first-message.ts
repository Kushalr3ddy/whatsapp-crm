/** Matches a web link in message text. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

/** What a campaign message to a new chat becomes when its picture or link waits for a reply (AC-7.3). */
export interface FirstMessageSplit {
  /** The text that goes now. */
  readonly text: string;
  /** Whether the picture goes with it (never, when it is split). */
  readonly withMedia: boolean;
  /** What goes when they reply: the link text, the picture, or both. */
  readonly followUp: { readonly text: string; readonly withMedia: boolean };
}

/**
 * Splits a campaign message for a new chat: the text alone now, the picture or link when they reply. Returns null when there is
 * nothing to hold back (no link and no picture), or when removing the link would leave nothing to say.
 */
export function splitFirstMessage(body: string, hasMedia: boolean): FirstMessageSplit | null {
  const links = body.match(URL_PATTERN) ?? [];
  if (links.length === 0 && !hasMedia) return null;
  const text = links.length === 0
    ? body
    : body.replace(URL_PATTERN, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text === '') return null;
  return { text, withMedia: false, followUp: { text: links.join(' '), withMedia: hasMedia } };
}

/** Whether campaign text has any variation: a `{a|b}` choice. A campaign with none (and no AI writing) gets a warning (AC-7.2). */
export function hasVariation(body: string): boolean {
  return /\{[^{}]*\|[^{}]*\}/.test(body);
}
