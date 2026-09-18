import { and, eq } from 'drizzle-orm';
import type { AuthStateStore } from '@crm/channels';
import type { KmsDriver } from '@crm/kms-local';
import type { Database } from './client.js';
import { channelAuthState } from './schema.js';

/**
 * Stores WhatsApp session credentials in Postgres, encrypted.
 *
 * This is what makes a linked number survive a restart, a redeploy, and an ephemeral
 * filesystem — and what makes a database restore bring the numbers back with it. Baileys'
 * own file-based store is explicitly marked "DO NOT USE IN PROD", and the previous system
 * needed every session reconnected by hand after each restart (docs/00-prior-art.md, M29/M30).
 *
 * Every value is encrypted before it touches a row, so a leaked database dump does not hand
 * over working WhatsApp sessions without the key as well.
 */
export class PostgresAuthStateStore implements AuthStateStore {
  readonly #db: Database;
  readonly #kms: KmsDriver;

  /** Takes the database handle and the KMS driver used to encrypt every stored value. */
  constructor(db: Database, kms: KmsDriver) {
    this.#db = db;
    this.#kms = kms;
  }

  /** Reads and decrypts one credential, or null when it has never been written. */
  async get(senderId: string, key: string): Promise<Uint8Array | null> {
    const rows = await this.#db
      .select({ valueEnc: channelAuthState.valueEnc })
      .from(channelAuthState)
      .where(and(eq(channelAuthState.senderIdentityId, senderId), eq(channelAuthState.key, key)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.#kms.decrypt(row.valueEnc);
  }

  /**
   * Writes one credential, replacing any previous value. Upsert rather than delete-then-insert
   * because Baileys rewrites keys constantly during a session and a gap between the two would
   * be a window where the session is unrecoverable.
   */
  async set(senderId: string, key: string, value: Uint8Array): Promise<void> {
    const valueEnc = this.#kms.encrypt(value);
    await this.#db
      .insert(channelAuthState)
      .values({ senderIdentityId: senderId, key, valueEnc })
      .onConflictDoUpdate({
        target: [channelAuthState.senderIdentityId, channelAuthState.key],
        set: { valueEnc, updatedAt: new Date() }
      });
  }

  /** Deletes one credential. Removing a key that was never present is not an error. */
  async remove(senderId: string, key: string): Promise<void> {
    await this.#db
      .delete(channelAuthState)
      .where(and(eq(channelAuthState.senderIdentityId, senderId), eq(channelAuthState.key, key)));
  }

  /**
   * Deletes every credential for a sender. Called on logout — the session is gone from
   * WhatsApp's side, so keeping the keys would only invite a doomed reconnect loop.
   */
  async clear(senderId: string): Promise<void> {
    await this.#db.delete(channelAuthState).where(eq(channelAuthState.senderIdentityId, senderId));
  }

  /** Lists the keys held for a sender. Used to decide whether a session can be restored at all. */
  async keys(senderId: string): Promise<string[]> {
    const rows = await this.#db
      .select({ key: channelAuthState.key })
      .from(channelAuthState)
      .where(eq(channelAuthState.senderIdentityId, senderId));
    return rows.map((r) => r.key);
  }
}
