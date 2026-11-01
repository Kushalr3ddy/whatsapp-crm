import { sql } from 'drizzle-orm';
import type { QuietHoursSetting } from '../antiban.js';
import { DEFAULT_TIME_ZONE, QUIET_HOURS_DEFAULT_END, QUIET_HOURS_DEFAULT_START } from './constants.js';
import type { Queryable } from './holds.js';

/** An org's sending settings (`antiban_setting`, one row; absent means these defaults). */
export interface AntiBanSettings {
  /** Send one closing message when someone opts out (F6 AC-6.7). On by default. */
  readonly closingMessageEnabled: boolean;
  /** The org's contact number and email, said in the closing message. */
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  /** Why the org messages people, when the campaign states no purpose of its own. */
  readonly defaultPurpose: string | null;
  /** The org's own opt-out words (lower case), besides the built-in ones. */
  readonly stopWords: readonly string[];
  /** The org's own words that lift do-not-contact, besides `start`. */
  readonly restartWords: readonly string[];
  readonly quietHours: QuietHoursSetting;
}

/** What `saveAntiBanSettings` accepts: any part of the settings. */
export type AntiBanSettingsPatch = Partial<Omit<AntiBanSettings, 'quietHours'>> & { readonly quietHours?: Partial<QuietHoursSetting> };

/** The org's settings, or the defaults when it has not set any. */
export async function loadAntiBanSettings(db: Queryable, orgId: string): Promise<AntiBanSettings> {
  const row = (await db.execute(sql`
    SELECT closing_message_enabled AS "closingMessageEnabled", contact_phone AS "contactPhone", contact_email AS "contactEmail",
           default_purpose AS "defaultPurpose", stop_words AS "stopWords", restart_words AS "restartWords",
           quiet_hours_enabled AS "qEnabled", quiet_hours_start AS "qStart", quiet_hours_end AS "qEnd", time_zone AS "timeZone"
    FROM antiban_setting WHERE org_id = ${orgId}`) as unknown as Array<{
      closingMessageEnabled: boolean; contactPhone: string | null; contactEmail: string | null; defaultPurpose: string | null;
      stopWords: string[]; restartWords: string[]; qEnabled: boolean; qStart: string; qEnd: string; timeZone: string }>)[0];
  if (row === undefined) {
    return {
      closingMessageEnabled: true, contactPhone: null, contactEmail: null, defaultPurpose: null, stopWords: [], restartWords: [],
      quietHours: { enabled: true, start: QUIET_HOURS_DEFAULT_START, end: QUIET_HOURS_DEFAULT_END, timeZone: DEFAULT_TIME_ZONE }
    };
  }
  return {
    closingMessageEnabled: row.closingMessageEnabled, contactPhone: row.contactPhone, contactEmail: row.contactEmail,
    defaultPurpose: row.defaultPurpose, stopWords: row.stopWords, restartWords: row.restartWords,
    quietHours: { enabled: row.qEnabled, start: row.qStart, end: row.qEnd, timeZone: row.timeZone }
  };
}

/** Words as they are stored and matched: lower case, trimmed, no empties, no repeats. */
export function cleanWords(words: readonly string[]): string[] {
  return [...new Set(words.map((w) => w.trim().toLowerCase().replace(/\s+/g, ' ')).filter((w) => w !== ''))];
}

/** Which contact details the settings page should ask for: the closing message leaves a line out for each one that is not set. */
export function missingContactDetails(s: AntiBanSettings): string[] {
  const missing: string[] = [];
  if (s.contactPhone === null || s.contactPhone.trim() === '') missing.push('contactPhone');
  if (s.contactEmail === null || s.contactEmail.trim() === '') missing.push('contactEmail');
  return missing;
}

/** Saves any part of the org's settings (creating the row on first use) and returns the result. */
export async function saveAntiBanSettings(db: Queryable, orgId: string, patch: AntiBanSettingsPatch): Promise<AntiBanSettings> {
  const cur = await loadAntiBanSettings(db, orgId);
  const q = { ...cur.quietHours, ...patch.quietHours };
  const next = {
    closingMessageEnabled: patch.closingMessageEnabled ?? cur.closingMessageEnabled,
    contactPhone: patch.contactPhone === undefined ? cur.contactPhone : patch.contactPhone,
    contactEmail: patch.contactEmail === undefined ? cur.contactEmail : patch.contactEmail,
    defaultPurpose: patch.defaultPurpose === undefined ? cur.defaultPurpose : patch.defaultPurpose,
    stopWords: patch.stopWords === undefined ? cur.stopWords : cleanWords(patch.stopWords),
    restartWords: patch.restartWords === undefined ? cur.restartWords : cleanWords(patch.restartWords)
  };
  await db.execute(sql`
    INSERT INTO antiban_setting (org_id, closing_message_enabled, contact_phone, contact_email, default_purpose, stop_words, restart_words,
                                 quiet_hours_enabled, quiet_hours_start, quiet_hours_end, time_zone, updated_at)
    VALUES (${orgId}, ${next.closingMessageEnabled}, ${next.contactPhone}, ${next.contactEmail}, ${next.defaultPurpose},
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(next.stopWords)}::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(next.restartWords)}::jsonb)),
            ${q.enabled}, ${q.start}, ${q.end}, ${q.timeZone}, now())
    ON CONFLICT (org_id) DO UPDATE SET
      closing_message_enabled = EXCLUDED.closing_message_enabled, contact_phone = EXCLUDED.contact_phone,
      contact_email = EXCLUDED.contact_email, default_purpose = EXCLUDED.default_purpose,
      stop_words = EXCLUDED.stop_words, restart_words = EXCLUDED.restart_words,
      quiet_hours_enabled = EXCLUDED.quiet_hours_enabled, quiet_hours_start = EXCLUDED.quiet_hours_start,
      quiet_hours_end = EXCLUDED.quiet_hours_end, time_zone = EXCLUDED.time_zone, updated_at = now()`);
  return loadAntiBanSettings(db, orgId);
}
