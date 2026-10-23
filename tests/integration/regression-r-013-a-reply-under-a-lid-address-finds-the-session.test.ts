import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  addTransactionCapability, Curve, generateSignalPubKey, initAuthCreds,
  type AuthenticationCreds, type SignalKeyStore
} from 'baileys';
import { makeLibSignalRepository } from 'baileys/lib/Signal/libsignal.js';
import { createDatabase, PostgresAuthStateStore, type Database } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { loadAuthState } from '@crm/channel-baileys';

/**
 * R-013 (2026-10-23, found by: Kushal and the other dev, "Waiting for this message"; D-101 and D-102, docs/45).
 *
 * WhatsApp addresses one person two ways: by phone number (`919964122631@s.whatsapp.net`) and by a privacy address (`110762928373833@lid`).
 * We start a chat by phone number, so the encryption session is created under the phone number; the person's replies and retry requests
 * then arrive under the LID address. Baileys 6.7.24 stored a session per `user.device` with no link between the two, so the reply found
 * "No session record" and the contact's phone showed "Waiting for this message" for what we sent next. Baileys 7 keeps the pair and moves
 * the session across; this test runs the real library code against our real credential store (Postgres, encrypted) to prove it.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const kms = new LocalKms({ keyHex: randomBytes(32).toString('hex'), indexKeyHex: randomBytes(32).toString('hex') });
const orgId = '66666666-2222-3333-4444-555555555555';

const silent = {
  level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}
};

const BOB_PN = '919964122631@s.whatsapp.net';
const BOB_LID = '110762928373833@lid';
const ALICE_PN = '919035524447@s.whatsapp.net';
const enc = (s: string) => Buffer.from(s, 'utf8');
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

let db: Database;
let senderId: string;

beforeAll(async () => {
  db = createDatabase(url, { max: 2 });
  await db.execute(sql`INSERT INTO org(id,name,slug) VALUES (${orgId},'r013','r013') ON CONFLICT (id) DO NOTHING`);
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM org WHERE id = ${orgId}`);
  await db.$client.end();
});
beforeEach(async () => {
  const rows = await db.execute(sql`INSERT INTO sender_identity(org_id, provider, label) VALUES (${orgId},'baileys','r013 number') RETURNING id`);
  senderId = (rows as unknown as Array<{ id: string }>)[0]!.id;
});

/** A throwaway in-memory key store, for the contact's side. */
function memoryKeys(): SignalKeyStore {
  const data = new Map<string, unknown>();
  return {
    get: (type, ids) => {
      const out: Record<string, unknown> = {};
      for (const id of ids) { const v = data.get(`${type}:${id}`); if (v !== undefined) out[id] = v; }
      return Promise.resolve(out as never);
    },
    set: (batch) => {
      for (const [type, entries] of Object.entries(batch)) {
        for (const [id, v] of Object.entries(entries ?? {})) { if (v) data.set(`${type}:${id}`, v); else data.delete(`${type}:${id}`); }
      }
      return Promise.resolve();
    }
  };
}

/** The contact (Bob): his own repository, and the bundle of keys WhatsApp would hand us when we first write to him. */
async function makeBob() {
  const creds: AuthenticationCreds = initAuthCreds();
  const keys = addTransactionCapability(memoryKeys(), silent as never, { maxCommitRetries: 3, delayBetweenTriesMs: 5 });
  const preKey = Curve.generateKeyPair();
  await keys.set({ 'pre-key': { 1: preKey } });
  const repo = makeLibSignalRepository({ creds, keys }, silent as never);
  const bundle = {
    registrationId: creds.registrationId,
    identityKey: generateSignalPubKey(creds.signedIdentityKey.public),
    signedPreKey: { keyId: creds.signedPreKey.keyId, publicKey: generateSignalPubKey(creds.signedPreKey.keyPair.public), signature: creds.signedPreKey.signature },
    preKey: { keyId: 1, publicKey: generateSignalPubKey(preKey.public) }
  };
  return { repo, bundle };
}

