import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Why an address was refused, in words the settings page can show as they are. */
export class UnsafeUrlError extends Error {
  /** Builds the error with the words to show. */
  constructor(message: string) { super(message); this.name = 'UnsafeUrlError'; }
}

/** True for an address that belongs to this machine or a private network: loopback, private ranges, link-local (including cloud metadata), unspecified. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = address.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

/**
 * Checks a model address before the server calls it. The settings page lets an admin type an address, so without this it could be
 * used to make the server probe its own network. Rules: it must be `https`, and every address it resolves to must be public. Two
 * exceptions: Ollama (a model on this same machine) may use `http://localhost` / `127.0.0.1`, and a test or private install may switch
 * the rule off with `LLM_ALLOW_PRIVATE_BASE_URL`. (A name could in principle change its address between this check and the call; the
 * check narrows the risk and the page is admin-only.)
 */
export async function assertSafeBaseUrl(raw: string, options: { ollama: boolean; allowPrivate: boolean }): Promise<void> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new UnsafeUrlError('That is not a web address.'); }
  if (url.username !== '' || url.password !== '') throw new UnsafeUrlError('The address may not contain a user name or password.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (options.allowPrivate) return;
  if (options.ollama && local && (url.protocol === 'http:' || url.protocol === 'https:')) return;
  if (url.protocol !== 'https:') throw new UnsafeUrlError('The address must start with https://.');
  const addresses = isIP(host) !== 0 ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new UnsafeUrlError('That address could not be found.');
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError('That address points at a private network, which is not allowed.');
}
