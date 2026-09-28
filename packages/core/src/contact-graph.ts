import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/**
 * Contact-graph gates — P6 anti-ban, the relationship layer (docs/08-antiban.md).
 *
 * Messaging strangers who have never interacted with you is, by WhatsApp's own detection, one of
 * the two strongest ban signals ("contact-graph distance"). Layers 1–2 cap total volume and
 * circadian pacing shapes the time of day; this gates by *who* the message is going to, keyed on
 * the sender↔contact history the `message` table already holds. Two mechanisms:
 *
 * 1. A **relationship delay multiplier** — a send to someone who has replied goes at full speed;
 *    a send to a stranger waits longer, so cold outreach is paced more cautiously than a live
 *    conversation.
 * 2. A **new-contact throttle** — a hard cap on how many brand-new strangers one number may
 *    *start* messaging per hour and per day. Blasting a fresh list is exactly the pattern that
 *    gets a number banned, and no per-minute rate limit stops it on its own.
 *
 * Opt-in, like circadian pacing: with no `ContactGraphLimits` the send path behaves as layers
 * 1–2 alone, so every test that is not about this layer is unaffected.
 */

/** Where a contact sits relative to this sender, strongest relationship first. */
export type Relationship = 'known' | 'contacted' | 'stranger';

/** The caps on starting conversations with people this sender has never messaged. */
export interface ContactGraphLimits {
  readonly newContactsPerHour: number;
  readonly newContactsPerDay: number;
}

/** Whether a send may proceed on relationship grounds, and how much to slow it if so. */
export type ContactGraphDecision =
  | {
      readonly allowed: true;
      readonly relationship: Relationship;
      /** Multiplies the base inter-send pause: 1.0 for a reply, up to 2.5 for a stranger. */
      readonly delayMultiplier: number;
    }
  | {
      readonly allowed: false;
      readonly reason: 'new_contact_throttle';
      readonly detail: string;
      readonly retryAfterMs: number;
    };

/**
 * Classifies the sender↔contact relationship from what has actually been exchanged.
 *
 * `known` — they have sent us at least one message: a real two-way thread, the safest to message.
 * `contacted` — we have messaged them but they have never replied ("handshake sent", still risky).
 * `stranger` — no message has ever passed either way: cold, and the most ban-relevant of all.
 *
 * The spec's `handshake complete` (1.3×) tier folds into `known` here: a single reply is what
 * makes a conversation real, so the first-slice model is the three states the data cleanly
 * supports rather than a fourth we cannot yet distinguish.
 */
export function classifyRelationship(hasInbound: boolean, hasPriorOutbound: boolean): Relationship {
  if (hasInbound) return 'known';
  if (hasPriorOutbound) return 'contacted';
  return 'stranger';
}

/**
 * How much to stretch the inter-send pause for a relationship. A reply earns full speed; a
 * stranger waits 2.5× as long. From the multiplier table in docs/08-antiban.md.
 */
export function relationshipDelayMultiplier(relationship: Relationship): number {
  switch (relationship) {
    case 'known': return 1.0;
    case 'contacted': return 1.8;
    case 'stranger': return 2.5;
  }
}

/**
 * Decides whether this send may go to this contact right now, on relationship grounds.
 *
 * A stranger send is refused once the number has already started too many new conversations in
 * the window — that is the throttle that actually caps cold outreach. Known and already-contacted
 * recipients are never throttled here (you are continuing a conversation, not starting one); they
 * only get a gentler or steeper delay multiplier. Counts come from the `message` table, so they
 * survive a restart exactly like the layer 1–2 counts do.
 */
export async function checkContactGraph(
  db: Database, senderIdentityId: string, contactId: string,
  limits: ContactGraphLimits, now: Date = new Date()
): Promise<ContactGraphDecision> {
  const at = now.toISOString();
  const rows = await db.execute(sql`
    WITH firsts AS (
      -- The first time this sender messaged each contact. A "new contact" is one whose first
      -- outbound falls inside the window, so continuing an old conversation never counts.
      SELECT v.contact_id, min(m.sent_at) AS first_out
      FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.sender_identity_id = ${senderIdentityId}
        AND m.direction = 'outbound' AND m.sent_at IS NOT NULL
      GROUP BY v.contact_id
    ),
    counts AS (
      SELECT
        count(*) FILTER (WHERE first_out > ${at}::timestamptz - interval '1 hour')::int AS "newLastHour",
        count(*) FILTER (WHERE first_out > ${at}::timestamptz - interval '1 day')::int  AS "newLastDay"
      FROM firsts
    )
    SELECT
      EXISTS (
        SELECT 1 FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.sender_identity_id = ${senderIdentityId} AND v.contact_id = ${contactId}
          AND m.direction = 'inbound'
      ) AS "hasInbound",
      EXISTS (
        SELECT 1 FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.sender_identity_id = ${senderIdentityId} AND v.contact_id = ${contactId}
          AND m.direction = 'outbound' AND m.sent_at IS NOT NULL
      ) AS "hasPriorOutbound",
      counts."newLastHour", counts."newLastDay"
    FROM counts`);

  const row = (rows as unknown as Array<{
    hasInbound: boolean; hasPriorOutbound: boolean; newLastHour: number; newLastDay: number;
  }>)[0]!;

  const relationship = classifyRelationship(row.hasInbound, row.hasPriorOutbound);

  // Only a stranger send starts a new conversation, so only it is throttled. Day before hour, so
  // the message names the ceiling that will free up last.
  if (relationship === 'stranger') {
    if (row.newLastDay >= limits.newContactsPerDay) {
      return {
        allowed: false, reason: 'new_contact_throttle',
        detail: `new-contact daily cap reached: ${String(row.newLastDay)} of ${String(limits.newContactsPerDay)}`,
        retryAfterMs: 60 * 60 * 1000
      };
    }
    if (row.newLastHour >= limits.newContactsPerHour) {
      return {
        allowed: false, reason: 'new_contact_throttle',
        detail: `new-contact hourly cap reached: ${String(row.newLastHour)} of ${String(limits.newContactsPerHour)}`,
        retryAfterMs: 15 * 60 * 1000
      };
    }
  }

  return {
    allowed: true, relationship,
    delayMultiplier: relationshipDelayMultiplier(relationship)
  };
}
