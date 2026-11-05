/**
 * A local-only walkthrough: sign in → add people → build a broadcast → start it → watch it send.
 *
 *   npm run local:flow             run it, then clean up after itself
 *   npm run local:flow -- --keep   leave the demo org behind so you can sign in and look at it
 *   npm run local:flow -- --reset  just delete the demo org and stop
 *
 * **Nothing real is ever sent.** The "WhatsApp number" is the in-memory fake channel, driven by
 * the real gateway code (`sweepPendingWork`), so the anti-ban policy and the gates all run — only the
 * final hand-off to WhatsApp is pretend. It talks to the real API over real HTTP (started in this
 * process), signing in with the real login route, so a break anywhere on the path shows up here.
 *
 * It refuses to run unless the database is on this machine, and it only ever touches its own
 * `local-flow` org.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import {
  createDatabase, inspectDatabaseSecurity, resolveTenantRole
} from '@crm/db';
import { loadConfig, createLogger } from '@crm/shared';
import { localKmsFromConfig } from '@crm/kms-local';
import { createStorage } from '@crm/storage';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { FakeChannelProvider } from '@crm/channel-fake';
import { createOrgWithAdmin } from '@crm/core';
import { buildApp } from '../apps/api/src/app.js';
import { sweepPendingWork, type WorkContext } from '../apps/gateway/src/work.js';

const SLUG = 'local-flow';
const EMAIL = 'local-flow@example.test';
const PEOPLE = ['Asha', 'Bilal', 'Chitra', 'Dev', 'Esha'];

/** Prints a line. This is a CLI: stdout is the interface. */
function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Stops with a readable message instead of a stack trace. */
function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Runs the whole walkthrough. */
async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  const resetOnly = process.argv.includes('--reset');

  const config = loadConfig();
  const host = new URL(config.DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || config.NODE_ENV === 'production') {
    fail(`refusing to run: the database host is "${host}" (NODE_ENV=${config.NODE_ENV}). Local only.`);
  }
  const logger = createLogger({ ...config, LOG_LEVEL: 'error' });
  const db = createDatabase(config.DATABASE_URL);

  const wipe = async (): Promise<void> => {
    await db.execute(sql`DELETE FROM org WHERE slug = ${SLUG}`);
    await db.execute(sql`DELETE FROM app_user WHERE email = ${EMAIL}`);
  };
  await wipe();
  if (resetOnly) { say('✓ demo org removed'); await db.$client.end(); return; }

  // ── set up: an org, an admin, and a fake number that is "connected" ─────────────────────
  const kms = localKmsFromConfig(config);
  const hasher = new BuiltinPasswordHasher();
  const password = randomBytes(12).toString('base64url');
  const org = await createOrgWithAdmin(db, hasher, {
    orgName: 'Local flow demo', slug: SLUG, email: EMAIL, password, displayName: 'Local Admin'
  });
  const sender = (await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
    VALUES (${org.orgId}, 'fake', 'Demo number', '+12025550198', 'active')
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state)
    VALUES (${sender}, 'open')`);
  const provider = new FakeChannelProvider();
  await provider.connect({ id: sender, phoneE164: '+12025550198' });
  say(`✓ org "${SLUG}", admin ${EMAIL}, and a fake connected number`);

  // ── the real API, on a free local port ──────────────────────────────────────────────────
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  const app = buildApp({
    config, logger, db, kms, hasher, tenantRole, storage: createStorage(config)
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => { server.once('listening', resolve); });
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;

  // ── sign in ────────────────────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password })
  });
  if (loginRes.status !== 200) fail(`sign-in failed: HTTP ${String(loginRes.status)}`);
  const cookies = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ');
  const csrf = ((await loginRes.json()) as { data: { csrf: string } }).data.csrf;
  say('✓ signed in through the real login route');

  /** One authenticated API call, returning the parsed `data` (or failing the run). */
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const json = (await r.json().catch(() => ({}))) as { data?: T; detail?: string };
    if (!r.ok) fail(`${method} ${path} → ${String(r.status)} ${json.detail ?? ''}`);
    return json.data as T;
  };

  // ── people → campaign → start ──────────────────────────────────────────────────────────
  const ids: string[] = [];
  for (const [i, name] of PEOPLE.entries()) {
    const c = await api<{ id: string }>('POST', '/contacts', {
      displayName: name, phone: `+1202555${String(140 + i).padStart(4, '0')}`
    });
    ids.push(c.id);
  }
  say(`✓ added ${String(ids.length)} contacts`);

  const campaign = await api<{ id: string }>('POST', '/campaigns', {
    name: 'Local flow broadcast', body: '{Hi|Hello} {{name}}, this is a local test message.',
    senderIdentityId: sender, explicitContactIds: ids
  });
  const preview = await api<{ audience: { total: number; reachable: number } }>(
    'GET', `/campaigns/${campaign.id}/preview`);
  say(`✓ drafted a broadcast — dry run: ${String(preview.audience.reachable)} of ${String(preview.audience.total)} reachable`);
  await api('POST', `/campaigns/${campaign.id}/start`, {});
  say('✓ started it');

  // ── let the real gateway code do its work, against the fake number ──────────────────────
  const ctx: WorkContext = {
    db, provider, logger, kms,
    decrypt: (c: Uint8Array) => new TextDecoder().decode(kms.decrypt(c)),
    sweepBatchSize: 50
  };
  let status = 'running';
  for (let round = 0; round < 40 && status !== 'completed'; round++) {
    await sweepPendingWork(ctx);
    status = (await api<{ status: string }>('GET', `/campaigns/${campaign.id}`)).status;
  }
  if (status !== 'completed') fail(`the broadcast never completed (status "${status}")`);

  const results = await api<Array<{ displayName: string | null; status: string; skipReason: string | null }>>(
    'GET', `/campaigns/${campaign.id}/recipients`);
  say('✓ finished. Per-recipient result:');
  for (const r of results) say(`    ${(r.displayName ?? '?').padEnd(8)} ${r.status}${r.skipReason ? ` (${r.skipReason})` : ''}`);
  say('  What the fake number "sent":');
  for (const m of provider.sent) say(`    → ${m.to.phoneE164}: ${JSON.stringify(m.content).slice(0, 90)}`);

  if (provider.sent.length !== PEOPLE.length) {
    fail(`expected ${String(PEOPLE.length)} messages, the fake number sent ${String(provider.sent.length)}`);
  }
  say(`\n✓ PASS — ${String(PEOPLE.length)} people messaged end to end, nothing real sent.`);

  if (keep) {
    say(`\nLeft in place. Sign in at the web app with ${EMAIL} / ${password}`);
    say('(it is only a local demo org; `npm run local:flow -- --reset` removes it).');
  } else {
    await wipe();
  }
  server.close();
  await db.$client.end();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