/** Our side (Alice): the real credential store this system uses, with Baileys' transaction wrapper as the socket applies it. */
async function makeAlice() {
  const { state, saveCreds } = await loadAuthState(new PostgresAuthStateStore(db, kms), senderId);
  // The socket saves the account's identity as soon as it is made (`creds.update`); without it a restart would be a different account.
  await saveCreds();
  const keys = addTransactionCapability(state.keys, silent as never, { maxCommitRetries: 3, delayBetweenTriesMs: 5 });
  return { repo: makeLibSignalRepository({ creds: state.creds, keys }, silent as never), keys };
}

/** We write first, by phone number (a campaign's opening message); Bob reads it and answers. Returns Bob's reply as it would arrive. */
async function firstContactAndReply() {
  const { repo: alice, keys } = await makeAlice();
  const bob = await makeBob();
  // Sending to a person first looks up their devices and keeps the list (the log line "sending message to 5 devices"); the session
  // move needs that list to know which devices to carry across.
  await keys.set({ 'device-list': { '919964122631': ['0'] } });
  await alice.injectE2ESession({ jid: BOB_PN, session: bob.bundle });
  const opening = await alice.encryptMessage({ jid: BOB_PN, data: enc('Hello Bob, are you interested?') });
  expect(opening.type).toBe('pkmsg');
  expect(dec(await bob.repo.decryptMessage({ jid: ALICE_PN, type: 'pkmsg', ciphertext: opening.ciphertext }))).toBe('Hello Bob, are you interested?');
  const reply = await bob.repo.encryptMessage({ jid: ALICE_PN, data: enc('Yes I am interested') });
  return { alice, bob, reply };
}

describe('a reply that arrives under the contact\'s LID address', () => {
  it('[R-013] cannot be read when the phone-number session is not linked to the LID (the old behaviour, the cause of "Waiting for this message")', async () => {
    const { alice, reply } = await firstContactAndReply();
    await expect(alice.decryptMessage({ jid: BOB_LID, type: reply.type, ciphertext: reply.ciphertext })).rejects.toThrow(/No (session record|matching sessions)/i);
  });

  it('[R-013] is read once the pair is stored and the session is moved across, and what we send next is readable by the contact', async () => {
    const { alice, bob, reply } = await firstContactAndReply();
    await alice.lidMapping.storeLIDPNMappings([{ lid: BOB_LID, pn: BOB_PN }]);
    await alice.migrateSession(BOB_PN, BOB_LID);
    expect(dec(await alice.decryptMessage({ jid: BOB_LID, type: reply.type, ciphertext: reply.ciphertext }))).toBe('Yes I am interested');
    // Our answer goes out under the LID address now; Bob (who knows us by one address) can read it: no retry request, no "Waiting".
    const answer = await alice.encryptMessage({ jid: BOB_LID, data: enc('Great, which city are you in?') });
    expect(answer.type).toBe('msg');
    expect(dec(await bob.repo.decryptMessage({ jid: ALICE_PN, type: answer.type, ciphertext: answer.ciphertext }))).toBe('Great, which city are you in?');
  });

  it('[R-013] keeps working after a restart: the pair and the moved session come back from the encrypted Postgres store', async () => {
    const { alice, bob, reply } = await firstContactAndReply();
    await alice.lidMapping.storeLIDPNMappings([{ lid: BOB_LID, pn: BOB_PN }]);
    await alice.migrateSession(BOB_PN, BOB_LID);
    expect(dec(await alice.decryptMessage({ jid: BOB_LID, type: reply.type, ciphertext: reply.ciphertext }))).toBe('Yes I am interested');

    // A new process: nothing in memory, everything read back through loadAuthState.
    const { repo: restarted } = await makeAlice();
    expect(await restarted.lidMapping.getPNForLID(BOB_LID)).toMatch(/^919964122631(:0)?@s\.whatsapp\.net$/);
    const more = await restarted.encryptMessage({ jid: BOB_LID, data: enc('And your number?') });
    expect(more.type).toBe('msg');
    expect(dec(await bob.repo.decryptMessage({ jid: ALICE_PN, type: more.type, ciphertext: more.ciphertext }))).toBe('And your number?');
  });
});
