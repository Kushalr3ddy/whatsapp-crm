import { RETRY_WAVE_CONTACTS, RETRY_WAVE_WINDOW_MS } from './constants.js';

/**
 * Retries from 3 or more different contacts within 10 minutes (F6 AC-5.4): not one phone with a problem but our own session store
 * failing to produce what the contacts can read, so the whole number is held. One contact asking again and again is not a wave.
 */
export function isDecryptWave(retries: ReadonlyArray<{ contact: string; at: Date }>, now: Date): boolean {
  const since = now.getTime() - RETRY_WAVE_WINDOW_MS;
  const contacts = new Set(retries.filter((r) => r.at.getTime() >= since && r.at.getTime() <= now.getTime()).map((r) => r.contact));
  return contacts.size >= RETRY_WAVE_CONTACTS;
}
