import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';
import { writeAudit, SYSTEM_ACTOR, AUDIT } from './audit.js';

/**
 * Linking a WhatsApp privacy address (`…@lid`) to the phone number it belongs to.
 *
 * A person who messages us from a `@lid` address arrives as a contact with no number. When
 * WhatsApp does tell us the number (the message carries it, or the person shares it), the two are
 * the same human and must become one contact — otherwise the same person is two threads, two
 * campaign recipients, and a "new stranger" every time they switch address.
 */
export type LinkOutcome = 'linked' | 'merged' | 'already_linked' | 'nothing_to_link';

/**
 * Links `lid` and `phoneE164` on one contact.
 *
 * - Only the privacy address is known → the phone becomes its identity (and its display name, if
 *   the name was just the raw address).
 * - Only the phone is known → the privacy address is added to that contact.
 * - Both exist as **different** contacts → they are merged into the phone contact: conversations
 *   (messages and notes follow), tags, campaign recipients, import rows and identities move over;
 *   do-not-contact is kept if either had it; the privacy-address contact is soft-deleted.
 * - Neither exists → nothing to do; the next inbound message will create the contact and link.
 *
 * One transaction, serialised per address, so two racing events cannot half-merge.
 */
export async function linkLidToPhone(
  db: Database, orgId: string, link: { lid: string; phoneE164: string }
): Promise<LinkOutcome> {
  const { lid, phoneE164 } = link;
  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`link:${orgId}:${lid}`}))`);

    const find = async (kind: string, value: string): Promise<string | null> => {
      const r = await tx.execute(sql`
        SELECT contact_id AS id FROM contact_identity
        WHERE org_id = ${orgId} AND kind = ${kind} AND value_normalized = ${value}`);
      return (r as unknown as Array<{ id: string }>)[0]?.id ?? null;
    };
    const a = await find('wa_lid', lid);        // the privacy-address contact
    const b = await find('phone', phoneE164);   // the phone contact

    if (a === null && b === null) return 'nothing_to_link';
    if (a !== null && a === b) return 'already_linked';

    if (a !== null && b === null) {
      await tx.execute(sql`UPDATE contact_identity SET is_primary = false WHERE contact_id = ${a}`);
      await tx.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary, verified_at)
        VALUES (${orgId}, ${a}, 'phone', ${phoneE164}, true, now())
        ON CONFLICT DO NOTHING`);
      // A contact made from an inbound message is named after its raw address; a number reads better.
      await tx.execute(sql`
        UPDATE contact SET display_name = ${phoneE164}, updated_at = now()
        WHERE id = ${a} AND display_name = ${lid}`);
      return 'linked';
    }

    if (a === null && b !== null) {
      await tx.execute(sql`
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary, verified_at)
        VALUES (${orgId}, ${b}, 'wa_lid', ${lid}, false, now())
        ON CONFLICT DO NOTHING`);
      return 'linked';
    }

    // Both exist and differ: fold the privacy-address contact (a) into the phone contact (b).
    const from = a!, into = b!;

    // Conversations are unique per (contact, number). Where both people already talked to us from
    // the same number, move the messages and notes into the surviving thread; otherwise re-home it.
    const convs = await tx.execute(sql`
      SELECT id, sender_identity_id AS "senderId" FROM conversation WHERE contact_id = ${from}`);
    for (const c of convs as unknown as Array<{ id: string; senderId: string }>) {
      const twin = await tx.execute(sql`
        SELECT id FROM conversation WHERE contact_id = ${into} AND sender_identity_id = ${c.senderId}`);
      const twinId = (twin as unknown as Array<{ id: string }>)[0]?.id;
      if (twinId === undefined) {
        await tx.execute(sql`UPDATE conversation SET contact_id = ${into}, updated_at = now() WHERE id = ${c.id}`);
        continue;
      }
      await tx.execute(sql`UPDATE message SET conversation_id = ${twinId} WHERE conversation_id = ${c.id}`);
      await tx.execute(sql`UPDATE internal_note SET conversation_id = ${twinId} WHERE conversation_id = ${c.id}`);
      await tx.execute(sql`
        UPDATE conversation t SET
          unread_count = t.unread_count + s.unread_count,
          last_inbound_at = greatest(t.last_inbound_at, s.last_inbound_at),
          last_outbound_at = greatest(t.last_outbound_at, s.last_outbound_at),
          updated_at = now()
        FROM conversation s WHERE t.id = ${twinId} AND s.id = ${c.id}`);
      await tx.execute(sql`DELETE FROM conversation WHERE id = ${c.id}`);
    }

    await tx.execute(sql`
      INSERT INTO contact_tag (org_id, contact_id, tag_id, created_at)
      SELECT org_id, ${into}, tag_id, created_at FROM contact_tag WHERE contact_id = ${from}
      ON CONFLICT (contact_id, tag_id) DO NOTHING`);
    await tx.execute(sql`DELETE FROM contact_tag WHERE contact_id = ${from}`);

    await tx.execute(sql`
      DELETE FROM campaign_recipient WHERE contact_id = ${from}
        AND campaign_id IN (SELECT campaign_id FROM campaign_recipient WHERE contact_id = ${into})`);
    await tx.execute(sql`UPDATE campaign_recipient SET contact_id = ${into} WHERE contact_id = ${from}`);
    await tx.execute(sql`UPDATE import_row SET contact_id = ${into} WHERE contact_id = ${from}`);
    await tx.execute(sql`
      UPDATE contact_identity SET contact_id = ${into}, is_primary = false WHERE contact_id = ${from}`);

    await tx.execute(sql`
      UPDATE contact t SET
        custom_fields = s.custom_fields || t.custom_fields,
        external_ref = coalesce(t.external_ref, s.external_ref),
        do_not_contact = t.do_not_contact OR s.do_not_contact,
        dnc_reason = coalesce(t.dnc_reason, s.dnc_reason),
        dnc_at = coalesce(t.dnc_at, s.dnc_at),
        last_inbound_at = greatest(t.last_inbound_at, s.last_inbound_at),
        updated_at = now()
      FROM contact s WHERE t.id = ${into} AND s.id = ${from}`);
    await tx.execute(sql`
      UPDATE contact SET deleted_at = now(), updated_at = now() WHERE id = ${from}`);

    await writeAudit(tx, {
      orgId, actor: SYSTEM_ACTOR, action: AUDIT.contactMerged, targetType: 'contact', targetId: into,
      after: { absorbed: from, reason: 'lid_linked_to_phone' }
    });
    return 'merged';
  });
}
