/**
 * Encryption key rotation, the part that must happen on the server (D-31).
 *
 *   npm run keys -- status     where every encrypted value stands, instance-wide
 *   npm run keys -- generate   make a new key and print exactly what to change to adopt it
 *
 * Deliberately prints rather than edits. The key lives in the process environment (.env or your
 * secret store); a script that silently rewrote it could lose the only copy of the old one. The
 * web wizard (Security page) shows progress and drives the re-encryption, and tells you when to
 * come back here.
 */
import { randomBytes } from 'node:crypto';
import { createDatabase } from '@crm/db';
import { loadConfig } from '@crm/shared';
import { localKmsFromConfig } from '@crm/kms-local';
import { keyVersionCounts, versionsMissingFromKeyRing } from '@crm/core';

/** Prints a line. */
const say = (s = ''): void => { process.stdout.write(`${s}\n`); };

/** Sums a version → count map. */
const sum = (o: Record<number, number>): number => Object.values(o).reduce((a, b) => a + b, 0);

/** Renders `{1: 12, 2: 3}` as "version 1: 12, version 2: 3". */
const fmt = (o: Record<number, number>): string =>
  Object.keys(o).length === 0 ? 'none' : Object.entries(o).map(([v, n]) => `version ${v}: ${String(n)}`).join(', ');

/** Where things stand: the key ring this process holds, and what the database actually contains. */
async function status(): Promise<void> {
  const config = loadConfig();
  const kms = localKmsFromConfig(config);
  const db = createDatabase(config.DATABASE_URL, { max: 1 });
  try {
    const counts = await keyVersionCounts(db);
    const missing = versionsMissingFromKeyRing(counts, kms);
    const total = sum(counts.message) + sum(counts.authState);
    const onCurrent = (counts.message[kms.keyVersion] ?? 0) + (counts.authState[kms.keyVersion] ?? 0);
    say();
    say('  Encryption keys');
    say('  ───────────────');
    say(`  current key version   ${String(kms.keyVersion)}`);
    say(`  retired keys held     ${kms.knownKeyVersions().filter((v) => v !== kms.keyVersion).join(', ') || 'none'}`);
    say(`  message bodies        ${fmt(counts.message)}`);
    say(`  WhatsApp sessions     ${fmt(counts.authState)}`);
    say();
    if (missing.length > 0) {
      say(`  ✗ DATA YOU CANNOT READ: key version(s) ${missing.join(', ')} are in the database but not in this`);
      say('    key ring. Add them to ENCRYPTION_KEYS_PREVIOUS as <version>:<64 hex chars> and restart.');
    } else if (total === onCurrent && kms.knownKeyVersions().length === 1) {
      say('  ✓ One key, and everything is on it. Nothing to do.');
    } else if (total === onCurrent) {
      say('  ✓ Everything is on the current key. The retired key can be removed from ENCRYPTION_KEYS_PREVIOUS');
      say('    (keep a backup of it for a while, then restart the API and gateway).');
    } else {
      say(`  … ${String(total - onCurrent)} of ${String(total)} values are still on a retired key. The gateway`);
      say('    re-encrypts them in the background; watch it on the Security page.');
    }
    say();
  } finally {
    await db.$client.end();
  }
}

/** Makes a new key and prints the exact environment lines to adopt it, plus what to do next. */
function generate(): void {
  const config = loadConfig();
  const kms = localKmsFromConfig(config);
  const next = kms.keyVersion + 1;
  if (next > 255) throw new Error('key version 255 is the last one; start a fresh install to go further');
  const fresh = randomBytes(32).toString('hex');
  const retired = [
    ...(config.ENCRYPTION_KEYS_PREVIOUS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    `${String(kms.keyVersion)}:${config.ENCRYPTION_KEY}`
  ].join(',');

  say();
  say('  A new encryption key');
  say('  ────────────────────');
  say('  1. BACK UP the current key somewhere safe first. Without it, any value not yet re-encrypted is');
  say('     unrecoverable. Keep that backup until the Security page says everything has moved.');
  say();
  say('  2. In .env (or your secret store), set these three lines, replacing what is there:');
  say();
  say(`       ENCRYPTION_KEY_VERSION=${String(next)}`);
  say(`       ENCRYPTION_KEY=${fresh}`);
  say(`       ENCRYPTION_KEYS_PREVIOUS=${retired}`);
  say();
  say('  3. Restart the API and the gateway. Nothing breaks: old data is still readable through the');
  say('     retired key, and everything new is written under the new one.');
  say();
  say('  4. Open the Security page. The gateway re-encrypts a little at a time; when it reaches 100%,');
  say('     click Verify, then remove the retired key from ENCRYPTION_KEYS_PREVIOUS and restart.');
  say();
  say('  ENCRYPTION_INDEX_KEY does not change. It must stay the same or duplicate detection breaks.');
  say();
}

const command = process.argv[2];
if (command === 'status') {
  status().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else if (command === 'generate') {
  try { generate(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
} else {
  say('usage: npm run keys -- status | generate');
  process.exit(command === undefined ? 0 : 1);
}
