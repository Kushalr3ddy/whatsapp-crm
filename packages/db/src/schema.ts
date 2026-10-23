import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn, boolean, customType, index, integer, jsonb, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid
} from 'drizzle-orm/pg-core';

/**
 * Postgres `bytea`, which Drizzle has no first-class column type for. Used for every
 * encrypted column, since ciphertext is binary and storing it as text would mean base64
 * padding on every row for no benefit.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value)
});

/**
 * A tenant. Single-tenant deployments have exactly one row — the isolation code path is
 * identical either way, which is what keeps it actually exercised (docs/05-data-model.md).
 */
export const org = pgTable('org', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * A person who signs in. `passwordHash` is null when an external identity provider
 * authenticates them — authorisation still stays local either way (docs/09-security.md).
 */
export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('active'),
  /** The org's AI assistant. It has no password and can never sign in; it is a member only so it can own conversations. */
  isBot: boolean('is_bot').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Binds a user to an org with a role. Roles attach to the membership rather than the user
 * so one person can belong to several orgs later without a schema change.
 */
export const orgMembership = pgTable('org_membership', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('agent'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('org_membership_org_user_uidx').on(t.orgId, t.userId)
]);

/**
 * Append-only record of every state change.
 *
 * **No row may have a null actor** — that is what makes "who did this?" always answerable
 * (NFR-17). Automated changes use the reserved system actor rather than leaving it empty.
 *
 * Written by application code inside the same transaction as the change it describes, not by
 * a database trigger. A trigger cannot be forgotten, which is its appeal, but it has no
 * request context — no actor, no IP, no request id — and no *intent*: it sees three UPDATEs
 * where the application knows that was `contact.merged`. Intent is what makes this readable a
 * year later. Being in the same transaction means an unaudited change is impossible: if the
 * audit insert fails, the change it describes rolls back with it.
 *
 * This is not a log. Logs are operational, rotated, and have no tenant scope; this is a
 * product record with a viewer (F11), a retention policy and compliance weight. `requestId`
 * is the seam between the two — it correlates a row here with the log lines from that request.
 *
 * Deliberately **not** a record of traffic. `message` already says what was sent; auditing
 * every send would double write volume for no new information.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  /** `user` / `system` / `api` / `agent` — a person and an automation without two null columns. */
  actorType: text('actor_type').notNull(),
  /**
   * Who or what did it. Not a foreign key: an actor may be a user, an API key or the reserved
   * system actor, which live in different tables — and the audit row must outlive all of them.
   */
  actorId: uuid('actor_id').notNull(),
  /** Verb-shaped and stable enough to filter on: `auth.login.succeeded`, `api_key.revoked`. */
  action: text('action').notNull(),
  /** Not a foreign key either, because the target may later be deleted and this must survive. */
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  /**
   * State either side of the change — "what actually changed?" rather than "something did".
   * **Never put a secret here**: no password hashes, no key material, no message bodies.
   */
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  /** Correlates this row with the log lines from the same request. */
  requestId: text('request_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('audit_log_org_at_idx').on(t.orgId, t.at),
  index('audit_log_actor_idx').on(t.actorId),
  index('audit_log_action_idx').on(t.action)
]);

/**
 * A signed-in browser session.
 *
 * Deliberately **not** row-level-security protected, for the same reason `app_user` is not:
 * the lookup happens *before* any tenant context exists — resolving the session is what
 * establishes which org the request acts in. Enumeration is not a risk because the lookup key
 * is a hash of a 32-byte random token, and the application still filters by `orgId` on every
 * query that follows.
 *
 * Server-side rather than a stateless token, because `docs/09-security.md` requires session
 * invalidation on password change, which a self-contained JWT cannot do without a revocation
 * list — at which point it is a session table with extra steps.
 */
export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  /** Which tenant this session acts in, chosen at login. A person may belong to several. */
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  /** SHA-256 of the token. The token itself is never stored, so a database leak grants nothing. */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** Supports idle timeout and answers "was this session in use when it was abused?". */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  /** Recorded for the audit trail, never for authorisation — both are trivially spoofed. */
  ip: text('ip'),
  userAgent: text('user_agent'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('session_user_idx').on(t.userId),
  index('session_expires_idx').on(t.expiresAt)
]);

/**
 * Machine access. Sessions are for the first-party UI only; integrations always use a key
 * (docs/05-data-model.md).
 *
 * Not RLS-protected, and for the same reason as `session`: looking the key up is how the org
 * is discovered, so it cannot already be known.
 */
