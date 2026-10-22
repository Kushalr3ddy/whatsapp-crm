import { chmod, copyFile, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The five lines this module owns. Nothing else in a `.env` is ever read for writing, changed or removed. */
export const LLM_ENV_KEYS = ['LLM_DRIVER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_TIMEOUT_MS'] as const;
/** One of the owned lines. */
export type LlmEnvKey = (typeof LLM_ENV_KEYS)[number];
/** The owned lines as strings; a missing key means the file has no such line. */
export type LlmEnvValues = Partial<Record<LlmEnvKey, string>>;

/** Reads the `LLM_*` values from an env file. A missing or unreadable file is "nothing set", never an error. */
export async function readLlmEnv(path: string): Promise<LlmEnvValues> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return {}; }
  return parseLlmEnv(text);
}

/** Picks the owned `KEY=value` lines out of env-file text (comments and other keys are ignored; quotes around a value are removed). */
export function parseLlmEnv(text: string): LlmEnvValues {
  const out: LlmEnvValues = {};
  for (const line of text.split('\n')) {
    const m = /^(LLM_[A-Z_]+)=(.*)$/.exec(line.replace(/\r$/, ''));
    if (m === null || !(LLM_ENV_KEYS as readonly string[]).includes(m[1]!)) continue;
    const value = m[2]!.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value !== '') out[m[1] as LlmEnvKey] = value;
  }
  return out;
}

/** How many dated backups of the file are kept; older ones are removed. */
const KEEP_BACKUPS = 3;

/**
 * Sets (or, with `undefined`, removes) the `LLM_*` lines in an env file and leaves every other byte alone: other keys such as
 * `ENCRYPTION_KEY`, comments and blank lines stay exactly as they were. A missing final newline is added first, so a new line can
 * never glue onto the last value. A dated backup (`<file>.bak-YYYYMMDD-HHMMSS`) is made before the change, and the new file is written to a
 * temporary file and renamed into place, so a crash cannot leave a half-written secrets file. The file keeps its permissions, or becomes
 * private (0600) when it is new. Values may not contain a line break.
 */
export async function writeLlmEnv(path: string, values: Partial<Record<LlmEnvKey, string | undefined>>): Promise<{ backup: string | null }> {
  for (const [key, value] of Object.entries(values)) {
    if (!(LLM_ENV_KEYS as readonly string[]).includes(key)) throw new Error(`${key} is not a setting this can write`);
    if (value !== undefined && /[\r\n]/.test(value)) throw new Error(`${key} may not contain a line break`);
  }
  const exists = existsSync(path);
  let text = exists ? await readFile(path, 'utf8') : '';
  let backup: string | null = null;
  if (exists) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    backup = `${path}.bak-${stamp}`;
    await copyFile(path, backup);
    await chmod(backup, 0o600);
    await pruneBackups(path);
  }
  if (text !== '' && !text.endsWith('\n')) text += '\n';

  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  for (const key of LLM_ENV_KEYS) {
    if (!(key in values)) continue;
    const value = values[key];
    const at = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (value === undefined || value === '') { if (at >= 0) lines.splice(at, 1); continue; }
    if (at >= 0) lines[at] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  const next = lines.length === 0 ? '' : `${lines.join('\n')}\n`;

  const mode = exists ? (await stat(path)).mode & 0o777 : 0o600;
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${String(process.pid)}`);
  try {
    await writeFile(tmp, next, { mode });
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return { backup };
}

/** Keeps the newest few backups of this file and removes the rest. */
async function pruneBackups(path: string): Promise<void> {
  const dir = dirname(path);
  const prefix = `${basename(path)}.bak-`;
  const old = (await readdir(dir)).filter((f) => f.startsWith(prefix)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) await unlink(join(dir, f)).catch(() => undefined);
}
