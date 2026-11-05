import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { writeAudit, SYSTEM_ACTOR, AUDIT } from '@crm/core';
import type { ChannelProvider, SenderRef } from '@crm/channels';
import type { Logger } from '@crm/shared';

/** How long a "has an account" answer is trusted before it is asked again. Accounts rarely vanish. */
const REGISTERED_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a "no account" answer is trusted. Shorter: a number can be taken up by someone later. */
const UNREGISTERED_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/** What to do about the number a message is about to be sent to. */
export type NumberChoice =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'switched'; readonly phone: string }
  | { readonly kind: 'none' };

/** One phone number of a contact, with what is known about whether it has a WhatsApp account. */
interface PhoneRow {
  readonly id: string;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly waRegistered: boolean | null;
  readonly waCheckedAt: string | null;
}

/**
 * Picks the number to message for a contact that has more than one (D-60).
 *
 * Numbers are tried in order, primary first. For each, a known and fresh answer is used; otherwise
 * WhatsApp is asked, **once, for that number**, and the answer is stored so it is not asked again for
 * 30 days (7 if it said no). The first number with an account wins; if it is not the primary it is
 * promoted to primary, so later messages go straight there. If none has an account the message is not
 * sent (`none`), instead of being sent to a number that cannot receive it and costing the number its
 * delivery ratio.
 *
 * What it deliberately does not do:
 * - **Nothing for a contact with one number.** There is nothing to fall back to, so no lookup is made.
 * - **Never acts on "could not tell".** If the transport cannot answer (socket closed, query failed),
 *   the primary number is used as before; a failed lookup must not switch anyone's number.
 * - **No bulk lookups.** It runs inside the send path, after the anti-ban policy and its pause,
 *   so lookups are as spaced out as sends are.
 */
export async function chooseRecipientNumber(
  ctx: { readonly db: Database; readonly provider: ChannelProvider; readonly logger: Logger },
  job: { readonly orgId: string; readonly contactId: string; readonly messageId: string;
         readonly recipientKind: string; readonly recipientValue: string },
  sender: SenderRef
): Promise<NumberChoice> {
  if (job.recipientKind !== 'phone' || !ctx.provider.isRegistered) return { kind: 'unchanged' };

  const rows = await ctx.db.execute(sql`
    SELECT id, value_normalized AS value, is_primary AS "isPrimary",
           wa_registered AS "waRegistered", wa_checked_at AS "waCheckedAt"
    FROM contact_identity
    WHERE contact_id = ${job.contactId} AND kind = 'phone'
    ORDER BY is_primary DESC, created_at ASC`);
  const numbers = rows as unknown as PhoneRow[];
  if (numbers.length < 2) return { kind: 'unchanged' };

  const now = Date.now();
  for (const n of numbers) {
    let registered = n.waRegistered;
    const age = n.waCheckedAt === null ? Infinity : now - new Date(n.waCheckedAt).getTime();
    const fresh = registered !== null && age < (registered ? REGISTERED_FRESH_MS : UNREGISTERED_FRESH_MS);

    if (!fresh) {
      let answer: boolean | null;
      try {
        answer = await ctx.provider.isRegistered(sender, n.value);
      } catch (error) {
        ctx.logger.warn({ messageId: job.messageId, err: String(error) }, 'registration lookup failed; using the current number');
        return { kind: 'unchanged' };
      }
      if (answer === null) return { kind: 'unchanged' };
      registered = answer;
      await ctx.db.execute(sql`
        UPDATE contact_identity SET wa_registered = ${answer}, wa_checked_at = now() WHERE id = ${n.id}`);
    }

    if (!registered) continue;
    if (n.value === job.recipientValue) return { kind: 'unchanged' };

    // A later number has an account and the one we were about to use does not: make it the primary.
    await ctx.db.execute(sql`
      UPDATE contact_identity SET is_primary = (id = ${n.id})
      WHERE contact_id = ${job.contactId} AND kind = 'phone'`);
    await writeAudit(ctx.db, {
      orgId: job.orgId, actor: SYSTEM_ACTOR, action: AUDIT.contactNumberSwitched,
      targetType: 'contact', targetId: job.contactId,
      before: { phone: job.recipientValue }, after: { phone: n.value, reason: 'no_whatsapp_account' }
    });
    ctx.logger.info(
      { messageId: job.messageId, contactId: job.contactId },
      'primary number has no WhatsApp account; switched to the next number that has one'
    );
    return { kind: 'switched', phone: n.value };
  }
  return { kind: 'none' };
}
