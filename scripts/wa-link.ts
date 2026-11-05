/**
 * Development tool: link a real WhatsApp number and watch messages flow.
 *
 * This is the end-to-end proof that the adapter, the encrypted credential store and the
 * database all work together — before the gateway process and the HTTP API exist. It is NOT
 * the product; it is a harness for one number, run by hand, watched by a person.
 *
 * Usage:
 *   npm run wa:link                     link by QR code
 *   npm run wa:link -- --pair 919876543210    link by 8-digit pairing code
 *   npm run wa:send 919876543210 "hello"      send one message on the linked number
 *
 * SAFETY: there is no rate limiting anywhere in this path yet (that is P6). Send a handful of
 * messages to people who will reply. Do not point it at a list.
 */
import qrcode from 'qrcode-terminal';
import { sql } from 'drizzle-orm';
import { loadConfig, createLogger } from '@crm/shared';
import { createDatabase, PostgresAuthStateStore } from '@crm/db';
import { localKmsFromConfig, type KmsDriver } from '@crm/kms-local';
import { BaileysChannelProvider } from '@crm/channel-baileys';

/** Label used for the single sender this dev tool manages. */
const SENDER_LABEL = 'dev-test-number';

/** Writes a line to the terminal. Separate from the logger so instructions stay readable. */
function say(line = ''): void {
  process.stdout.write(line + '\n');
}

/**
 * Finds the org and this script's sender row, creating the sender on first run.
 *
 * It used to create the organisation too — `INSERT ... ON CONFLICT (slug) DO UPDATE` on a
 * hardcoded `dev` slug. That is how a hand-shaped org row nobody could account for ended up in
 * the database, and it cost two separate misdiagnoses before anyone worked out where it came
 * from. Provisioning is a real code path now (`createOrgWithAdmin`), so this refuses rather
 * than inventing a tenant: a second org appearing because a helper script ran is precisely the
 * failure being avoided.
 */
async function ensureSender(db: ReturnType<typeof createDatabase>): Promise<{ orgId: string; senderId: string }> {
  const orgRows = await db.execute(sql`SELECT id FROM org ORDER BY created_at ASC LIMIT 2`);
  const orgs = orgRows as unknown as Array<{ id: string }>;
  if (orgs.length === 0) {
    throw new Error(
      'No organisation exists. Create one first:\n' +
      '  npm run admin -- org --name "Your Company" --slug your-company --email you@example.com'
    );
  }
  if (orgs.length > 1) {
    throw new Error(
      'More than one organisation exists, and this script cannot know which you mean.\n' +
      'Link through the UI instead: npm run web, then /link'
    );
  }
  const orgId = orgs[0]!.id;

  const existing = await db.execute(sql`
    SELECT id FROM sender_identity WHERE org_id = ${orgId} AND label = ${SENDER_LABEL} LIMIT 1`);
  const found = (existing as unknown as Array<{ id: string }>)[0];
  if (found) return { orgId, senderId: found.id };

  const created = await db.execute(sql`
    INSERT INTO sender_identity (org_id, provider, label, status)
    VALUES (${orgId}, 'baileys', ${SENDER_LABEL}, 'linking') RETURNING id`);
  return { orgId, senderId: (created as unknown as Array<{ id: string }>)[0]!.id };
}

/** Wires everything together and returns the pieces the commands need. */
async function bootstrap() {
  const config = loadConfig();
  // Baileys is extremely chatty at info level; keep its noise out of the instructions.
  const logger = createLogger({ ...config, LOG_LEVEL: 'warn' });
  const db = createDatabase(config.DATABASE_URL, { max: 4 });
  const kms = localKmsFromConfig(config);
  const authStore = new PostgresAuthStateStore(db, kms);
  const provider = new BaileysChannelProvider({ authStore, logger });
  const { orgId, senderId } = await ensureSender(db);
  return { config, logger, db, provider, authStore, orgId, senderId };
}

