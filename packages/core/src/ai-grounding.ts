/**
 * Catching what the AI was never told (#47, #92, and the same cause in #56).
 *
 * The model is told in words never to guess, and still sometimes does: it asked a person to confirm "tomorrow 11 am" for an interview the chat
 * showed at 4:00 PM on 15 Nov, and told another to "bring a copy of your resume and a valid ID" that no instruction mentioned. A rule written in
 * the prompt is a request, not a guarantee, and a customer then acts on the invented detail.
 *
 * So the answer is checked before it is queued, with plain rules, not with the model: every concrete detail in the reply that a customer could act
 * on (a clock time, a date, an amount of money, a document to bring) must already appear in what the AI was given: the organisation's instructions,
 * what is known about the person, or the chat itself. A detail that appears nowhere is the model's own invention.
 */

/** One concrete detail in a reply that appears nowhere in what the AI was given. */
export interface UngroundedClaim {
  readonly kind: 'time' | 'date' | 'amount' | 'document';
  /** The words as the reply wrote them. */
  readonly text: string;
}

/** Lower case, one space between words, no thousands commas, "p.m." as "pm": so "4:00 PM", "4:00 pm" and "4:00  p.m." read alike. */
function plain(text: string): string {
  return text.toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[‘’“”]/g, "'")
    .replace(/\b([ap])\.m\.?/g, '$1m')
    .replace(/\s+/g, ' ');
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DOCUMENT_WORDS = 'resume|resumé|cv|curriculum vitae|id proof|id card|photo id|valid id|id|aadhaar|aadhar|pan card|passport|driving licen[cs]e|licen[cs]e|certificates?|marksheets?|photocopy|photocopies|photographs?|photos?|documents?|originals?';
const BRING = 'bring|carry|submit|show|keep ready|have ready|must have|need to have|needs? to bring|required|requirements?|along with';

/** True when `needle` is in `corpus`, ignoring spaces, so "4pm" is found in "4 pm". */
function mentioned(corpus: string, needle: string): boolean {
  return corpus.includes(needle) || corpus.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''));
}

/**
 * The concrete details in `reply` that `given` (the instructions, the facts about the person, and every message of the chat) does not contain.
 * A time or date counts as given when the same figures appear; an amount when the same number appears; a document when the same word appears
 * (anywhere in what was given, including something the customer asked about).
 */
export function ungroundedClaims(reply: string, given: string): UngroundedClaim[] {
  const text = plain(reply);
  const corpus = plain(given);
  const squeezed = corpus.replace(/\s+/g, '');
  const found: UngroundedClaim[] = [];
  const add = (kind: UngroundedClaim['kind'], t: string): void => {
    if (!found.some((f) => f.kind === kind && f.text === t)) found.push({ kind, text: t });
  };

  // Clock times: "11 am", "4:00 pm", "4.30 pm". "4 pm" and "4:00 pm" are the same time.
  for (const m of text.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)\b/g)) {
    const hour = m[1]!.replace(/^0(?=\d)/, '');
    const minute = m[2] ?? '00';
    const ap = m[3]!;
    const variants = minute === '00' ? [`${hour}:00${ap}`, `${hour}${ap}`] : [`${hour}:${minute}${ap}`, `${hour}.${minute}${ap}`];
    if (!variants.some((v) => squeezed.includes(v))) add('time', m[0].trim());
  }
  // A 24-hour time such as 16:30.
  for (const m of text.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b(?!\s?(?:am|pm))/g)) {
    if (!corpus.includes(m[0])) add('time', m[0]);
  }

  // Dates: "15 nov", "15th november", "nov 15".
  const dateRule = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s?(?:of\\s)?(${MONTHS})\\b|\\b(${MONTHS})\\s(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g');
  for (const m of text.matchAll(dateRule)) {
    const day = m[1] ?? m[4]!;
    const month = (m[2] ?? m[3]!).slice(0, 3);
    const given1 = new RegExp(`\\b${day}(?:st|nd|rd|th)?\\s?(?:of\\s)?${month}`).test(corpus) || new RegExp(`\\b${month}[a-z]*\\s${day}\\b`).test(corpus);
    if (!given1) add('date', m[0]);
  }
  // Numeric dates: "2026-11-15", "15/11", "15/11/2026".
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)) {
    if (!corpus.includes(m[0])) add('date', m[0]);
  }

  // Money: "₹25,000", "rs. 20000", "25000 per month", "6 lpa".
  for (const m of text.matchAll(/(?:₹|\brs\.?|\binr)\s?(\d[\d.]*)|\b(\d[\d.]*)\s?(?:lpa|lakhs?|k\b|per month|a month|\/month|per day|\/day)/g)) {
    const n = (m[1] ?? m[2]!).replace(/\.$/, '');
    if (!new RegExp(`(?<![\\d.])${n.replace(/\./g, '\\.')}(?!\\d)`).test(corpus)) add('amount', m[0].trim());
  }

  // A document to bring or show that nobody mentioned.
  const documentRule = new RegExp(`\\b(?:${BRING})\\b[^.?!\\n]{0,70}?\\b(${DOCUMENT_WORDS})\\b`, 'g');
  for (const m of text.matchAll(documentRule)) {
    const word = m[1]!;
    const stem = word.length > 3 ? word.replace(/s$/, '') : word;
    if (!new RegExp(`\\b${stem}`).test(corpus) && !mentioned(corpus, stem)) add('document', word);
  }
  return found;
}

/** What goes to the customer when the AI keeps inventing details: nothing it could be held to, and a person is told. */
export const UNGROUNDED_FALLBACK_REPLY = 'Let me get a colleague to confirm that for you, and they will get back to you shortly.';

/** The correction given to the model for its second try. */
export function groundingCorrection(claims: readonly UngroundedClaim[]): string {
  const list = claims.map((c) => `"${c.text}"`).join(', ');
  return `Your answer contained details that you were never given: ${list}. Do not state them. Answer again using only what the instructions, what is known about the person and this chat say. If they need one of those details, say a colleague will confirm it.`;
}
