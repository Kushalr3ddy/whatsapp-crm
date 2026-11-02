import { sql } from 'drizzle-orm';
import type { Transaction } from '@crm/db';

/**
 * The recipient-experience gates.
 *
 * These protect the *person's* experience, which is why an admin may lift them, knowingly, per campaign, with a reason and an audit row:
 *
 *  - **dnc**: the contact is flagged do-not-contact. Unlike the others this protects the person, not the
 *    number, so it is the one an admin should think hardest about lifting — but it is liftable (Kushal,
 *    2026-10-09), per campaign, with a reason, audited;
 *  - **engagement**: another agent owns a live conversation with this person right now, and a
 *    broadcast landing in the middle of it is rude and confusing;
 *  - **cooldown**: this person was already sent a *campaign* message recently — repeating a
 *    broadcast at the same people is what gets a number reported;
 *  - **duplicate_campaign**: they are already waiting in another live campaign.
 *
 * A blocked recipient is **skipped with a reason, never silently dropped**, so it shows in the
 * campaign's results.
 */
export const POLICY_GATES = ['dnc', 'engagement', 'cooldown', 'duplicate_campaign'] as const;
/** One of the three overridable recipient-experience gates. */
export type PolicyGate = (typeof POLICY_GATES)[number];

/** `skip_reason` written for each gate. */
export const POLICY_SKIP_REASON: Record<PolicyGate, string> = {
  dnc: 'dnc',
  engagement: 'engaged',
  cooldown: 'cooldown',
  duplicate_campaign: 'in_other_campaign'
};

/** A conversation counts as live if it has an owner and traffic within this long. */
export const ENGAGEMENT_WINDOW_HOURS = 48;
/** Days before the same person may be sent another campaign message. */
export const COOLDOWN_DAYS = 14;

/** Narrows an arbitrary string to a known gate name. */
export function isPolicyGate(value: string): value is PolicyGate {
  return (POLICY_GATES as readonly string[]).includes(value);
}

/**
 * The first policy gate that blocks this contact for this campaign, or null if none does.
 * Gates the admin has overridden are not evaluated at all.
 */
export async function blockingPolicyGate(
  tx: Transaction,
  input: {
    orgId: string; campaignId: string; contactId: string;
    overrides: readonly string[];
  }
): Promise<PolicyGate | null> {
  const on = (g: PolicyGate): boolean => !input.overrides.includes(g);
  const { orgId, campaignId, contactId } = input;

  if (on('dnc')) {
    const r = await tx.execute(sql`
      SELECT 1 FROM contact WHERE id = ${contactId} AND org_id = ${orgId} AND do_not_contact`);
    if ((r as unknown as unknown[]).length > 0) return 'dnc';
  }

  if (on('engagement')) {
    const r = await tx.execute(sql`
      SELECT 1 FROM conversation
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND assignee_user_id IS NOT NULL
        AND greatest(coalesce(last_inbound_at, 'epoch'), coalesce(last_outbound_at, 'epoch'))
            > now() - make_interval(hours => ${ENGAGEMENT_WINDOW_HOURS})
      LIMIT 1`);
    if ((r as unknown as unknown[]).length > 0) return 'engagement';
  }

  if (on('cooldown')) {
    const r = await tx.execute(sql`
      SELECT 1 FROM message m JOIN conversation v ON v.id = m.conversation_id
      WHERE v.org_id = ${orgId} AND v.contact_id = ${contactId}
        AND m.direction = 'outbound' AND m.campaign_id IS NOT NULL
        AND m.campaign_id <> ${campaignId} AND m.status <> 'failed'
        AND m.created_at > now() - make_interval(days => ${COOLDOWN_DAYS})
      LIMIT 1`);
    if ((r as unknown as unknown[]).length > 0) return 'cooldown';
  }

  if (on('duplicate_campaign')) {
    const r = await tx.execute(sql`
      SELECT 1 FROM campaign_recipient cr JOIN campaign cp ON cp.id = cr.campaign_id
      WHERE cr.org_id = ${orgId} AND cr.contact_id = ${contactId}
        AND cr.campaign_id <> ${campaignId} AND cr.status IN ('pending', 'queued')
        AND cp.status IN ('running', 'paused')
      LIMIT 1`);
    if ((r as unknown as unknown[]).length > 0) return 'duplicate_campaign';
  }
  return null;
}