/** Stores an inbound message, creating the contact and conversation if they are new. */
async function persistInbound(
  db: ReturnType<typeof createDatabase>, kms: KmsDriver,
  orgId: string, senderId: string,
  from: string, address: string, body: string, providerMessageId: string
): Promise<void> {
  const normalised = from === '' ? address : from;

  // identity -> contact, never a scan of contact. A "@lid" privacy address is simply another
  // identity for the same person (docs/05-data-model.md).
  const kind = from === '' ? 'wa_lid' : 'phone';
  const contactRows = await db.execute(sql`
    WITH found AS (
      SELECT contact_id FROM contact_identity
      WHERE org_id = ${orgId} AND kind = ${kind} AND value_normalized = ${normalised}
    ), created_contact AS (
      INSERT INTO contact (org_id, display_name, source)
      SELECT ${orgId}, ${normalised}, 'inbound_message'
      WHERE NOT EXISTS (SELECT 1 FROM found)
      RETURNING id
    ), created_identity AS (
      INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
      SELECT ${orgId}, id, ${kind}, ${normalised}, true FROM created_contact
      RETURNING contact_id
    )
    SELECT contact_id FROM found
    UNION ALL SELECT contact_id FROM created_identity`);
  const contactId = (contactRows as unknown as Array<{ contact_id: string }>)[0]!.contact_id;

  const convRows = await db.execute(sql`
    INSERT INTO conversation (org_id, contact_id, sender_identity_id, last_inbound_at)
    VALUES (${orgId}, ${contactId}, ${senderId}, now())
    ON CONFLICT (contact_id, sender_identity_id)
      DO UPDATE SET last_inbound_at = now(), unread_count = conversation.unread_count + 1
    RETURNING id`);
  const conversationId = (convRows as unknown as Array<{ id: string }>)[0]!.id;

  // ON CONFLICT DO NOTHING is the idempotency guarantee: WhatsApp redelivers, and a duplicate
  // must be a no-op at the database rather than in code where it can race.
  await db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, provider_message_id,
                         content_type, body_enc, body_hmac, status, sent_by)
    VALUES (${orgId}, ${conversationId}, 'inbound', ${providerMessageId}, 'text',
            ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
            ${kms.blindIndex(body)}, 'delivered', 'system')
    ON CONFLICT (org_id, provider_message_id) DO NOTHING`);
}

/** Links a number and then stays running, printing and storing whatever arrives. */
async function link(mode: 'qr' | 'pairing_code', phone?: string): Promise<void> {
  const ctx = await bootstrap();
  const localKms = localKmsFromConfig(ctx.config);

  say();
  say('  Linking a WhatsApp number');
  say('  ─────────────────────────');
  say(`  sender id: ${ctx.senderId}`);
  say();

  const challenge = await ctx.provider.link(ctx.senderId, mode, phone);

  if (challenge.mode === 'qr') {
    say('  On your phone: Settings -> Linked Devices -> Link a Device');
    say('  Then scan this:');
    say();
    qrcode.generate(challenge.qr, { small: true });
  } else {
    say('  On your phone: Settings -> Linked Devices -> Link a Device');
    say('  -> "Link with phone number instead", then enter this code:');
    say();
    say(`      ${challenge.code}`);
  }
  say();
  say('  Waiting for the link to complete... (ctrl-c to stop)');
  say();

  // Consume inbound messages for as long as the process runs.
  void (async () => {
    for await (const event of ctx.provider.inbound()) {
      say(`  <- ${event.fromPhoneE164 ?? event.fromProviderAddress}: ${event.body}`);
      await persistInbound(ctx.db, localKms, ctx.orgId, ctx.senderId,
        event.fromPhoneE164 ?? '', event.fromProviderAddress, event.body, event.providerMessageId);
      say('     stored');
    }
  })();

  void (async () => {
    for await (const s of ctx.provider.status()) {
      say(`  ** ${s.providerMessageId} -> ${s.status}`);
    }
  })();

  // Report when the connection actually opens, so the operator knows linking worked.
  const started = Date.now();
  const poll = setInterval(() => {
    void ctx.provider.health(ctx.senderId).then(async (h) => {
      if (h.state === 'open') {
        clearInterval(poll);
        await ctx.db.execute(sql`
          UPDATE sender_identity SET status = 'active'
          WHERE id = ${ctx.senderId}`);
        say('  ✓ LINKED. Credentials are encrypted in Postgres — this survives a restart.');
        say('  Send a WhatsApp message to this number from another phone and watch it appear.');
        say();
      } else if (h.state === 'logged_out') {
        clearInterval(poll);
        say('  ✗ logged out — the number was unlinked from the phone.');
        process.exit(1);
      } else if (Date.now() - started > 180_000) {
        clearInterval(poll);
        say('  ✗ gave up waiting. Re-run to get a fresh code.');
        process.exit(1);
      }
    });
  }, 2000);

  process.on('SIGINT', () => {
    say('\n  stopping (the link stays active; credentials remain stored)');
    void ctx.provider.shutdown().then(() => process.exit(0));
  });
}

/** Reconnects the stored session and sends one message. */
async function send(to: string, body: string): Promise<void> {
  const ctx = await bootstrap();
  say(`  reconnecting sender ${ctx.senderId} from stored credentials...`);
  await ctx.provider.connect({ id: ctx.senderId, phoneE164: '' });

  // Wait for the socket to actually open before sending.
  for (let i = 0; i < 40; i++) {
    if ((await ctx.provider.health(ctx.senderId)).state === 'open') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const health = await ctx.provider.health(ctx.senderId);
  if (health.state !== 'open') {
    say(`  ✗ could not connect (state: ${health.state}). Run "npm run wa:link" first.`);
    process.exit(1);
  }

  const result = await ctx.provider.send(
    { id: ctx.senderId, phoneE164: '' },
    { phoneE164: to.startsWith('+') ? to : `+${to}` },
    { kind: 'freeform', body }
  );
  say(`  -> sent, whatsapp id ${result.providerMessageId}`);
  await new Promise((r) => setTimeout(r, 3000));
  await ctx.provider.shutdown();
  await ctx.db.$client.end();
  process.exit(0);
}

const args = process.argv.slice(2);
if (args[0] === 'send') {
  const [, to, ...rest] = args;
  if (to === undefined || rest.length === 0) {
    say('usage: npm run wa:send <number> "<message>"');
    process.exit(1);
  }
  void send(to, rest.join(' '));
} else {
  const pairIndex = args.indexOf('--pair');
  const phone = pairIndex >= 0 ? args[pairIndex + 1] : undefined;
  void link(phone !== undefined ? 'pairing_code' : 'qr', phone);
}
