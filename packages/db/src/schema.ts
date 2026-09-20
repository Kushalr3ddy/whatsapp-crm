import {
  boolean, customType, index, integer, jsonb, pgTable, primaryKey,
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

  // The linking handshake. The API cannot call the provider directly — the gateway owns the
  // socket in a separate process — so a link request is left here and the challenge WhatsApp
  // issues is written back for the API to serve.
  linkRequestedMode: text('link_requested_mode'),
  linkRequestedPhone: text('link_requested_phone'),
  linkRequestedAt: timestamp('link_requested_at', { withTimezone: true }),
  linkChallenge: jsonb('link_challenge'),
  linkError: text('link_error'),
  qrExpiresAt: timestamp('qr_expires_at', { withTimezone: true }),
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
  sentBy: text('sent_by').notNull().default('system'),
  sentByUserId: uuid('sent_by_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true })
}, (t) => [
  uniqueIndex('message_provider_id_uidx').on(t.orgId, t.providerMessageId),
  index('message_conversation_idx').on(t.conversationId, t.createdAt)
]);
