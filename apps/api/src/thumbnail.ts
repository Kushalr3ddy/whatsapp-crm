import sharp from 'sharp';

/** The image types we make a preview of. Everything else (and anything doubtful) stays a plain download. */
export const THUMBNAIL_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Biggest source we will decode, in pixels. Stops a small file that unpacks to gigabytes (a "decompression bomb"). */
const MAX_INPUT_PIXELS = 40_000_000;

/** The longest side of a preview, in pixels. */
const THUMB_SIZE = 320;

/**
 * Makes a small preview of an image by **decoding and re-encoding** it.
 *
 * That is the safety: the bytes that leave here are ones we wrote, not the sender's. Anything hostile
 * hiding in the file (odd metadata, a script in a polyglot, a tampered header) does not survive the
 * round trip, and `sharp` drops EXIF and other metadata by default. The first frame only for a GIF.
 * Throws if the file is not a decodable image or is too large, and the caller answers with a plain error.
 */
export async function makeThumbnail(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
}
