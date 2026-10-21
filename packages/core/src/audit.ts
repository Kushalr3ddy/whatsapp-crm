import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';

/** What kind of thing acted. Keeps a person and an automation apart without two null columns. */
export type ActorType = 'user' | 'system' | 'api' | 'agent';

/** Who did it. */
export interface AuditActor {
  readonly type: ActorType;
  readonly id: string;
}

/**
 * The reserved system actor.
 *
 * Every audit row needs a non-null actor (NFR-17), and plenty of real changes have no person
 * behind them — the gateway sending a queued message, a retention job deleting old rows. A
 * fixed, well-known id keeps those rows honest instead of forcing a nullable column that would
 * then be null for half the table.
 *
 * Not a foreign key to anything: actors live in `app_user`, `api_key`, or nowhere at all.
 */
export const SYSTEM_ACTOR: AuditActor = {
  type: 'system',
  id: '00000000-0000-0000-0000-000000000001'
};

/** One thing that happened. */
export interface AuditEntry {
  readonly orgId: string;
  readonly actor: AuditActor;
  /** Verb-shaped and stable enough to filter on: `auth.login.succeeded`, `api_key.revoked`. */
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  /**
   * State either side of the change. **Never a secret** — no password hashes, no key
   * material, no message bodies. An audit log that has to be protected like the data it
   * describes is a second copy of the problem.
   */
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
  /** Correlates this row with the log lines from the same request. */
  readonly requestId?: string | null;
}

/** Anything that can run a query: the database, or a transaction inside one. */
export interface AuditExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

/**
 * Records one state change.
 *
 * **Pass the transaction, not the database**, wherever the change is transactional. Writing
 * the audit row in the same transaction as the change it describes is what makes an unaudited
 * change impossible: if this insert fails, the change rolls back with it. Called with the
 * database instead, the two can diverge — which is the failure mode an audit log exists to
 * rule out.
 *
 * Deliberately throws rather than swallowing. A silent audit failure is indistinguishable
 * from nothing having happened, which is precisely what an attacker would want.
 */
export async function writeAudit(executor: AuditExecutor, entry: AuditEntry): Promise<void> {
  await executor.execute(sql`
    INSERT INTO audit_log (org_id, actor_type, actor_id, action, target_type, target_id,
                           before, after, ip, request_id)
    VALUES (${entry.orgId}, ${entry.actor.type}, ${entry.actor.id}, ${entry.action},
            ${entry.targetType ?? null}, ${entry.targetId ?? null},
            ${entry.before === undefined ? null : JSON.stringify(entry.before)}::jsonb,
            ${entry.after === undefined ? null : JSON.stringify(entry.after)}::jsonb,
            ${entry.ip ?? null}, ${entry.requestId ?? null})`);
}

/**
 * The actions this system records, as constants rather than loose strings.
 *
 * Typo-proofing is the small reason. The larger one is that this list *is* the answer to
 * "what does the audit log cover?" — a question otherwise answered by grepping for string
 * literals and hoping.
 */
export const AUDIT = {
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  logout: 'auth.logout',
  passwordChanged: 'auth.password.changed',
  orgCreated: 'org.created',
  userAdded: 'user.added',
  userRoleChanged: 'user.role.changed',
  userDisabled: 'user.disabled',
  userEnabled: 'user.enabled',
  apiKeyIssued: 'api_key.issued',
  apiKeyRevoked: 'api_key.revoked',

  // Reads, not changes (docs/21-deferred.md, D-13). Recorded from the moment attachments
  // could be stored at all, because a trail that begins after the first CV is worth much
  // less than one that begins with it.
  //
  // Deliberately NOT every query: listing an inbox is not a meaningful access event, and a
  // log that records one is too noisy to answer the question it exists for. Opening a thread
  // and downloading a file are.
  conversationRead: 'conversation.read',
  mediaDownloaded: 'media.downloaded',

  // A bulk export of the contact book — the easiest way to leak everything at once, so it is
  // always recorded: who, which format, and how many people.
  contactsExported: 'contacts.exported',

  // Inbox collaboration. Assignment and resolution are the acts two agents can disagree
  // about — "who was meant to answer this?", "who closed it?" — so each writes a row with the
  // value on either side, which is what makes those questions answerable after the fact.
  conversationAssigned: 'conversation.assigned',
  conversationStatusChanged: 'conversation.status_changed',
  // Who else is on a thread is as arguable as who owns it, so each change is its own row.
  conversationParticipantAdded: 'conversation.participant_added',
  conversationParticipantRemoved: 'conversation.participant_removed',

  // Key rotation (D-31). Pausing or resuming the re-encryption, and verifying that the new key
  // really opens what was written, are the acts someone may later need to account for.
  encryptionRotationPaused: 'encryption.rotation_paused',
  encryptionRotationResumed: 'encryption.rotation_resumed',
  encryptionVerified: 'encryption.verified',
  encryptionKeyGenerated: 'encryption.key_generated',

  // Imports. The upload is recorded separately from the commit because they are different
  // acts: one stores somebody's spreadsheet, the other changes the contact database.
  importUploaded: 'import.uploaded',
  importDryRun: 'import.dry_run',
  importCommitted: 'import.committed',

  // Campaigns. Starting one is the act worth recording — it is the moment an audience is
  // frozen and a number commits to sending to all of them.
  campaignCreated: 'campaign.created',
  campaignStarted: 'campaign.started',
  campaignPaused: 'campaign.paused',
  campaignCancelled: 'campaign.cancelled',
  // An admin knowingly lifting recipient-experience gates for one campaign, and switching a number
  // between enforcing the anti-ban engine and advisory mode (D-29). Both carry a reason.
  campaignGatesOverridden: 'campaign.gates_overridden',
  senderEnforcementChanged: 'sender.enforcement_changed',
  // Do-not-contact: flagging someone, and an admin knowingly messaging a flagged contact anyway.
  contactDncChanged: 'contact.dnc_changed',
  // Two contacts turned out to be one person (a privacy address was linked to a phone number).
  contactMerged: 'contact.merged',
  // The number we message a contact on was changed because the primary one has no WhatsApp account (D-60).
  contactNumberSwitched: 'contact.number_switched',
  messageDncOverridden: 'message.dnc_overridden',
  contactsBulkTagged: 'contacts.bulk_tagged',
  contactsBulkUntagged: 'contacts.bulk_untagged',
  customFieldCreated: 'custom_field.created',
  customFieldDeleted: 'custom_field.deleted',
  // The AI assistant: switching it on or off (with the data-sharing consent), and changing its instructions or limits.
  aiEnabled: 'ai.enabled',
  aiDisabled: 'ai.disabled',
  aiSettingsChanged: 'ai.settings_changed'
} as const;

/**
 * Records a change that is not already inside a transaction, setting tenant context for it.
 *
 * `audit_log` carries row-level security like every other org-scoped table, and RLS reads
 * `app.org_id` — which is transaction-scoped. Nothing on the request path sets it today, so a
 * bare insert would be refused under a correctly configured application role while appearing
 * to work as the table owner. That silent difference is exactly what
 * `inspectDatabaseSecurity()` warns about at boot, and an audit row is the worst place to
 * discover it: the insert shares its transaction with real work, so a refusal would roll that
 * work back.
 *
 * Prefer `writeAudit(tx, …)` and pass the transaction the change is already in. Use this only
 * where there is no such transaction to join.
 */
export async function writeAuditInTenant(db: Database, entry: AuditEntry): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenant(tx, entry.orgId);
    await writeAudit(tx, entry);
  });
}
