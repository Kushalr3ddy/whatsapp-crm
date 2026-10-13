/**
 * One plain-English line per table, and the group it belongs to, for the schema visualizer
 * (`npm run db:docs`). Kept next to the schema so a new table cannot ship without saying what
 * it is for: `tests/integration/table-notes.test.ts` fails when a table has no note, or a
 * note names a table that no longer exists.
 */
export interface TableNote {
  /** The area of the product the table belongs to; the visualizer groups and colours by it. */
  group: string;
  /** What the table holds and why it exists, in a sentence a non-engineer can read. */
  purpose: string;
}

/** Notes keyed by table name. */
export const TABLE_NOTES: Record<string, TableNote> = {
  org: {
    group: 'Workspaces and people',
    purpose: 'A customer workspace. Every other table points back to one org, and row-level security keeps each org’s rows invisible to the rest.'
  },
  app_user: {
    group: 'Workspaces and people',
    purpose: 'A person who can sign in: name, email, password hash. Belongs to an org through org_membership, not directly.'
  },
  org_membership: {
    group: 'Workspaces and people',
    purpose: 'Links a person to an org and gives them a role (admin or agent). Roles live here so one person could join several orgs later.'
  },
  session: {
    group: 'Workspaces and people',
    purpose: 'A signed-in browser session for the web app. Looked up before the org is known, so it has no row-level security.'
  },
  api_key: {
    group: 'Workspaces and people',
    purpose: 'Machine access for integrations such as JobPortal: a hashed secret plus the scopes it may use. Also looked up before the org is known.'
  },
  audit_log: {
    group: 'Audit and health',
    purpose: 'Append-only record of who did what and when: sign-ins, reassignments, overrides, exports. The app role cannot update or delete rows.'
  },
  contact: {
    group: 'Contacts',
    purpose: 'A person you talk to: display name, custom fields, source and a do-not-contact flag. Phone numbers and emails live in contact_identity, not here.'
  },
  contact_identity: {
    group: 'Contacts',
    purpose: 'One way to reach or recognise a contact: a phone number, an email, or a WhatsApp privacy address. A contact can have several.'
  },
  tag: {
    group: 'Contacts',
    purpose: 'A label such as "pune" or "interview-stage". Unique per org by name.'
  },
  contact_tag: {
    group: 'Contacts',
    purpose: 'Which contacts carry which tags. One row per contact and tag.'
  },
  custom_field: {
    group: 'Contacts',
    purpose: 'The vocabulary of extra fields an org has defined for contacts (city, experience…), with a type, so values are checked and {{city}} works in campaigns.'
  },
  segment: {
    group: 'Contacts',
    purpose: 'A saved audience: a stored filter whose matching people are recomputed whenever it is used.'
  },
  conversation: {
    group: 'Inbox',
    purpose: 'One chat thread between one contact and one of your numbers. Holds the owner, open/closed status, unread count and timing.'
  },
  message: {
    group: 'Inbox',
    purpose: 'One message in or out of a thread: encrypted body, delivery status, who sent it, optional attachment and campaign. Inserting an outbound queued row wakes the gateway.'
  },
  media_asset: {
    group: 'Inbox',
    purpose: 'An attachment file: its type (decided from the file’s bytes), size and storage key. The bytes live in the storage driver, not the database.'
  },
  internal_note: {
    group: 'Inbox',
    purpose: 'A team-only note on a thread. Kept apart from message so a note can never be sent to the customer.'
  },
  canned_reply: {
    group: 'Inbox',
    purpose: 'A saved reply an agent can insert with a shortcut, with {{name}}-style placeholders.'
  },
  conversation_participant: {
    group: 'Inbox',
    purpose: 'Extra people on a chat beside its owner. Participants may reply; only admins add or remove them.'
  },
  conversation_presence: {
    group: 'Inbox',
    purpose: 'Who has a chat open right now, refreshed by a heartbeat every few seconds. Throwaway rows, never history.'
  },
  campaign: {
    group: 'Campaigns',
    purpose: 'A bulk send: the message, the number it goes from, its audience, its state (draft, running, paused…) and pacing results.'
  },
  campaign_recipient: {
    group: 'Campaigns',
    purpose: 'One person in a campaign. Acts as the queue: the gateway turns recipients into messages only as fast as the anti-ban limits allow, and records why anyone was skipped.'
  },
  import_run: {
    group: 'Import',
    purpose: 'One uploaded spreadsheet and what became of it: file hash (to refuse duplicates), counts, and whether it was committed or superseded.'
  },
  import_row: {
    group: 'Import',
    purpose: 'The ledger for one row of an upload: what it said, what the dry run decided, and which contact it produced.'
  },
  sender_identity: {
    group: 'WhatsApp numbers',
    purpose: 'One of your WhatsApp numbers and its reputation: warm-up stage, health score, risk band, restriction state and recovery pauses.'
  },
  channel_session: {
    group: 'WhatsApp numbers',
    purpose: 'The live connection state of a number (connected, QR waiting, unlink requested). Churns constantly; three triggers here wake the gateway.'
  },
  channel_auth_state: {
    group: 'WhatsApp numbers',
    purpose: 'The encrypted login credentials Baileys needs to keep a number linked across restarts. Losing the encryption key loses these.'
  },
  key_rotation_state: {
    group: 'Audit and health',
    purpose: 'One row for the whole install: whether the background re-encryption of a key rotation is paused, and how much it has moved. Not per org, because the encryption key is not.'
  },
  sender_health_event: {
    group: 'Audit and health',
    purpose: 'A timeline of what happened to a number’s health: restriction suspected or cleared, possible ban, recovery started.'
  }
};
