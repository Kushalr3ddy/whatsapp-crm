import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Why a GIF could not be turned into a clip, in words a person can read. */
export class GifConversionError extends Error {
  /** Builds the error with a short code (`no_ffmpeg`, `failed`, `timeout`) and the words to show. */
  constructor(readonly code: 'no_ffmpeg' | 'failed' | 'timeout', message: string) {
    super(message);
    this.name = 'GifConversionError';
  }
}

/** How long a conversion may run before it is stopped: a small GIF takes a second or two. */
const TIMEOUT_MS = 60_000;

/**
 * Turns a GIF into the short silent looping MP4 WhatsApp actually plays (WhatsApp has no animated image type: a GIF is a
 * video marked "GIF playback"). Uses the system `ffmpeg`; the temporary files live in a private directory that is always removed.
 * H.264 in `yuv420p` with even width and height, because phones refuse anything else. Throws `GifConversionError`.
 */
export async function gifToMp4(gif: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'gif-'));
  try {
    const input = join(dir, 'in.gif');
    const output = join(dir, 'out.mp4');
    await writeFile(input, gif);
    await run(['-y', '-v', 'error', '-i', input, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', output]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs ffmpeg with the given arguments, or says why it could not. */
function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < 2000) stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new GifConversionError('timeout', 'Turning the GIF into a clip took too long. Try a shorter or smaller GIF.')); }, TIMEOUT_MS);
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT'
        ? new GifConversionError('no_ffmpeg', 'GIFs cannot be used on this server yet: ffmpeg is not installed. Use a JPG, PNG or WebP picture.')
        : new GifConversionError('failed', 'Could not turn the GIF into a clip.'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new GifConversionError('failed', `Could not turn the GIF into a clip (${stderr.trim().split('\n').pop() ?? 'ffmpeg failed'}).`));
    });
  });
}
