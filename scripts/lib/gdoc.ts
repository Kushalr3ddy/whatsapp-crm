import { createSign } from 'node:crypto';
import { docJsonToText, type DocJson } from './gdoc-core.js';

export * from './gdoc-core.js';

/** What `fetchDocText` and the scripts need from this file; the reading and parsing live in gdoc-core.ts so the browser can use them too. */

/** Base64url, as JSON Web Tokens use. */
const b64url = (s: Buffer | string): string => Buffer.from(s).toString('base64url');

/** An access token for the Docs API from a service-account key (read only). */
async function serviceAccountToken(keyJson: string): Promise<string> {
  const key = JSON.parse(keyJson) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/documents.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000
  }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(signature)}` })
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || body.access_token === undefined) throw new Error(`Google refused the service account: ${body.error_description ?? String(res.status)}`);
  return body.access_token;
}

/**
 * The text of a Google Doc. Tries, in order: the service account in `GOOGLE_SERVICE_ACCOUNT_JSON` (the doc must be shared with its
 * e-mail address), then the public export (works only when the doc is "anyone with the link can view"). Says exactly which to fix.
 */
export async function fetchDocText(docId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const key = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (key !== undefined && key !== '') {
    const token = await serviceAccountToken(key);
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Docs said ${String(res.status)}: is the doc shared with the service account's e-mail address?`);
    return docJsonToText((await res.json()) as DocJson);
  }
  const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, { redirect: 'manual' });
  if (res.status === 200) return await res.text();
  throw new Error(`the doc is private (HTTP ${String(res.status)}). Either share it as "anyone with the link can view", or set GOOGLE_SERVICE_ACCOUNT_JSON and share the doc with that account, or save the doc as text and use --file.`);
}
