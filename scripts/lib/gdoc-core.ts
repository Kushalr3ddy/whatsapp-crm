/**
 * Reading testers' feedback (pure functions: no Node, no browser APIs, so the same code runs in the CRM's scripts, in tests and inside the browser tool) and turning it into the markdown the importer understands (D-92).
 *
 * The doc is plain: one problem after another, each started by a heading or a numbered line, with the screenshot pasted under it.
 * Nothing here needs AI: it splits on those two markers and keeps the person's own words. (AI for messy docs, and for drafting follow-up
 * questions, is pinned.) Screenshots are never copied: they stay in the doc, which is private; only "[image]" markers are counted.
 */

/** One problem found in the doc. */
export interface FeedbackItem {
  /** The number typed in the doc, or the position when the doc uses headings. */
  readonly n: number;
  readonly title: string;
  /** The person's words, one line each, without the image markers. */
  readonly lines: readonly string[];
  /** How many screenshots sit under this problem. */
  readonly images: number;
  /** Lines of the form "Label: value" for the known template labels. */
  readonly fields: ReadonlyArray<readonly [string, string]>;
}

/** The labelled lines of the feedback template (docs/feedback/TEMPLATE.md), matched without regard to capitals. */
const LABELS = ['which screen', 'what i did', 'what i expected', 'what happened instead', 'where', 'how much it gets in the way'];

/** The id of a Google Doc, from a link or a bare id. */
export function docIdFrom(urlOrId: string): string {
  const m = /\/document\/d\/([\w-]+)/.exec(urlOrId);
  const id = m?.[1] ?? urlOrId.trim();
  if (!/^[\w-]{20,}$/.test(id)) throw new Error('that does not look like a Google Doc link or id');
  return id;
}

/** A short title from a longer line: up to the first colon-free sentence end, 90 characters at most, no trailing punctuation. */
export function titleFrom(line: string): string {
  let t = line.trim().replace(/\s+/g, ' ');
  const stop = t.search(/[.!?](\s|$)/);
  if (stop > 12) t = t.slice(0, stop);
  if (t.length > 90) t = `${t.slice(0, 90).replace(/\s+\S*$/, '')}…`;
  return t.replace(/[:;,\s]+$/, '');
}

/**
 * Splits the text of a feedback doc into problems. A problem starts at a heading ("# …", "## …", "### …") or a numbered line
 * ("1. …", "2) …"); text before the first one is ignored. Everything until the next start belongs to it.
 */
