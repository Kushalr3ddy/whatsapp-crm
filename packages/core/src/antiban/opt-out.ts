import { sql } from 'drizzle-orm';
import type { LlmDriver } from '@crm/llm';
import type { KmsDriver } from '@crm/kms-local';
import { AUDIT, SYSTEM_ACTOR, writeAudit, type AuditActor } from '../audit.js';
import { CLOSING_MESSAGE_MARK } from './constants.js';
import type { Queryable } from './holds.js';
import { buildClosingMessage, looksNegative, matchesRestartWord, matchesStopWord } from './optout.js';
import { loadAntiBanSettings } from './settings.js';

/** The reason a contact is flagged do-not-contact when they, or an agent on their behalf, opted out (as opposed to a flag set by hand). */
export const OPT_OUT_REASON = 'opt_out';

/** What the gateway hands over after storing an inbound message. */
export interface InboundSafetyInput {
  readonly orgId: string;
  readonly conversationId: string;
  /** What the contact wrote. */
  readonly body: string;
  /** Only text is read; a photo or a voice note is never an opt-out. */
  readonly contentType: string;
}

/** What `handleInboundSafety` did. */
export interface InboundSafetyResult {
  readonly outcome: 'opted_out' | 'restarted' | 'review' | 'none';
  /** The closing message that was queued, or null (switched off, or nothing was opted out). */
  readonly closingMessageId: string | null;
  /** What recognised the opt-out. */
  readonly via: 'keyword' | 'classifier' | null;
}

/** What the opt-out needs from outside. */
export interface OptOutDeps {
  readonly db: Queryable;
  readonly kms: KmsDriver;
  /** The AI driver, for reading intent. Absent or `none`: keywords only. */
  readonly llm?: LlmDriver;
  readonly now?: () => Date;
}

const none: InboundSafetyResult = { outcome: 'none', closingMessageId: null, via: null };

/**
 * Reads what a contact just wrote for an opt-out or a restart (F6 S6). An opt-out is a STOP word (the whole message), one of the org's
 * own words, or, when an AI is configured, a message the classifier reads as negative (AC-6.1). It queues the one closing message
 * (AC-6.2, AC-6.3) and puts the contact on do-not-contact (AC-6.4). A contact already opted out is only listened to for a restart word
 * (AC-6.6); a second STOP sends nothing and costs no model call.
 */
export async function handleInboundSafety(deps: OptOutDeps, input: InboundSafetyInput): Promise<InboundSafetyResult> {
  const body = input.body.trim();
  if (input.contentType !== 'text' || body === '') return none;
  const settings = await loadAntiBanSettings(deps.db, input.orgId);

  const contact = await contactOf(deps.db, input.conversationId);
  if (contact === null) return none;
  const optedOut = contact.dnc && contact.reason === OPT_OUT_REASON;

  if (optedOut) {
    if (!matchesRestartWord(body, settings.restartWords)) {
      // A second STOP is not "they wrote to us again": an agent may answer an opted-out person by hand only once they have written
      // something else (AC-6.5), so the opt-out is stamped again, now, and the STOP just stored falls before it (R-037). GREATEST with
      // the database's own clock, because the message was stamped by the database and the gateway's clock can run behind it.
      if (matchesStopWord(body, settings.stopWords)) {
        const now = (deps.now ?? (() => new Date()))();
        await deps.db.execute(sql`
          UPDATE contact SET dnc_at = GREATEST(${now.toISOString()}::timestamptz, clock_timestamp()), updated_at = now()
          WHERE id = ${contact.id} AND do_not_contact AND dnc_reason = ${OPT_OUT_REASON}`);
      }
      return none;
    }
    const now = (deps.now ?? (() => new Date()))();
    const lifted = await deps.db.execute(sql`
      UPDATE contact SET do_not_contact = false, dnc_reason = NULL, dnc_at = NULL, updated_at = ${now.toISOString()}
      WHERE id = ${contact.id} AND do_not_contact AND dnc_reason = ${OPT_OUT_REASON} RETURNING id`);
    if ((lifted as unknown as unknown[]).length === 0) return none;
    await writeAudit(deps.db, {
      orgId: input.orgId, actor: SYSTEM_ACTOR, action: AUDIT.contactDncChanged, targetType: 'contact', targetId: contact.id,
      after: { doNotContact: false, reason: 'restart_word' }
    });
    return { outcome: 'restarted', closingMessageId: null, via: 'keyword' };
  }

  if (matchesStopWord(body, settings.stopWords)) {
    const done = await optOut(deps, { orgId: input.orgId, conversationId: input.conversationId, contactId: contact.id, actor: SYSTEM_ACTOR, via: 'keyword' });
    return done.alreadyOptedOut ? none : { outcome: 'opted_out', closingMessageId: done.closingMessageId, via: 'keyword' };
  }

  // The model's word alone never silences a person (R-046): a harmless "flood 10" was read as a refusal once in 32 texts. A message it reads
  // as negative goes to a colleague with a note, the AI stops answering that chat, and nothing is flagged or sent.
  if (await looksNegative(deps.llm, body)) {
    await flagForReview(deps.db, input.orgId, input.conversationId, body);
    return { outcome: 'review', closingMessageId: null, via: 'classifier' };
  }
  return none;
}

