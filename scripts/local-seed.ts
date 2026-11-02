/**
 * Seeds the UI-test org with a believable working set, so browser tests (and a human clicking
 * around) have something to look at: a fake *connected* number, people, tags, a custom field, a
 * saved audience and a few conversations in different states.
 *
 *   npm run local:seed             add (or top up) the seed data in the test org
 *   npm run local:seed -- --reset  remove what this script created, then stop
 *
 * It targets the org the Playwright specs already sign in to — slug `e2e-test` unless
 * `TEST_ORG_SLUG` says otherwise — as `TEST_EMAIL` / `TEST_PASSWORD` from `.env`. Everything has a
 * fixed name, so running it twice reuses rows instead of piling up copies.
 *
 * The number's provider is `fake`: it only comes up connected when the gateway runs with
 * `GATEWAY_CHANNEL=fake`, so nothing here can ever reach WhatsApp. Like `local-flow`, it refuses to
 * run unless the database is on this machine.
 */
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createDatabase, inspectDatabaseSecurity, resolveTenantRole } from '@crm/db';
import { loadConfig, createLogger } from '@crm/shared';
import { localKmsFromConfig } from '@crm/kms-local';
import { createStorage } from '@crm/storage';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { storeInboundMessage } from '@crm/core';
import { buildApp } from '../apps/api/src/app.js';

const ORG_SLUG = process.env.TEST_ORG_SLUG ?? 'e2e-test';
const SENDER_LABEL = 'Seed number';
const SENDER_PHONE = '+12025550199';
const TAGS = ['seed-leads', 'seed-customers', 'seed-vip'];
const PEOPLE = [
  'Asha Rao', 'Bilal Khan', 'Chitra Nair', 'Dev Patel', 'Esha Gupta', 'Farhan Ali', 'Gita Iyer',
  'Hari Menon', 'Isha Verma', 'Jai Singh', 'Kavya Reddy', 'Lakshmi Pillai', 'Manoj Das',
  'Neha Joshi', 'Omar Sheikh', 'Priya Shah', 'Qasim Mir', 'Rhea Kapoor', 'Sunil Bose', 'Tara Menon'
];
/** Fiction-range numbers (+1 202 555 0100..0199 are reserved and never assigned), so nothing can reach a real person. */
const phoneOf = (i: number): string => `+1202555${String(120 + i).padStart(4, '0')}`;