export function splitProblems(text: string): FeedbackItem[] {
  const items: Array<{ n: number; title: string; raw: string[]; images: number }> = [];
  const start = /^\s*(?:#{1,3}\s+(.+)|(\d+)[.)]\s+(.+))\s*$/;
  // Google's text export escapes markdown characters ("2\\.", "\\[image\\]"): undo that first.
  for (const line of text.replace(/\\([\\[\]().#*_!-])/g, '$1').split('\n')) {
    const s = start.exec(line);
    // A heading or a numbered line starts a new problem, except the template's own "Which screen:" style lines, which are never starts.
    if (s !== null && !LABELS.some((l) => line.toLowerCase().includes(`${l}:`))) {
      const n = s[2] !== undefined ? Number(s[2]) : items.length + 1;
      const bodyRaw = (s[1] ?? s[3] ?? '').trim();
      // A screenshot pasted at the end of the problem's own line counts for that problem.
      const images = (bodyRaw.match(/\[image\]/gi) ?? []).length;
      const body = bodyRaw.replace(/\[image\]/gi, '').trim();
      items.push({ n, title: s[1] !== undefined ? body.replace(/^\d+[.)]\s*/, '') : titleFrom(body), raw: s[1] !== undefined ? [] : [body], images });
      continue;
    }
    const current = items[items.length - 1];
    if (current === undefined) continue;
    const imageCount = (line.match(/\[image\]/gi) ?? []).length;
    current.images += imageCount;
    const cleaned = line.replace(/\[image\]/gi, '').replace(/\\([\\[\]()#.*_-])/g, '$1').trim();
    if (cleaned !== '') current.raw.push(cleaned);
  }
  return items.map((it) => {
    const fields: Array<readonly [string, string]> = [];
    for (const l of it.raw) {
      const m = /^([^:]{3,40}):\s*(.+)$/.exec(l);
      if (m !== null && LABELS.includes(m[1]!.trim().toLowerCase().replace(/\*+/g, ''))) fields.push([m[1]!.trim().replace(/\*+/g, ''), m[2]!.trim()]);
    }
    return { n: it.n, title: it.title, lines: it.raw, images: it.images, fields };
  }).filter((it) => it.title !== '' || it.lines.length > 0);
}

/** The markdown the importer reads (`## issue-N: title`, the person's words as a quote, one screenshot marker per image). */
export function toImporterMarkdown(items: readonly FeedbackItem[], opts: { reporter: string; docId: string; date: string }): string {
  const out: string[] = [`# Feedback from ${opts.reporter}: Google Doc ${opts.docId.slice(0, 8)}…, read ${opts.date}`, ''];
  for (const it of items) {
    out.push(`## issue-${String(it.n)}: ${it.title}`, '');
    for (let i = 1; i <= it.images; i++) out.push(`![screenshot in the Google Doc, item ${String(it.n)}${it.images > 1 ? `, ${String(i)} of ${String(it.images)}` : ''}](gdoc-item-${String(it.n)}-${String(i)})`);
    if (it.images > 0) out.push('');
    out.push(`**Original text (${opts.reporter}):**`);
    const words = it.lines.length > 0 ? it.lines : [it.title];
    for (const l of words) out.push(`> ${l}`);
    out.push('');
    if (it.fields.length > 0) {
      out.push('**Summary:**');
      for (const [k, v] of it.fields) out.push(`- ${k}: ${v}`);
      out.push('');
    }
    out.push('---', '');
  }
  return out.join('\n');
}

/** Google's structured document, only the parts read here. */
export interface DocJson {
  body?: { content?: Array<{ paragraph?: {
    elements?: Array<{ textRun?: { content?: string }; inlineObjectElement?: unknown }>;
    paragraphStyle?: { namedStyleType?: string };
    bullet?: { listId?: string; nestingLevel?: number };
  } }> };
  lists?: Record<string, { listProperties?: { nestingLevels?: Array<{ glyphType?: string }> } }>;
}

/** Turns Google's structured document into the plain text `splitProblems` reads: headings as "##", numbered lists as "1.", images as "[image]". */
export function docJsonToText(doc: DocJson): string {
  const lines: string[] = [];
  const counters = new Map<string, number>();
  for (const el of doc.body?.content ?? []) {
    const p = el.paragraph;
    if (p === undefined) continue;
    const text = (p.elements ?? []).map((e) => (e.inlineObjectElement !== undefined ? ' [image] ' : e.textRun?.content ?? '')).join('').replace(/\n+$/, '');
    if (text.trim() === '') continue;
    const style = p.paragraphStyle?.namedStyleType ?? '';
    if (/^HEADING_[1-3]$/.test(style)) { lines.push(`## ${text.trim()}`); continue; }
    if (p.bullet !== undefined && (p.bullet.nestingLevel ?? 0) === 0 && p.bullet.listId !== undefined) {
      const glyph = doc.lists?.[p.bullet.listId]?.listProperties?.nestingLevels?.[0]?.glyphType ?? '';
      if (glyph.startsWith('DECIMAL')) {
        const next = (counters.get(p.bullet.listId) ?? 0) + 1;
        counters.set(p.bullet.listId, next);
        lines.push(`${String(next)}. ${text.trim()}`);
        continue;
      }
    }
    lines.push(text.trim());
  }
  return lines.join('\n');
}


/** Decodes the few HTML entities Google writes in a document. */
function decodeEntities(t: string): string {
  return t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
}

/**
 * Turns the HTML of a Google Doc's simple "mobile basic" view (`/document/d/<id>/mobilebasic`, readable with the signed-in browser session, no
 * credentials) into the plain text `splitProblems` reads: headings as "##", numbered list items as "1.", bullets as "-", pictures as "[image]".
 * Plain string handling on purpose: Google's pages forbid the browser's HTML parser from being fed text (Trusted Types).
 */
export function docHtmlToText(html: string): string {
  const at = html.indexOf('doc-content');
  let h = at >= 0 ? html.slice(html.lastIndexOf('<', at)) : html;
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const lines: string[] = [];
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let cur = '';
  let prefix = '';
  /** Ends the current line, if it holds any text. */
  const flush = (): void => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t !== '') lines.push(prefix + t);
    cur = ''; prefix = '';
  };
  const re = /<(\/?)([a-z0-9]+)\b([^>]*)>|([^<]+)/gi;
  for (let m = re.exec(h); m !== null; m = re.exec(h)) {
    if (m[4] !== undefined) { cur += decodeEntities(m[4]); continue; }
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (tag === 'ol' || tag === 'ul') {
      flush();
      if (closing) lists.pop();
      else lists.push({ ordered: tag === 'ol', n: Number(/\bstart="(\d+)"/.exec(m[3] ?? '')?.[1] ?? '1') });
    } else if (tag === 'li') {
      flush();
      if (!closing) {
        const l = lists[lists.length - 1];
        prefix = l === undefined ? '' : l.ordered ? `${String(l.n++)}. ` : '- ';
      }
    } else if (/^h[1-6]$/.test(tag)) {
      flush();
      if (!closing) prefix = '## ';
    } else if (tag === 'p' || tag === 'div' || tag === 'br' || tag === 'hr' || tag === 'tr') {
      flush();
    } else if (tag === 'img' && !closing) {
      cur += ' [image] ';
    }
  }
  flush();
  return lines.join('\n');
}
