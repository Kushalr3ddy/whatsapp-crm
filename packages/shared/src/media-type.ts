/**
 * What a file actually is, decided from its first bytes rather than from what anyone claims.
 *
 * This exists because of how attachments arrive here: a stranger sends them over WhatsApp, and
 * both the filename and the provider's declared mime type are that stranger's input. Serving a
 * file as the type its name claims is how an HTML or SVG attachment becomes stored XSS against
 * a logged-in session — the attacker only has to message it (docs/21-deferred.md, D-11).
 *
 * The list is deliberately short. It covers what WhatsApp actually carries, and everything else
 * becomes `application/octet-stream`, which is the safe answer rather than a failure: an
 * unrecognised file still stores and still downloads, it simply never gets a type that would
 * persuade a browser to render it.
 */

/** The answer for anything unrecognised. Never renders, always downloads. */
export const UNKNOWN_MEDIA_TYPE = 'application/octet-stream';

/** One signature: bytes that must appear at `offset` for the type to match. */
interface Signature {
  readonly type: string;
  readonly offset: number;
  readonly magic: readonly number[];
  /** A second check for containers whose first bytes are shared by several formats. */
  readonly also?: { readonly offset: number; readonly ascii: string };
  /** The extension used when building a storage key. Kept here so the two never disagree. */
  readonly extension: string;
}

const ASCII = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/**
 * Ordered most specific first. `matchMediaType` returns the first hit, so a format whose magic
 * is a prefix of another's must come after it.
 */
const SIGNATURES: readonly Signature[] = [
  { type: 'image/jpeg', offset: 0, magic: [0xff, 0xd8, 0xff], extension: 'jpg' },
  { type: 'image/png', offset: 0, magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], extension: 'png' },
  { type: 'image/gif', offset: 0, magic: ASCII('GIF8'), extension: 'gif' },
  // RIFF containers: the first four bytes say RIFF and bytes 8-11 say which kind.
  { type: 'image/webp', offset: 0, magic: ASCII('RIFF'), also: { offset: 8, ascii: 'WEBP' }, extension: 'webp' },
  { type: 'audio/wav', offset: 0, magic: ASCII('RIFF'), also: { offset: 8, ascii: 'WAVE' }, extension: 'wav' },
  { type: 'application/pdf', offset: 0, magic: ASCII('%PDF-'), extension: 'pdf' },
  // ISO base media: 'ftyp' at offset 4. WhatsApp video and voice notes both land here.
  { type: 'video/mp4', offset: 4, magic: ASCII('ftyp'), extension: 'mp4' },
  { type: 'audio/ogg', offset: 0, magic: ASCII('OggS'), extension: 'ogg' },
  { type: 'audio/mpeg', offset: 0, magic: [0x49, 0x44, 0x33], extension: 'mp3' },       // ID3 tag
  { type: 'audio/mpeg', offset: 0, magic: [0xff, 0xfb], extension: 'mp3' },             // bare frame
  { type: 'audio/amr', offset: 0, magic: ASCII('#!AMR'), extension: 'amr' },
  // ZIP, which is also every Office document. Distinguishing docx from xlsx means reading the
  // central directory, and it is not worth it: both download rather than render either way.
  { type: 'application/zip', offset: 0, magic: [0x50, 0x4b, 0x03, 0x04], extension: 'zip' }
];

/** What the bytes turned out to be. */
export interface MediaType {
  /** The content type to store and to serve. Never taken from a filename. */
  readonly contentType: string;
  /** Extension for the storage key, so a file on disk is recognisable without the database. */
  readonly extension: string;
  /** False when nothing matched and the type is the octet-stream fallback. */
  readonly recognised: boolean;
}

/**
 * Identifies a file from its leading bytes.
 *
 * Never throws and never returns a type that a browser will render as markup — there is no
 * signature here for HTML or SVG, on purpose. Both are legitimate file formats and both are
 * script execution contexts when served from our own origin, so they fall through to
 * `application/octet-stream` along with everything else unrecognised.
 */
export function detectMediaType(bytes: Uint8Array): MediaType {
  for (const sig of SIGNATURES) {
    if (!startsWith(bytes, sig.magic, sig.offset)) continue;
    if (sig.also !== undefined && !startsWith(bytes, ASCII(sig.also.ascii), sig.also.offset)) continue;
    return { contentType: sig.type, extension: sig.extension, recognised: true };
  }
  return { contentType: UNKNOWN_MEDIA_TYPE, extension: 'bin', recognised: false };
}

/** True when `bytes` carries `magic` at `offset`. */
function startsWith(bytes: Uint8Array, magic: readonly number[], offset: number): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/**
 * Makes a sender-supplied filename safe to put in a `Content-Disposition` header.
 *
 * The name is used for **display and for the saved filename only** — never to decide a content
 * type. It still has to be sanitised, because it reaches a response header: a newline in it
 * would let the sender inject headers of their own, and a path separator would make a download
 * land somewhere unintended on the client.
 *
 * Returns null when nothing usable survives, and the caller should fall back to the media id.
 */
export function safeFilename(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // Strip any directory part first — a sender controls this and "../../x" is a real name.
  const base = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = [...base]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      // Control characters carry the header-injection risk; quotes break the header's own
      // quoting; the rest are ordinary and kept, including spaces and non-Latin scripts.
      return code >= 0x20 && code !== 0x7f && c !== '"' && c !== '\\';
    })
    .join('')
    .trim()
    .slice(0, 200);
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? null : cleaned;
}