/** Prints a line. This is a CLI: stdout is the interface. */
function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Stops with a readable message instead of a stack trace. */
function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Runs the whole seed. */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) fail('set TEST_EMAIL and TEST_PASSWORD in .env (the test org admin).');

  const config = loadConfig();
  const host = new URL(config.DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || config.NODE_ENV === 'production') {
    fail(`refusing to run: the database host is "${host}" (NODE_ENV=${config.NODE_ENV}). Local only.`);
  }
  const logger = createLogger({ ...config, LOG_LEVEL: 'error' });
  const db = createDatabase(config.DATABASE_URL);

  const orgRows = (await db.execute(sql`SELECT id FROM org WHERE slug = ${ORG_SLUG}`)) as unknown as
    Array<{ id: string }>;
  const orgId = orgRows[0]?.id;
  if (orgId === undefined) {
    fail(`no org "${ORG_SLUG}". Create it first: npm run admin -- org --name "E2E Test Org" --slug ${ORG_SLUG} --email "$TEST_EMAIL" --password "$TEST_PASSWORD"`);
  }

  // ── reset: remove only what this script made, by its fixed names ──────────────────────
  if (reset) {
    const phones = PEOPLE.map((_, i) => phoneOf(i));
    const phoneList = sql.join(phones.map((p) => sql`${p}`), sql`, `);
    await db.execute(sql`DELETE FROM contact WHERE org_id = ${orgId} AND id IN (
      SELECT contact_id FROM contact_identity WHERE org_id = ${orgId} AND value_normalized IN (${phoneList}))`);
    await db.execute(sql`DELETE FROM tag WHERE org_id = ${orgId} AND name IN
      (${sql.join(TAGS.map((t) => sql`${t}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM segment WHERE org_id = ${orgId} AND name = 'Seed — replied'`);
    await db.execute(sql`DELETE FROM custom_field WHERE org_id = ${orgId} AND key = 'seed_city'`);
    await db.execute(sql`DELETE FROM sender_identity WHERE org_id = ${orgId} AND label = ${SENDER_LABEL}`);
    say('✓ seed data removed');
    await db.$client.end();
    return;
  }

  // ── the fake number: provider 'fake', connected ─────────────────────
  const found = (await db.execute(sql`
    SELECT id FROM sender_identity WHERE org_id = ${orgId} AND label = ${SENDER_LABEL}`)) as unknown as
    Array<{ id: string }>;
  let senderId = found[0]?.id;
  if (senderId === undefined) {
    senderId = ((await db.execute(sql`
      INSERT INTO sender_identity (org_id, provider, label, phone_e164, status)
      VALUES (${orgId}, 'fake', ${SENDER_LABEL}, ${SENDER_PHONE}, 'active')
      RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    await db.execute(sql`INSERT INTO channel_session (sender_identity_id, connection_state)
      VALUES (${senderId}, 'open')`);
  }
  say(`✓ number "${SENDER_LABEL}" (${SENDER_PHONE}, fake provider)`);

  // The fixture starts every run connected and active, and counts the fake's past sends as delivered, which is what a
  // fake number would have reported. Scoped to this one fake sender by id; nothing real is touched.
  await db.execute(sql`
    UPDATE message m
    SET status = 'delivered', delivered_at = COALESCE(m.delivered_at, m.sent_at)
    FROM conversation v
    WHERE v.id = m.conversation_id AND v.sender_identity_id = ${senderId}
      AND m.direction = 'outbound' AND m.status = 'sent'`);
  await db.execute(sql`
    UPDATE sender_identity SET status = 'active', updated_at = now()
    WHERE id = ${senderId} AND provider = 'fake'`);

  // ── the real API in-process, signed in as the test admin ──────────────────────────────
  const kms = localKmsFromConfig(config);
  const security = await inspectDatabaseSecurity(db);
  const tenantRole = await resolveTenantRole(db, security);
  const app = buildApp({
    config, logger, db, kms, hasher: new BuiltinPasswordHasher(), tenantRole, storage: createStorage(config)
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => { server.once('listening', resolve); });
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;

  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (loginRes.status !== 200) fail(`sign-in as ${email} failed: HTTP ${String(loginRes.status)}`);
  const cookies = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ');
  const csrf = ((await loginRes.json()) as { data: { csrf: string } }).data.csrf;

  /** The few response fields this script reads; the API's own types are not importable here. */
  interface Reply { detail?: string; existingContactId?: string; data?: unknown }

  /** One authenticated call; a 409 ("already there") is returned, not fatal, so re-runs work. */
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: Reply }> => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const json = (await r.json().catch(() => ({}))) as Reply;
    if (!r.ok && r.status !== 409) fail(`${method} ${path} → ${String(r.status)} ${json.detail ?? ''}`);
    return { status: r.status, json };
  };

  // tags
  const tagIds: string[] = [];
  const existingTags = (await call('GET', '/tags')).json.data as Array<{ id: string; name: string }>;
  for (const name of TAGS) {
    const have = existingTags.find((t) => t.name === name);
    tagIds.push(have?.id ?? ((await call('POST', '/tags', { name })).json.data as { id: string }).id);
  }

  // a custom field
  await call('POST', '/custom-fields', { key: 'seed_city', label: 'City', type: 'text', options: [] });

  // people, spread over the tags; every fifth carries a city
  const contactIds: string[] = [];
  for (const [i, displayName] of PEOPLE.entries()) {
    const made = await call('POST', '/contacts', { displayName, phone: phoneOf(i) });
    const id = made.status === 409 ? made.json.existingContactId! : (made.json.data as { id: string }).id;
    contactIds.push(id);
    await call('POST', `/contacts/${id}/tags`, { tagId: tagIds[i % tagIds.length] });
    if (i % 5 === 0) await call('PUT', `/contacts/${id}/custom-fields`, { values: { seed_city: 'Mumbai' } });
  }
  say(`✓ ${String(contactIds.length)} contacts, ${String(tagIds.length)} tags, 1 custom field`);

  // conversations: inbound messages from the first three people, fixed ids so a re-run is a no-op
  const kinds = ['unread', 'assigned', 'closed'] as const;
  const conversationIds: string[] = [];
  for (const [i, kind] of kinds.entries()) {
    const stored = await storeInboundMessage(db, kms, {
      orgId, senderIdentityId: senderId, providerMessageId: `seed-in-${String(i)}`,
      fromPhoneE164: phoneOf(i), fromProviderAddress: `${phoneOf(i).slice(1)}@s.whatsapp.net`,
      body: `Hi, ${kind} thread — are you open tomorrow?`, contentType: 'text', receivedAt: new Date()
    });
    conversationIds.push(stored.conversationId);
  }
  // assigned → the test admin; closed → resolved. (The unread one is left exactly as it arrived.)
  const mine = ((await db.execute(sql`SELECT id FROM app_user WHERE email = ${email}`)) as unknown as
    Array<{ id: string }>)[0]?.id;
  if (mine !== undefined) await call('PATCH', `/conversations/${conversationIds[1]}`, { assigneeUserId: mine });
  await call('PATCH', `/conversations/${conversationIds[2]}`, { status: 'closed' });
  say('✓ 3 conversations (unread · assigned · closed)');

  // a saved audience
  await call('POST', '/segments', {
    name: 'Seed — replied', definition: { replied: 'ever' }, saved: true
  });
  say('✓ 1 saved audience');

  say(`\n✓ seeded org "${ORG_SLUG}". Run the gateway with GATEWAY_CHANNEL=fake to bring the number up.`);
  server.close();
  await db.$client.end();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
