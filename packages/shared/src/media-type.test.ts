import { describe, expect, it } from 'vitest';
import { detectMediaType, safeFilename, UNKNOWN_MEDIA_TYPE } from './media-type.js';

/** Builds a buffer that starts with the given bytes and is padded out to a realistic length. */
const withMagic = (...bytes: number[]): Uint8Array => {
  const out = new Uint8Array(64);
  out.set(bytes, 0);
  return out;
};
const ascii = (s: string, offset = 0): Uint8Array => {
  const out = new Uint8Array(64);
  out.set([...s].map((c) => c.charCodeAt(0)), offset);
  return out;
};

describe('detectMediaType', () => {
  it('recognises the formats WhatsApp actually carries', () => {
    expect(detectMediaType(withMagic(0xff, 0xd8, 0xff)).contentType).toBe('image/jpeg');
    expect(detectMediaType(withMagic(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).contentType)
      .toBe('image/png');
    expect(detectMediaType(ascii('GIF89a')).contentType).toBe('image/gif');
    expect(detectMediaType(ascii('%PDF-1.7')).contentType).toBe('application/pdf');
    expect(detectMediaType(ascii('OggS')).contentType).toBe('audio/ogg');
    expect(detectMediaType(ascii('ftyp', 4)).contentType).toBe('video/mp4');
  });

  it('tells apart containers that share their first four bytes', () => {
    const webp = ascii('RIFF');
    webp.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    const wav = ascii('RIFF');
    wav.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);

    expect(detectMediaType(webp).contentType).toBe('image/webp');
    expect(detectMediaType(wav).contentType).toBe('audio/wav');
    // RIFF alone says nothing about what is inside, and guessing would be worse than not.
    expect(detectMediaType(ascii('RIFF')).contentType).toBe(UNKNOWN_MEDIA_TYPE);
  });

  it('never returns a type a browser will execute', () => {
    // The whole point. Both are real formats and both run script from our own origin, so
    // neither has a signature and both come back as a download (D-11).
    expect(detectMediaType(ascii('<!DOCTYPE html><script>alert(1)</script>')).contentType)
      .toBe(UNKNOWN_MEDIA_TYPE);
    expect(detectMediaType(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')).contentType)
      .toBe(UNKNOWN_MEDIA_TYPE);
  });

  it('is not fooled by a file whose name disagrees with its bytes', () => {
    // A .pdf that is really HTML. Nothing here ever reads the name, which is the reason the
    // function takes bytes and not a filename at all.
    const disguised = ascii('<html><body>not a pdf</body></html>');
    expect(detectMediaType(disguised).recognised).toBe(false);
  });

  it('handles short and empty input without throwing', () => {
    expect(detectMediaType(new Uint8Array(0)).contentType).toBe(UNKNOWN_MEDIA_TYPE);
    expect(detectMediaType(new Uint8Array([0xff])).contentType).toBe(UNKNOWN_MEDIA_TYPE);
    // Two of JPEG's three magic bytes is not a JPEG.
    expect(detectMediaType(new Uint8Array([0xff, 0xd8])).recognised).toBe(false);
  });

  it('gives every recognised type an extension, and the fallback a neutral one', () => {
    expect(detectMediaType(ascii('%PDF-')).extension).toBe('pdf');
    expect(detectMediaType(ascii('nothing in particular')).extension).toBe('bin');
  });
});

describe('safeFilename', () => {
  it('keeps an ordinary name, spaces and all', () => {
    expect(safeFilename('Priya Sharma CV.pdf')).toBe('Priya Sharma CV.pdf');
    expect(safeFilename('résumé-2026.pdf')).toBe('résumé-2026.pdf');
  });

  it('strips any path the sender put in the name', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Windows\\System32\\evil.exe')).toBe('evil.exe');
  });

  it('removes what would break or inject a response header', () => {
    // A newline here would let a sender add headers of their own to the download response.
    expect(safeFilename('cv.pdf\r\nX-Injected: yes')).toBe('cv.pdfX-Injected: yes');
    expect(safeFilename('quote".pdf')).toBe('quote.pdf');
  });

  it('returns null when nothing usable is left, so the caller names the file itself', () => {
    expect(safeFilename('')).toBeNull();
    expect(safeFilename(null)).toBeNull();
    expect(safeFilename('   ')).toBeNull();
    expect(safeFilename('..')).toBeNull();
    expect(safeFilename('/')).toBeNull();
  });

  it('bounds the length, because a header is not a place for a novel', () => {
    expect(safeFilename('a'.repeat(500))!.length).toBe(200);
  });
});
