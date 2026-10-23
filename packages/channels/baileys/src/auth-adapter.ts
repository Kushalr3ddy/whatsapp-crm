import { BufferJSON, initAuthCreds, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from 'baileys';
import type { AuthStateStore } from '@crm/channels';

/** Key under which the account's root credentials are stored. */
const CREDS_KEY = 'creds';

/**
 * Bridges our encrypted Postgres credential store into the shape Baileys expects.
 *
 * Baileys ships `useMultiFileAuthState`, which writes these credentials as files and carries an
 * explicit "DO NOT USE IN PROD" warning in its own source. Files are also lost on any ephemeral
 * filesystem and cannot be backed up with the database, which is why the previous system needed
 * every number re-linked by hand after each restart (docs/00-prior-art.md, M29/M30).
 *
 * Values are serialised with Baileys' own `BufferJSON`, which preserves the binary key material
 * that plain `JSON.stringify` would quietly corrupt into `{"type":"Buffer"}` objects.
 */
export async function loadAuthState(
  store: AuthStateStore,
  senderId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; flush: () => Promise<void> }> {
  const creds = (await readKey<AuthenticationCreds>(store, senderId, CREDS_KEY)) ?? initAuthCreds();

  /**
   * One queue per key. The encryption session for a contact is rewritten on every message in either direction, and two overlapping
   * writes to the same key could land out of order (an older state replacing a newer one), which leaves our copy behind what WhatsApp
   * already acknowledged: the "session diverged" fault of D-82. Writes to one key therefore run one after another, in the order asked.
   */
  const queues = new Map<string, Promise<void>>();
  const enqueue = (key: string, job: () => Promise<void>): Promise<void> => {
    const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
    queues.set(key, run);
    const done = (): void => { if (queues.get(key) === run) queues.delete(key); };
    run.then(done, done);
    return run;
  };
  /** Resolves when every write asked for so far has landed (or failed). Called before the process exits. */
  const flush = async (): Promise<void> => {
    while (queues.size > 0) await Promise.allSettled([...queues.values()]);
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      /**
       * Bulk-reads signal protocol keys. Baileys asks for many at once during a handshake,
       * so this issues one read per id rather than a single query — acceptable because the
       * store is local and the call count is small and bounded.
       */
      get: async (type, ids) => {
        const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        await Promise.all(
          ids.map(async (id) => {
            const value = await readKey<SignalDataTypeMap[typeof type]>(store, senderId, `${type}-${id}`);
            if (value !== null) result[id] = value;
          })
        );
        return result;
      },

      /**
       * Bulk-writes or deletes keys. A null value means "forget this one" — Baileys uses that
       * to expire pre-keys, and treating it as a write would keep dead keys alive forever.
       */
      set: async (data) => {
        const writes: Array<Promise<void>> = [];
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
            const key = `${type}-${id}`;
            writes.push(enqueue(key, () => (value ? writeKey(store, senderId, key, value) : store.remove(senderId, key))));
          }
        }
        await Promise.all(writes);
      }
    }
  };

  return {
    state,
    /** Persists the root credentials. Baileys calls this whenever they change mid-session. */
    saveCreds: () => enqueue(CREDS_KEY, () => writeKey(store, senderId, CREDS_KEY, creds)),
    flush
  };
}

/** True when a sender has credentials on file and can therefore be reconnected without a QR. */
export async function hasStoredSession(store: AuthStateStore, senderId: string): Promise<boolean> {
  return (await store.get(senderId, CREDS_KEY)) !== null;
}

/** Reads and deserialises one stored value, returning null when it has never been written. */
async function readKey<T>(store: AuthStateStore, senderId: string, key: string): Promise<T | null> {
  const raw = await store.get(senderId, key);
  if (raw === null) return null;
  return JSON.parse(new TextDecoder().decode(raw), BufferJSON.reviver) as T;
}

/** Serialises and writes one value, preserving binary key material. */
async function writeKey(store: AuthStateStore, senderId: string, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, BufferJSON.replacer);
  await store.set(senderId, key, new TextEncoder().encode(json));
}
