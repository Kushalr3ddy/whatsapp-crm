/**
 * The pure parts of the Inbox screen: how a time reads in the list, how a search word is marked in a name or a message, and where a
 * chat shows "campaign started" dividers. No React, no network, so each is tested alone.
 */

/** A piece of text, and whether it is the part the search matched. */
export interface Piece { text: string; hit: boolean }

/** Splits `text` around the first place `word` occurs (case does not matter). With no word, or no match, it is one plain piece. */
export function highlightPieces(text: string, word: string): Piece[] {
  const w = word.trim().toLowerCase();
  if (w === '') return [{ text, hit: false }];
  const at = text.toLowerCase().indexOf(w);
  if (at < 0) return [{ text, hit: false }];
  return [
    ...(at > 0 ? [{ text: text.slice(0, at), hit: false }] : []),
    { text: text.slice(at, at + w.length), hit: true },
    ...(at + w.length < text.length ? [{ text: text.slice(at + w.length), hit: false }] : [])
  ];
}

/** The part of a long message around the match, with "…" where it was cut, so the match is visible in two lines. */
export function snippetAround(text: string, word: string, width = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(word.trim().toLowerCase());
  if (at < 0 || flat.length <= width) return flat;
  const from = Math.max(0, at - 24);
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + width)}${flat.length > from + width ? '…' : ''}`;
}

/** What the last-message line says for a message that has no text of its own. */
export function kindLabel(kind: string): string {
  if (kind === 'image') return 'Photo';
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Voice message';
  if (kind === 'document') return 'Document';
  return 'Message';
}

/** "2:48 pm" today, "Yesterday", or "2 Nov" before that, for the list. */
export function listWhen(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return '';
  const when = new Date(iso);
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);
  if (days <= 0) return when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
  if (days === 1) return 'Yesterday';
  return when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The date and time a campaign started in a chat, like "2 Nov, 2:36 pm". */
export function dividerWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
}

/** Just enough of a message to place a divider before it. */
export interface DividerSource { id: string; direction: 'inbound' | 'outbound'; campaignId?: string | null; createdAt: string }

/**
 * The messages that open a campaign in this chat: the first outbound message of each run of one campaign. A campaign that comes back
 * after another one in between starts again; a second message of the same campaign does not.
 */
export function campaignStarts(messages: readonly DividerSource[]): Set<string> {
  const starts = new Set<string>();
  let current: string | null = null;
  for (const m of messages) {
    if (m.direction !== 'outbound') continue;
    const id = m.campaignId ?? null;
    if (id !== null && id !== current) starts.add(m.id);
    current = id ?? current;
  }
  return starts;
}

/** The first one or two letters of a name for an avatar, or the last two digits of a number. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (/^\d+$/.test(words[0]!)) return words[0]!.slice(-2);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
