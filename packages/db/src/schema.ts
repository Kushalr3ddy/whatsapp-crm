import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
 * A person the org talks to. Deliberately carries no domain fields — no candidate, no
 * customer, no patient. Anything business-specific lives in `customFields`, and anything
 * owned by another system is referenced through `externalRef` (docs/01-vision-scope.md).
 */
export const contact = pgTable('contact', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  ownerUserId: uuid('owner_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  customFields: text('custom_fields').notNull().default('{}'),
  externalRef: text('external_ref'),
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