export const apiKey = pgTable('api_key', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  /** Human label — "job portal", "zapier" — so a key can be revoked without guessing its use. */
  name: text('name').notNull(),
  /** SHA-256 of the secret. Shown once at creation and never stored. */
  keyHash: text('key_hash').notNull().unique(),
  /** First characters, in clear, purely so the UI can show which key is which. */
  prefix: text('prefix').notNull(),
  /** Least privilege: a key that only reads contacts cannot send a message. */
  scopes: text('scopes').array().notNull().default([]),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(120),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Soft revocation, so audit entries referencing this key still resolve. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('api_key_org_idx').on(t.orgId)
]);

/**
 * A person the org talks to. Deliberately carries no domain fields — no candidate, no
 * customer, no patient. Anything business-specific lives in `customFields`, and anything
 * owned by another system is referenced through `externalRef` (docs/01-vision-scope.md).
 */
export const contact = pgTable('contact', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  ownerUserId: uuid('owner_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  // jsonb, not text: these are queried, not just stored. `custom_fields` is filtered on by
  // arbitrary user-defined keys (GIN-indexed), and `external_ref` is the lookup every host-app
  // sync performs. Stored as text, neither is indexable and neither can be filtered at all.
  customFields: jsonb('custom_fields').notNull().default({}),
  externalRef: jsonb('external_ref'),
  source: text('source'),

  // Gate zero on every send path. Not overridable by anyone, including an admin —
  // it protects a phone number's reputation as much as a legal position
  // (docs/08-antiban.md, "two classes of gate").
  doNotContact: boolean('do_not_contact').notNull().default(false),
  dncReason: text('dnc_reason'),
  dncAt: timestamp('dnc_at', { withTimezone: true }),

  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (t) => [
  index('contact_org_idx').on(t.orgId)
]);

/**
 * One way of reaching a contact — a phone number, an email, a WhatsApp id, a foreign key
 * into someone else's system. A contact has many; inbound resolution always goes
 * identity → contact, never a scan of `contact`.
 *
 * `valueNormalized` is the canonical form (E.164 for phones, lowercased for email) and is
 * uniquely indexed per org, so the database itself guarantees one identity maps to one
 * person. A CHECK rejects blank values, which makes the old empty-string dedup bug
 * structurally impossible rather than merely discouraged (docs/00-prior-art.md, M7/M8).
 */
export const contactIdentity = pgTable('contact_identity', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  valueNormalized: text('value_normalized').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /**
   * Whether this phone number has a WhatsApp account, as last asked of WhatsApp (D-60): true, false,
   * or null when never asked. Only filled for a contact with more than one number.
   */
  waRegistered: boolean('wa_registered'),
  /** When `waRegistered` was last checked; a stale answer is asked again. */
  waCheckedAt: timestamp('wa_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('contact_identity_lookup_uidx').on(t.orgId, t.kind, t.valueNormalized),
  index('contact_identity_contact_idx').on(t.contactId)
]);

/**
 * One of OUR numbers, and its accumulated reputation. Deliberately not called "session":
 * a sender identity is the number, a channel_session is one connection to it. The previous
 * system conflated the two, which is why its send caps counted the wrong thing and why
 * re-linking a number silently broke sending (docs/00-prior-art.md, M11).
 */
export const senderIdentity = pgTable('sender_identity', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  phoneE164: text('phone_e164'),
  ownerUserId: uuid('owner_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('linking'),
  capabilitiesSnapshot: jsonb('capabilities_snapshot'),
  health: jsonb('health').notNull().default({}),

  // Anti-ban state (docs/08-antiban.md). Present from the first migration so the engine has
  // somewhere to write when P6 lands, rather than needing a migration on a live table.
  warmupStartedAt: timestamp('warmup_started_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  riskScore: integer('risk_score').notNull().default(0),
  dailyCapOverride: integer('daily_cap_override'),

  // Layer 6 recovery orchestration (docs/08-antiban.md). A typed incident (a 463 timelock, a 429
  // rate overlimit, or a delivery-collapse soft ban) starts a *timed* recovery: sends are held
  // fully until `recovery_until`, then resume at a fraction of the cap that ramps back up weekly.
  // Distinct from `status` (which reacts to live signals) — this is the timed pause/ramp the
  // status recovery does not do. All null when the number is not in recovery.
  recoveryIncident: text('recovery_incident'),
  recoveryStartedAt: timestamp('recovery_started_at', { withTimezone: true }),
  recoveryUntil: timestamp('recovery_until', { withTimezone: true }),

  // Advisory mode (D-29). `enforce` is the default and the safe one. `advisory` keeps the engine
  // computing every signal but lets sends past the pacing/health holds, knowingly. Admin-set,
  // audited, with a reason; do-not-contact and consent are never relaxed. The bypass counters
  // record how often the engine WOULD have held, so an operator sees what they are accepting.
  enforcement: text('enforcement').notNull().default('enforce'),
  advisoryReason: text('advisory_reason'),
  advisorySetBy: uuid('advisory_set_by').references(() => appUser.id, { onDelete: 'set null' }),
  advisorySetAt: timestamp('advisory_set_at', { withTimezone: true }),
  advisoryBypassCount: integer('advisory_bypass_count').notNull().default(0),

  // Silent-restriction tracking (docs/27-restriction-tracking.md). WhatsApp does not say when it
  // restricts a number — messages just sit at one tick or arrive hours late — so the gateway infers
  // it from delivery evidence. `ok` | `suspected` | `likely`; `restriction_since` is when it entered
  // the current state, which the detector uses to avoid flapping.
  restrictionState: text('restriction_state').notNull().default('ok'),
  restrictionSince: timestamp('restriction_since', { withTimezone: true }),
  advisoryLastBypass: text('advisory_last_bypass'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('sender_identity_org_idx').on(t.orgId),
  uniqueIndex('sender_identity_phone_uidx').on(t.orgId, t.provider, t.phoneE164)
]);

/** One connection to a sender. Runtime state that is expected to churn, not reputation. */
export const channelSession = pgTable('channel_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderIdentityId: uuid('sender_identity_id').notNull()
    .references(() => senderIdentity.id, { onDelete: 'cascade' }),
  connectionState: text('connection_state').notNull().default('closed'),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  disconnectReason: text('disconnect_reason'),
  disconnectCode: integer('disconnect_code'),
  reconnectAttempts: integer('reconnect_attempts').notNull().default(0),
  // When the gateway last saw a burst of undecryptable frames ("Bad MAC") on this socket — the
  // early sign of a diverged companion session (D-14). The scorer treats it as live for a while
  // and then lets it lapse, so the number recovers on its own once the burst stops.
  decryptBurstAt: timestamp('decrypt_burst_at', { withTimezone: true }),

  // The linking handshake. The API cannot call the provider directly — the gateway owns the
  // socket in a separate process — so a link request is left here and the challenge WhatsApp
  // issues is written back for the API to serve.
  linkRequestedMode: text('link_requested_mode'),
  linkRequestedPhone: text('link_requested_phone'),
  linkRequestedAt: timestamp('link_requested_at', { withTimezone: true }),
  linkChallenge: jsonb('link_challenge'),
  linkError: text('link_error'),
  qrExpiresAt: timestamp('qr_expires_at', { withTimezone: true }),

  // Unlink request. Set by the API when a number is to be reset; the gateway (which owns the
  // socket) sees the NOTIFY, logs out on WhatsApp's side and clears the stored credentials, so a
  // fresh link can issue a new QR. Without this a corrupt or logged-out session is stuck linked.
  unlinkRequestedAt: timestamp('unlink_requested_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('channel_session_sender_uidx').on(t.senderIdentityId)
]);

/**
 * The WhatsApp credentials, one row per key, encrypted at rest.
 *
 * This table is the reason a restart does not cost you every linked number. Baileys' own
 * `useMultiFileAuthState` carries an explicit "DO NOT USE IN PROD" warning; disk state is
 * lost on any ephemeral filesystem (M30); and the previous system needed every session
 * reconnected by hand after each restart (M29). Keeping credentials here means a database
 * restore brings the numbers back with it.
 */
export const channelAuthState = pgTable('channel_auth_state', {
  senderIdentityId: uuid('sender_identity_id').notNull()
    .references(() => senderIdentity.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  valueEnc: bytea('value_enc').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  primaryKey({ columns: [t.senderIdentityId, t.key] })
]);

/**
 * A thread with one contact on one of our numbers. Conversation is ALWAYS the scope for
 * message history — the previous system fetched every message a contact had ever sent, which
 * mixed contexts when the same person was worked for two campaigns at once (M31).
 */
export const conversation = pgTable('conversation', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  senderIdentityId: uuid('sender_identity_id').notNull()
    .references(() => senderIdentity.id, { onDelete: 'restrict' }),
  channel: text('channel').notNull().default('whatsapp'),
  status: text('status').notNull().default('open'),
  assigneeUserId: uuid('assignee_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),

  // Meta's 24-hour service window, recomputed on every inbound message. After it closes only
  // approved templates may be sent. Null for Baileys, which has no such window.
  windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),

  unreadCount: integer('unread_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  // One open thread per contact per number. Without this, two inbound messages arriving at
  // once would race and create duplicate threads.
  uniqueIndex('conversation_contact_sender_uidx').on(t.contactId, t.senderIdentityId),
  index('conversation_org_status_idx').on(t.orgId, t.status)
]);

/**
 * An extra person on a conversation, beside its owner (`conversation.assignee_user_id`).
 *
 * A participant may reply and is counted in "mine", but is not the one accountable for the
 * thread. Only an admin adds or removes them. One row per person per thread, enforced by the key.
 */
export const conversationParticipant = pgTable('conversation_participant', {
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  addedByUserId: uuid('added_by_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  index('conversation_participant_user_idx').on(t.userId)
]);

/**
 * Who has a conversation open right now (D-17). A thread open in a browser heartbeats into its
 * row every ~15 s, and anyone seen in the last 30 s counts as viewing. Rows are disposable: a
 * stale one means nothing, and the API sweeps old ones, so nothing here is history.
 */
export const conversationPresence = pgTable('conversation_presence', {
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  // The last moment this person was typing a reply here (D-54). Counts as "typing" for a few
  // seconds only, so a draft left in the box stops looking like activity.
  typingAt: timestamp('typing_at', { withTimezone: true })
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  index('conversation_presence_seen_idx').on(t.seenAt)
]);

/**
 * Whether the background re-encryption of a key rotation (D-31) is running, and what it has done.
 * One row for the whole instance (the key is the instance's, not an org's), so it carries no
 * `org_id` and no row-level security. `paused` is the operator's brake; the gateway checks it
 * before every pass. Counters are for the wizard's progress display only.
 */
export const keyRotationState = pgTable('key_rotation_state', {
  id: integer('id').primaryKey().default(1),
  paused: boolean('paused').notNull().default(false),
  pausedByUserId: uuid('paused_by_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  reencryptedTotal: integer('reencrypted_total').notNull().default(0),
  lastUnreadable: integer('last_unreadable').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * One message, in or out. Bodies are encrypted at rest; `bodyHmac` lets duplicates be detected
 * without decrypting a whole table, which the previous system had to do (M25).
 */
export const message = pgTable('message', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(),

  // WhatsApp's own id for this message. UNIQUE per org, which is what makes delivery
  // idempotent: WhatsApp retries notifications for up to 7 days, and this turns a duplicate
  // into a no-op at the database level — the only place that guarantee survives a race.
  providerMessageId: text('provider_message_id'),

  contentType: text('content_type').notNull().default('text'),
  bodyEnc: bytea('body_enc'),
  bodyHmac: text('body_hmac'),
  status: text('status').notNull().default('queued'),
  errorCode: text('error_code'),
  /**
   * Why a still-`queued` outbound message has not gone out yet (`sender_not_connected`,
   * `quarantined`, `paced:per_minute`, …). Written by the gateway each time it leaves a message
   * waiting and cleared when it sends, so the inbox can say "waiting: reason" instead of silence.
   */
  holdReason: text('hold_reason'),
  /**
   * An admin knowingly sent this to someone flagged do-not-contact (the override is a per-message,
   * audited decision with a reason). The gateway's last-line check refuses to send to a
   * do-not-contact contact unless this is set, so a flag raised after queueing still stops a message.
   */
  dncOverride: boolean('dnc_override').notNull().default(false),
  dncOverrideReason: text('dnc_override_reason'),
  sentBy: text('sent_by').notNull().default('system'),
  sentByUserId: uuid('sent_by_user_id').references(() => appUser.id, { onDelete: 'set null' }),

  // The attachment, when there is one. Null for a text message, and also null for a media
  // message whose bytes were never retrieved — the content type still says `image`, so the
  // inbox can say an attachment exists and could not be fetched rather than showing nothing.
  mediaId: uuid('media_id').references(() => mediaAsset.id, { onDelete: 'set null' }),

  /** Why an inbound file could not be fetched, when it could not (D-30). Null when there was no problem. */
  mediaError: text('media_error'),
  /** When the last fetch attempt failed. */
  mediaFailedAt: timestamp('media_failed_at', { withTimezone: true }),

  /** Which campaign sent this, if any. Null for a reply or a one-off send. */
  campaignId: uuid('campaign_id').references(() => campaign.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true })
}, (t) => [
  uniqueIndex('message_provider_id_uidx').on(t.orgId, t.providerMessageId),
  index('message_conversation_idx').on(t.conversationId, t.createdAt)
]);

/**
 * A team-only note inside a conversation. **Never sent to the contact** — it exists so agents
 * can leave context for each other, and a test asserts a note cannot reach a provider (F3 AC-4).
 * `authorUserId` is nullable so a note survives the author leaving; `mentions` records the user
 * ids @-referenced in the body, captured from the first note so notifications can be built on it
 * later without backfilling.
 */
export const internalNote = pgTable('internal_note', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('internal_note_conversation_idx').on(t.conversationId, t.createdAt)
]);

/**
 * A saved reply an agent can insert. `shortcut` is what they type to find it, unique per org;
 * `body` may hold `{{variable}}` placeholders substituted from the contact when it is used;
 * `locale` lets the same reply exist in more than one language later.
 */
export const cannedReply = pgTable('canned_reply', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  shortcut: text('shortcut').notNull(),
  body: text('body').notNull(),
  locale: text('locale').notNull().default('en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('canned_reply_org_shortcut_uidx').on(t.orgId, t.shortcut)
]);

/**
 * A timeline entry about a number's health: a suspected restriction raised or cleared, a possible
 * hard ban, a recovery started. The detector writes one on every state change, so an operator can
 * read what happened to a number (and when) instead of only seeing today's score.
 */
export const senderHealthEvent = pgTable('sender_health_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  senderIdentityId: uuid('sender_identity_id').notNull()
    .references(() => senderIdentity.id, { onDelete: 'cascade' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  /** `restriction_suspected`, `restriction_likely`, `restriction_cleared`, `hard_ban_suspected`, … */
  kind: text('kind').notNull(),
  /** `info` | `warning` | `critical`. */
  severity: text('severity').notNull().default('info'),
  /** One plain sentence an operator can act on. */
  summary: text('summary').notNull(),
  /** The numbers behind the decision, so it can be audited rather than trusted. */
  evidence: jsonb('evidence').notNull().default({})
}, (t) => [
  index('sender_health_event_sender_idx').on(t.senderIdentityId, t.at)
]);

/**
 * A field an org has defined for its contacts — `city`, `experience_years`, `stage`. The fixed
 * vocabulary that gives `contact.custom_fields` a shape: only defined keys may be set, values are
 * checked against `type`, and the same name means the same thing everywhere (UI, imports, `{{key}}`
 * in a campaign). `type` is `text`, `number`, `date` (YYYY-MM-DD) or `select` (one of `options`).
 */
export const customField = pgTable('custom_field', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  /** Lower-case slug, the key stored in `custom_fields` and used as `{{key}}`. */
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: text('type').notNull().default('text'),
  options: text('options').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('custom_field_org_key_uidx').on(t.orgId, t.key)
]);

/**
 * A flat label on a contact — `vip`, `pune`, `interviewed`. No hierarchy, no nesting; a contact
 * can carry many (the join is `contact_tag`). `name` is unique per org, so "pune" is one tag.
 */
export const tag = pgTable('tag', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // A UI-only colour for the chip. Nothing depends on it.
  colour: text('colour'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('tag_org_name_uidx').on(t.orgId, t.name)
]);

/**
 * The many-to-many join between a contact and a tag. Carries `org_id` like every tenant table so
 * row-level security scopes it directly; the composite primary key `(contact_id, tag_id)` makes
 * applying the same tag to the same contact twice a no-op rather than a duplicate.
 */
export const contactTag = pgTable('contact_tag', {
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tag.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  primaryKey({ columns: [t.contactId, t.tagId] }),
  index('contact_tag_tag_idx').on(t.tagId)
]);

/**
 * A saved, criteria-based audience — the dynamic segment (docs/21-deferred.md D-28). Unlike a tag
 * (a static named list), a segment stores a *filter* in `definition` that re-evaluates against
 * current data every time it is used. A campaign targeting a segment resolves and **freezes** it at
 * launch, like every other audience, so a running campaign never shifts.
 *
 * `definition` is a small allowlisted shape (has-tag, replied ever/never, last-contacted-within-N-
 * days), never free SQL — the filter engine in `@crm/core` maps each key to a pre-written, bound
 * fragment, so a stored definition can never inject (docs/21-deferred.md D-28).
 */
export const segment = pgTable('segment', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** `dynamic` for a re-evaluating filter. A future `static` kind (a frozen list) would live here too. */
  kind: text('kind').notNull().default('dynamic'),
  /** The allowlisted filter criteria. Interpreted only by the engine, never turned into raw SQL. */
  definition: jsonb('definition').notNull().default({}),
  /**
   * False for the one-off filter built inline while creating a campaign and not kept for reuse. The
   * campaign still targets it (so the audience is frozen the same way), but it does not clutter the
   * list of saved audiences.
   */
  saved: boolean('saved').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('segment_org_name_uidx').on(t.orgId, t.name)
]);

/**
 * One stored attachment.
 *
 * Separate from `message` rather than columns on it because the same file can arrive twice —
 * `sha256` is what makes that detectable — and because retention and erasure operate on files
 * as their own population, on a different clock from the messages that reference them.
 *
 * **`storage_key` is provider-neutral and unguessable.** Row-level security protects this row;
 * it does not reach the bytes, which live on a filesystem Postgres cannot see. So a guessable
 * key would turn one missed authorisation check into a public bucket (docs/21-deferred.md,
 * D-11). `mediaKey()` in `@crm/storage` is the only thing that builds one.
 */
export const mediaAsset = pgTable('media_asset', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),

  storageKey: text('storage_key').notNull(),
  // Which backend holds it. Recorded rather than inferred from config, so a deployment that
  // migrates from a directory to a bucket can tell which files have actually moved.
  storageDriver: text('storage_driver').notNull(),

  // Determined from MAGIC BYTES, never from the filename the sender chose. Serving a file as
  // the type its name claims is how an HTML attachment becomes stored XSS (docs/09-security.md).
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  // Hex sha256 of the stored bytes. Deduplication, and the only way to tell after the fact
  // that what is on disk is what arrived.
  sha256: text('sha256').notNull(),

  // What the sender called it, sanitised. For display and for the download filename only —
  // never for deciding a content type.
  filename: text('filename'),

  // When an antivirus pass last ran. Null means never scanned; no scanner exists yet (D-11).
  scannedAt: timestamp('scanned_at', { withTimezone: true }),

  /** True for a picture or GIF uploaded for campaigns: it can be picked again and previewed without belonging to a message. */
  campaignPicture: boolean('campaign_picture').notNull().default(false),
  /** True for the MP4 a GIF was converted into: WhatsApp shows a GIF as a looping silent clip, so it is sent as a video with GIF playback. */
  gifPlayback: boolean('gif_playback').notNull().default(false),
  /** For a converted clip, the GIF it came from (kept for the preview). */
  sourceAssetId: uuid('source_asset_id').references((): AnyPgColumn => mediaAsset.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('media_asset_key_uidx').on(t.storageKey),
  index('media_asset_digest_idx').on(t.orgId, t.sha256)
]);

/**
 * One attempt to import a file.
 *
 * The row exists from the moment bytes are stored, before anything is parsed, so a run that
 * dies halfway is still a row somebody can look at rather than a silence.
 *
 * **`sha256` is unique per org, and that is the point.** The same spreadsheet must not import
 * twice however it is named — `contacts.xlsx`, `contacts (1).xlsx` and `contacts-FINAL.xlsx`
 * are one file, and a filename answers nothing (docs/07-ingestion.md). Scoped per org because
 * cross-tenant dedup would leak the existence of one tenant's file into another's.
 */
export const importRun = pgTable('import_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),

  sourceType: text('source_type').notNull().default('csv'),
  /** What the uploader called it. Display only — it decides nothing, including identity. */
  filename: text('filename'),
  storageKey: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),

  /** `uploaded` → `dry_run` → `committed`, or `failed`. A run always reaches one of them. */
  status: text('status').notNull().default('uploaded'),
  rowCount: integer('row_count').notNull().default(0),
  /** Column names as found in the file, so a mapping UI is built from fact, not guesswork. */
  headers: jsonb('headers'),
  /** The mapping this run was executed with. Kept so a result can be explained later. */
  mapping: jsonb('mapping'),
  /** Counts by outcome. Denormalised because the answer is wanted far more often than the rows. */
  summary: jsonb('summary'),

  /**
   * Set when a deliberate re-import replaces this run.
   *
   * Exists so the uniqueness below can be **partial**. Without it the constraint and the
   * `?force=true` escape hatch contradict each other: the database would refuse the second
   * upload that the API had just decided to allow. With it, the invariant is the one actually
   * wanted — *at most one live run per file per org* — and a re-import is an explicit act that
   * supersedes the old run rather than an exception to the rule.
   */
  supersededAt: timestamp('superseded_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (t) => [
  uniqueIndex('import_run_digest_uidx').on(t.orgId, t.sha256)
    .where(sql`superseded_at IS NULL`),
  index('import_run_org_idx').on(t.orgId, t.createdAt)
]);

/**
 * What happened to one row of one file.
 *
 * Every row gets one, including the ones that worked. A run **always completes** — a bad row
 * is recorded and the run carries on, because a single unparseable phone number aborting a
 * 50,000-row import is the behaviour this replaces (M4).
 *
 * `UNIQUE (import_run_id, row_number)` is what makes a killed worker resumable from the last
 * committed batch instead of restartable from zero.
 */
export const importRowRecord = pgTable('import_row', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  importRunId: uuid('import_run_id').notNull()
    .references(() => importRun.id, { onDelete: 'cascade' }),

  /** 1-based, counting data rows — the header is not row 1. Matches what a spreadsheet shows. */
  rowNumber: integer('row_number').notNull(),
  /** `created` · `updated` · `skipped` · `error`. */
  outcome: text('outcome').notNull(),
  contactId: uuid('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  /**
   * Why it failed, in words a person can act on, when outcome is `error`. On a successful row it
   * can hold a softer note (a second phone number that was not valid and was left out).
   */
  error: text('error'),
  /**
   * The row as read, so a failure can be inspected and re-uploaded without the original file.
   * Kept per row rather than in a parallel unbounded table, which is what grew without limit
   * in the system this replaces.
   */
  raw: jsonb('raw')
}, (t) => [
  uniqueIndex('import_row_number_uidx').on(t.importRunId, t.rowNumber),
  index('import_row_outcome_idx').on(t.importRunId, t.outcome)
]);

/**
 * A bulk send.
 *
 * **The audience is always stated, never implied.** There is no "everyone" — a campaign names
 * either an import run or an explicit list of contacts, because a campaign that silently grows
 * when a contact is added is a campaign nobody can predict the cost or risk of.
 */
export const campaign = pgTable('campaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),

  /** `draft` → `running` ⇄ `paused` → `completed`, or `cancelled`. */
  status: text('status').notNull().default('draft'),

  /** The AI template replies to this campaign follow (D-85), or none. Set when the campaign is made from a template. */
  aiTemplateId: uuid('ai_template_id').references((): AnyPgColumn => aiTemplate.id, { onDelete: 'set null' }),

  /** One picture or GIF sent with every message of this campaign, the message text being its caption; or none (text only). */
  mediaAssetId: uuid('media_asset_id').references((): AnyPgColumn => mediaAsset.id, { onDelete: 'set null' }),

  /**
   * What to send. Plain text for now — `message_template` and its approval flow do not exist
   * yet, and a campaign that cannot say anything is not worth having in the meantime.
   */
  body: text('body').notNull(),
  /** Which number it sends from. One for now; `sender_pool` weighting is a later concern. */
  senderIdentityId: uuid('sender_identity_id').notNull()
    .references(() => senderIdentity.id, { onDelete: 'restrict' }),

  /** The audience, stated one of three ways. Exactly one is set. */
  fromImportRunId: uuid('from_import_run_id').references(() => importRun.id, { onDelete: 'set null' }),
  explicitContactIds: jsonb('explicit_contact_ids'),
  /**
   * A tag whose contacts are the audience — resolved at snapshot like an import run, so adding a
   * contact to the tag after launch never changes who a running campaign is messaging. Nulled if
   * the tag is later deleted; the frozen `campaign_recipient` rows are unaffected.
   */
  fromTagId: uuid('from_tag_id').references(() => tag.id, { onDelete: 'set null' }),
  /**
   * A dynamic segment whose filter resolves to the audience — evaluated and frozen at snapshot, so
   * later data changes never move a running campaign. Nulled if the segment is deleted.
   */
  fromSegmentId: uuid('from_segment_id').references(() => segment.id, { onDelete: 'set null' }),

  /**
   * Recipient-experience gates an admin has knowingly lifted for this campaign: any of
   * `engagement`, `cooldown`, `duplicate_campaign` (docs/08-antiban.md, "two classes of gate").
   * Set only by an admin, with a reason, and audited. Never covers the number-protecting gates.
   */
  gateOverrides: text('gate_overrides').array().notNull().default(sql`'{}'::text[]`),
  gateOverrideReason: text('gate_override_reason'),
  /** Why a campaign was paused by the system rather than a person (e.g. `restriction_suspected`). */
  pauseReason: text('pause_reason'),

  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('campaign_org_status_idx').on(t.orgId, t.status)
]);

/**
 * One person in one campaign, and what became of them.
 *
 * **Snapshotted when the campaign starts**, so an import that grows afterwards cannot change
 * who is being messaged mid-run.
 *
 * These rows are also the queue. A campaign does NOT create fifty thousand queued messages at
 * launch — the dispatcher turns recipients into messages only as fast as the anti-ban ceiling
 * allows. That is what makes pausing instant, keeps a campaign from burying an agent's reply
 * in the send queue, and stops the pacing gate re-evaluating fifty thousand rows every sweep.
 */
export const campaignRecipient = pgTable('campaign_recipient', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').notNull()
    .references(() => campaign.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),

  /** `pending` → `queued` → `sent`, or `failed` / `skipped`. */
  status: text('status').notNull().default('pending'),
  /**
   * Why this person was not messaged: `no_phone`, `duplicate`, `cancelled`.
   * **A blocked recipient is reported, never silently dropped** — silent dropping is how an
   * operator stops trusting the numbers.
   */
  skipReason: text('skip_reason'),
  messageId: uuid('message_id').references(() => message.id, { onDelete: 'set null' }),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }),
  /** For a campaign with an AI template: this person's opening message as the AI wrote it (encrypted like any message body). */
  openingEnc: bytea('opening_enc'),
  /** How many times the AI has tried to write this opening and failed; after three the recipient is skipped and reported. */
  openingTries: integer('opening_tries').notNull().default(0)
}, (t) => [
  // One row per person per campaign. Also what makes a re-run idempotent.
  uniqueIndex('campaign_recipient_uidx').on(t.campaignId, t.contactId),
  index('campaign_recipient_pending_idx').on(t.campaignId, t.status)
]);

