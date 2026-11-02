import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMPORT_LIMITS, type ImportLimits } from '@crm/shared';

/**
 * Reads an uploaded contact file in a short-lived child process (R-016).
 *
 * An 18 KB .xlsx once ran the API's heap out at 2 GB and took every org's requests, and in the container the gateway's WhatsApp
 * sockets, down with it. The limits in `@crm/shared` refuse the shapes we know about; this is for the ones we do not. The child gets
 * its own heap cap and a wall-clock budget, so whatever a file does to the spreadsheet library, only the child dies and the upload
 * is refused. A `worker_threads` worker was tried first and is not enough: its `resourceLimits` did not stop an out-of-memory in the
 * worker from killing the whole process (issue #6).
 *
 * Each child reads one file and exits, so every file gets a fresh, capped heap. Starting one costs a few hundred milliseconds (and
 * an .xlsx another second or so to load exceljs), so up to `maxConcurrent` children are kept started and waiting, and a used one is
 * replaced at once.
 */
export interface ImportParseOptions {
  readonly limits: ImportLimits;
  /** The child's V8 heap cap, in MB. */
  readonly heapMb: number;
  /** How long one parse may run before the child is killed. */
  readonly timeoutMs: number;
  /** Parses running at once in this process; past it an upload is asked to retry, so parallel uploads cannot add up their memory. */
  readonly maxConcurrent: number;
}

/**
 * The largest file the limits let through (200,000 people x 10 columns, a 10 MB .xlsx) took 950 MB of heap and 18.5 s to read on a
 * developer laptop, so the budget is set above that rather than at a figure that would refuse a real customer's file.
 */
export const IMPORT_PARSE_DEFAULTS: ImportParseOptions = Object.freeze({
  limits: IMPORT_LIMITS, heapMb: 1024, timeoutMs: 60_000, maxConcurrent: 2
});

/** Why a file was not read. `code` is the API error code the route answers with. */
export class ImportParseError extends Error {
  /** `message` is for the person who uploaded the file; `detail` is for the log. */
  constructor(
    readonly code: 'IMPORT_LIMIT' | 'MALFORMED_CSV' | 'MALFORMED_XLSX' | 'FILE_UNREADABLE' | 'IMPORT_BUSY',
    message: string,
    /** For the log: how the child ended when it did not answer (exit code, signal, or a timeout). */
    readonly detail?: string
  ) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/** What the child sends back. */
type ChildAnswer =
  | { ok: true; isXlsx: boolean; csvText: string | null }
  | { ok: false; code: 'IMPORT_LIMIT' | 'MALFORMED_CSV' | 'MALFORMED_XLSX' | 'FILE_UNREADABLE'; message: string };

/** The child runs our TypeScript the way the API itself does: through tsx's loader. */
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const CHILD = fileURLToPath(new URL('./import-parse-child.ts', import.meta.url));

const UNREADABLE = 'This file could not be read. Save it again from your spreadsheet program, or export it as CSV, and upload that.';

let running = 0;

/** Children started ahead of need, each waiting for the one file it will read. */
const spares: Array<{ child: ChildProcess; heapMb: number }> = [];

/** Starts a child. It does not keep this process alive while it waits; it exits when this process does (it watches the channel). */
function startChild(heapMb: number): ChildProcess {
  const child = fork(CHILD, [], {
    execArgv: ['--import', TSX_LOADER, `--max-old-space-size=${String(heapMb)}`],
    serialization: 'advanced',
    // The child's own output (V8's out-of-memory report) is noise here; how it ended is passed back in the error.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  child.on('error', () => undefined);    // a spare that fails to start is simply not used
  child.unref();
  child.channel?.unref();
  return child;
}

/** Starts the waiting children now, so the first upload after boot does not pay for starting one. */
export function warmImportParsers(options: ImportParseOptions): void {
  while (spares.length < options.maxConcurrent) spares.push({ child: startChild(options.heapMb), heapMb: options.heapMb });
}

/** A started child for this heap size, warm if one is waiting, and keeps `count` more waiting behind it. */
function takeChild(heapMb: number, count: number): ChildProcess {
  let child: ChildProcess | undefined;
  while (spares.length > 0 && child === undefined) {
    const s = spares.shift()!;
    if (s.heapMb === heapMb && s.child.connected && s.child.exitCode === null) child = s.child;
    else s.child.kill();
  }
  child ??= startChild(heapMb);
  while (spares.length < count) spares.push({ child: startChild(heapMb), heapMb });
  child.ref();
  child.channel?.ref();
  return child;
}

/**
 * Reads `bytes` as a contact file in a child process. Resolves with the CSV text of a spreadsheet (null for a CSV, whose bytes are
 * already the text); rejects with `ImportParseError`. The caller parses the result in-process: it has passed the same limits.
 */
export async function parseImportIsolated(
  bytes: Buffer, options: ImportParseOptions
): Promise<{ isXlsx: boolean; csvText: string | null }> {
  if (running >= options.maxConcurrent) {
    throw new ImportParseError('IMPORT_BUSY', 'Other files are being read right now. Try again in a few seconds.');
  }
  running++;
  try {
    return await new Promise((resolve, reject) => {
      const child = takeChild(options.heapMb, options.maxConcurrent);
      let settled = false;
      const settle = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outcome();
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() => { reject(new ImportParseError('FILE_UNREADABLE', UNREADABLE, `timed out after ${String(options.timeoutMs)} ms`)); });
      }, options.timeoutMs);

      child.on('message', (answer: ChildAnswer) => {
        settle(() => {
          if (answer.ok) resolve({ isXlsx: answer.isXlsx, csvText: answer.csvText });
          else reject(new ImportParseError(answer.code, answer.message));
        });
      });
      child.on('exit', (code, signal) => {
        settle(() => { reject(new ImportParseError('FILE_UNREADABLE', UNREADABLE, `child exited (code ${String(code)}, signal ${String(signal)})`)); });
      });
      child.on('error', (error) => {
        settle(() => { reject(new ImportParseError('FILE_UNREADABLE', UNREADABLE, `child failed: ${error.message}`)); });
      });
      // A child killed before it reads this is already settled by the timer or exit handler.
      child.send({ bytes, limits: options.limits }, () => undefined);
    });
  } finally {
    running--;
  }
}
