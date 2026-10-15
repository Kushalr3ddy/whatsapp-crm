import { headers } from 'next/headers';

/**
 * The browser's address, as a header to pass on to the API.
 *
 * The web server calls the API from inside the same host, so without this every audit row would
 * record 127.0.0.1. Behind a Cloudflare tunnel the real address is in `CF-Connecting-IP`; any
 * other proxy leaves it at the front of `X-Forwarded-For`. Used for the audit trail only, never
 * for authorisation: both headers are a client's to forge when the web port is exposed directly.
 */
export async function clientIpHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  return ip === '' ? {} : { 'X-Forwarded-For': ip };
}