/**
 * The AI assistant's settings, one row per org (F12). Absent or `enabled = false` means the assistant does
 * nothing and no part of the product mentions it. It can only be switched on after an admin accepts the
 * consent note, because contact messages are sent to the model provider.
 */
export const aiSetting = pgTable('ai_setting', {
  orgId: uuid('org_id').primaryKey().references(() => org.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  /** What the assistant may talk about and how: the org's own instructions, never customer text. */
  instructions: text('instructions').notNull().default(''),
  /** The most messages the assistant may queue in a day for this org; a cost and safety ceiling. */
  dailyMessageCap: integer('daily_message_cap').notNull().default(200),
  /** Off by default: the assistant may prepare a campaign, but an admin presses Start. On = it may start (and resume) one itself. */
  mayStartCampaigns: boolean('may_start_campaigns').notNull().default(false),
  consentAcceptedAt: timestamp('consent_accepted_at', { withTimezone: true }),
  consentAcceptedBy: uuid('consent_accepted_by').references(() => appUser.id, { onDelete: 'set null' }),
  /** The assistant's own user, created the first time it is enabled. */
  botUserId: uuid('bot_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * A saved AI template: what an owner described in plain words, and the instructions the AI wrote from it, kept together so it
 * can be picked again. The locked always-on rules are NOT stored here; they are added in front of the instructions every time the
 * assistant replies (see `AI_ALWAYS_ON_RULES`), so editing a template can never switch them off.
 */
export const aiTemplate = pgTable('ai_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** What the owner typed or pasted. */
  description: text('description').notNull().default(''),
  /** The instructions for the AI (bullet points), written by the model and possibly edited by hand. */
  instructions: text('instructions').notNull(),
  /** Who the first message is for, in words (a suggestion; the audience itself is always a tag). */
  audience: text('audience').notNull().default(''),
  /** A draft of the opening message. */
  firstMessage: text('first_message').notNull().default(''),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  useCount: integer('use_count').notNull().default(0)
}, (t) => [
  index('ai_template_org_used_idx').on(t.orgId, t.lastUsedAt)
]);

/**
 * One thing the assistant did or tried to do: a reply, a campaign action, or a send it was stopped from
 * making. Answers "what did the AI do, with which model, at what cost, and why was it held back?" (F12 AC-5).
 */
export const aiRun = pgTable('ai_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversation.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').references(() => campaign.id, { onDelete: 'set null' }),
  /** `reply`, `campaign_action`, ... */
  kind: text('kind').notNull(),
  /** `sent`, `blocked`, `failed`, `skipped`. */
  outcome: text('outcome').notNull(),
  /** Why it was held back, e.g. an anti-ban gate name, `daily_cap`, or `model_error`. Null when it went through. */
  reason: text('reason'),
  model: text('model'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('ai_run_org_created_idx').on(t.orgId, t.createdAt),
  index('ai_run_conversation_idx').on(t.conversationId)
]);

/**
 * A request waiting for, or having had, the AI assistant's attention: an instruction typed into the command box, or a
 * "write the campaign wording" request. They run one at a time per org, oldest first, so a slow or rate-limited model
 * never gets several at once, and the queue can be shown: who is waiting, what is running, what finished.
 * Only a `queued` job can be cancelled; once it is `running` it is allowed to finish. Finished jobs are pruned after a day.
 */
export const aiJob = pgTable('ai_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  /** `command` (carry out an instruction) or `draft` (write campaign wording). */
  kind: text('kind').notNull(),
  /** The instruction, or the goal for the wording. */
  input: text('input').notNull(),
  requestedBy: uuid('requested_by').references(() => appUser.id, { onDelete: 'set null' }),
  /** `queued` -> `running` -> `done` or `failed`; or `cancelled` straight from `queued`. */
  status: text('status').notNull().default('queued'),
  /** What came out: the assistant's message and actions, or the written wording. Null until done. */
  result: jsonb('result'),
  /** Why it failed, in words a person can read. */
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true })
}, (t) => [
  index('ai_job_org_created_idx').on(t.orgId, t.createdAt),
  index('ai_job_org_status_idx').on(t.orgId, t.status)
]);