/** Leaves a note for the team and takes the chat off the AI, so a person reads what the contact wrote before anything else is sent. */
async function flagForReview(db: Queryable, orgId: string, conversationId: string, body: string): Promise<void> {
  const bot = (await db.execute(sql`SELECT bot_user_id AS "id" FROM ai_setting WHERE org_id = ${orgId}`) as unknown as Array<{ id: string | null }>)[0]?.id ?? null;
  const quoted = body.replace(/\s+/g, ' ').slice(0, 200);
  // Only a chat the AI owns is taken from it; a chat a person owns stays theirs.
  if (bot !== null) {
    await db.execute(sql`UPDATE conversation SET assignee_user_id = NULL, updated_at = now() WHERE id = ${conversationId} AND org_id = ${orgId} AND assignee_user_id = ${bot}`);
  }
  await db.execute(sql`
    INSERT INTO internal_note (org_id, conversation_id, author_user_id, body)
    VALUES (${orgId}, ${conversationId}, ${bot}, ${`The AI thinks this message may be a request to stop: "${quoted}". It has NOT been marked do-not-contact. Read it, and mark the person yourself if they do want to stop.`})`);
}

/** What `markOptOut` did. */
export interface OptOutResult {
  /** The closing message that was queued, or null (switched off, or already opted out). */
  readonly closingMessageId: string | null;
  /** The contact was already opted out, so nothing was done and nothing is sent. */
  readonly alreadyOptedOut: boolean;
}

/**
 * An agent marks a reply as an opt-out by hand, because the classifier missed it (F6 AC-6.8). Same effect as the contact saying STOP:
 * one closing message, then do-not-contact. Marking someone already opted out does nothing.
 */
export async function markOptOut(
  db: Queryable, kms: KmsDriver,
  input: { readonly orgId: string; readonly conversationId: string; readonly actor?: AuditActor; readonly now?: () => Date }
): Promise<OptOutResult & { found: boolean }> {
  const contact = await contactOf(db, input.conversationId);
  if (contact === null) return { closingMessageId: null, alreadyOptedOut: false, found: false };
  const done = await optOut({ db, kms, ...(input.now === undefined ? {} : { now: input.now }) }, {
    orgId: input.orgId, conversationId: input.conversationId, contactId: contact.id, actor: input.actor ?? SYSTEM_ACTOR, via: null
  });
  return { ...done, found: true };
}

/** The contact of a conversation and whether, and why, they are on do-not-contact. */
async function contactOf(db: Queryable, conversationId: string): Promise<{ id: string; dnc: boolean; reason: string | null } | null> {
  const row = (await db.execute(sql`
    SELECT c.id, c.do_not_contact AS dnc, c.dnc_reason AS reason
    FROM conversation v JOIN contact c ON c.id = v.contact_id
    WHERE v.id = ${conversationId}`) as unknown as Array<{ id: string; dnc: boolean; reason: string | null }>)[0];
  return row ?? null;
}

/**
 * The shared effect of an opt-out. The flag is taken in one statement that only one caller can win, so two STOPs arriving together
 * still produce a single closing message (AC-6.3). Every flag set here carries the reason `opt_out`, which is what lets a restart
 * word lift it and nothing else.
 */
async function optOut(
  deps: Omit<OptOutDeps, 'llm'>,
  input: { orgId: string; conversationId: string; contactId: string; actor: AuditActor; via: 'keyword' | 'classifier' | null }
): Promise<OptOutResult> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await deps.db.execute(sql`
    UPDATE contact SET do_not_contact = true, dnc_reason = ${OPT_OUT_REASON}, dnc_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    WHERE id = ${input.contactId} AND NOT (do_not_contact AND dnc_reason = ${OPT_OUT_REASON}) RETURNING id`);
  if ((claimed as unknown as unknown[]).length === 0) return { closingMessageId: null, alreadyOptedOut: true };
  await writeAudit(deps.db, {
    orgId: input.orgId, actor: input.actor, action: AUDIT.contactDncChanged, targetType: 'contact', targetId: input.contactId,
    after: { doNotContact: true, reason: OPT_OUT_REASON, via: input.via ?? 'agent' }
  });

  const settings = await loadAntiBanSettings(deps.db, input.orgId);
  if (!settings.closingMessageEnabled) return { closingMessageId: null, alreadyOptedOut: false };

  const last = await lastSentTo(deps, input.conversationId);
  const text = buildClosingMessage({
    purpose: last?.campaignPurpose ?? settings.defaultPurpose, summary: last?.body ?? null,
    phone: settings.contactPhone, email: settings.contactEmail
  });
  // Past the do-not-contact gate it has just raised, and at reply priority (the lane reads the mark): the closing message is the one
  // thing this contact is still sent.
  const inserted = (await deps.db.execute(sql`
    INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, dnc_override, dnc_override_reason)
    VALUES (${input.orgId}, ${input.conversationId}, 'outbound', 'queued', 'text',
            ${Buffer.from(deps.kms.encrypt(new TextEncoder().encode(text)))}, ${deps.kms.blindIndex(text)}, 'system', true, ${CLOSING_MESSAGE_MARK})
    RETURNING id`) as unknown as Array<{ id: string }>)[0]!;
  return { closingMessageId: inserted.id, alreadyOptedOut: false };
}

/**
 * What this contact is told they were messaged about: the latest campaign message in the chat, with its campaign's purpose, because that
 * is why they were written to. Only a chat with no campaign message falls back to the last thing a person or the AI sent. Campaign messages
 * are stored as sent by `system`, as are closing messages, so the campaign id is what tells them apart (R-038).
 */
async function lastSentTo(
  deps: Omit<OptOutDeps, 'llm'>, conversationId: string
): Promise<{ body: string | null; campaignPurpose: string | null } | null> {
  const row = (await deps.db.execute(sql`
    SELECT m.body_enc AS "bodyEnc", c.purpose AS "purpose"
    FROM message m LEFT JOIN campaign c ON c.id = m.campaign_id
    WHERE m.conversation_id = ${conversationId} AND m.direction = 'outbound' AND m.status IN ('sent', 'delivered', 'read')
      AND m.body_enc IS NOT NULL
      AND (m.campaign_id IS NOT NULL OR m.sent_by NOT IN ('phone', 'system'))
    ORDER BY (m.campaign_id IS NOT NULL) DESC, m.sent_at DESC NULLS LAST, m.created_at DESC LIMIT 1`) as unknown as Array<{ bodyEnc: Uint8Array; purpose: string | null }>)[0];
  if (row === undefined) return null;
  let body: string | null = null;
  try { body = new TextDecoder().decode(deps.kms.decrypt(row.bodyEnc)); } catch { body = null; }
  return { body, campaignPurpose: row.purpose };
}
