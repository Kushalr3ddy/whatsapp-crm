import { sql } from 'drizzle-orm';

/**
 * Exporting everyone the system holds about the people it messages — to CSV for a spreadsheet, or
 * to vCard so the contacts can be loaded onto a phone.
 *
 * A bulk export is the easiest way to leak a whole contact book, so the route around this is
 * admin-only, rate-limited and audited; this module is only the shaping. It exports *people's
 * details*, not message text: names, numbers, emails, tags, where they came from, whether they may
 * be contacted, and how much has passed between us. Pure where it can be, so the escaping — the
 * part that has to be right — is unit-tested without a database.
 */
export const EXPORT_COLUMNS = [
  'id', 'name', 'phones', 'emails', 'other_ids', 'tags', 'source', 'external_ref', 'custom_fields',
  'do_not_contact', 'do_not_contact_reason', 'created_at', 'first_contacted_at', 'last_contacted_at',
  'last_replied_at', 'messages_sent', 'messages_received', 'campaigns'
] as const;

/** One person, as the export sees them. Multi-valued fields are already joined with `; `. */
export interface ExportRow {
  readonly id: string;
  readonly name: string | null;
  readonly phones: string;
  readonly emails: string;
  readonly otherIds: string;
  readonly tags: string;
  readonly source: string | null;
  readonly externalRef: unknown;
  readonly customFields: unknown;
  readonly doNotContact: boolean;
  readonly dncReason: string | null;
  readonly createdAt: string;
  readonly firstContactedAt: string | null;
  readonly lastContactedAt: string | null;
  readonly lastRepliedAt: string | null;
  readonly messagesSent: number;
  readonly messagesReceived: number;
  readonly campaigns: string;
}

/**
 * One CSV cell, quoted when needed and **defused against spreadsheet formulas**.
 *
 * A cell beginning with `=`, `+`, `-` or `@` is run as a formula by Excel and Sheets, and these
 * values came from imports and from strangers' WhatsApp profiles, so a contact named `=HYPERLINK(...)`
 * would execute when an admin opens the file. Such a cell is prefixed with an apostrophe. A phone
 * list (`+9198…; +9197…`) legitimately starts with `+`, so a value that is only digits, spaces, `+`
 * and `;` is left alone — it cannot be a formula.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^\+?[0-9][0-9 ;+]*$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The header line. */
export function csvHeader(): string {
  return EXPORT_COLUMNS.join(',') + '\r\n';
}

/** One person as a CSV line. Empty custom fields / external refs export as blank, not `{}`. */
export function csvLine(r: ExportRow): string {
  const json = (v: unknown): unknown =>
    v !== null && typeof v === 'object' && Object.keys(v as object).length === 0 ? '' : v;
  return [
    r.id, r.name, r.phones, r.emails, r.otherIds, r.tags, r.source, json(r.externalRef),
    json(r.customFields), r.doNotContact ? 'yes' : 'no', r.dncReason, r.createdAt,
    r.firstContactedAt, r.lastContactedAt, r.lastRepliedAt, r.messagesSent, r.messagesReceived,
    r.campaigns
  ].map(csvCell).join(',') + '\r\n';
}

/** Escapes a vCard text value: backslash, comma, semicolon and newline are structural. */
function vcardText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * One person as a vCard 3.0 entry — the format phones import. Returns null for someone with
 * neither a name nor a number or email (nothing a phone could show). Tags, source and the
 * do-not-contact flag go in `NOTE` so they travel with the card.
 */
export function vcardEntry(r: ExportRow): string | null {
  const phones = r.phones.split('; ').filter((p) => p !== '');
  const emails = r.emails.split('; ').filter((e) => e !== '');
  const name = (r.name ?? '').trim() || phones[0] || emails[0];
  if (!name) return null;
  const note = [
    r.tags !== '' ? `tags: ${r.tags}` : '', r.source ? `source: ${r.source}` : '',
    r.doNotContact ? 'DO NOT CONTACT' : ''
  ].filter((x) => x !== '').join(' | ');
  const lines = [
    'BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardText(name)}`, `N:${vcardText(name)};;;;`,
    ...phones.map((p) => `TEL;TYPE=CELL:${p}`),
    ...emails.map((e) => `EMAIL;TYPE=INTERNET:${vcardText(e)}`),
    ...(note !== '' ? [`NOTE:${vcardText(note)}`] : []),
    'END:VCARD'
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Anything that can run a query — a request's tenant transaction. */
interface Executor { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }

/**
 * The next batch of people, in id order after `afterId`. Keyset paging, so a very large book
 * streams in bounded chunks instead of one enormous result. Soft-deleted contacts are excluded.
 */
export async function fetchExportBatch(
  tx: Executor, orgId: string, afterId: string | null, limit: number
): Promise<ExportRow[]> {
  const rows = await tx.execute(sql`
    SELECT c.id, c.display_name AS "name", c.source,
      c.external_ref AS "externalRef", c.custom_fields AS "customFields",
      c.do_not_contact AS "doNotContact", c.dnc_reason AS "dncReason",
      c.created_at AS "createdAt", c.last_inbound_at AS "lastRepliedAt",
      coalesce((SELECT string_agg(ci.value_normalized, '; ' ORDER BY ci.is_primary DESC, ci.created_at)
                FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.kind = 'phone'), '') AS "phones",
      coalesce((SELECT string_agg(ci.value_normalized, '; ' ORDER BY ci.is_primary DESC, ci.created_at)
                FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.kind = 'email'), '') AS "emails",
      coalesce((SELECT string_agg(ci.kind || ':' || ci.value_normalized, '; ' ORDER BY ci.created_at)
                FROM contact_identity ci WHERE ci.contact_id = c.id
                  AND ci.kind NOT IN ('phone','email')), '') AS "otherIds",
      coalesce((SELECT string_agg(t.name, '; ' ORDER BY t.name)
                FROM contact_tag ct JOIN tag t ON t.id = ct.tag_id
                WHERE ct.contact_id = c.id), '') AS "tags",
      (SELECT min(m.sent_at) FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.contact_id = c.id AND m.direction = 'outbound' AND m.sent_at IS NOT NULL) AS "firstContactedAt",
      (SELECT max(m.sent_at) FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.contact_id = c.id AND m.direction = 'outbound' AND m.sent_at IS NOT NULL) AS "lastContactedAt",
      (SELECT count(*)::int FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.contact_id = c.id AND m.direction = 'outbound'
          AND m.status IN ('sent','delivered','read')) AS "messagesSent",
      (SELECT count(*)::int FROM message m JOIN conversation v ON v.id = m.conversation_id
        WHERE v.contact_id = c.id AND m.direction = 'inbound') AS "messagesReceived",
      coalesce((SELECT string_agg(DISTINCT cp.name, '; ')
                FROM campaign_recipient cr JOIN campaign cp ON cp.id = cr.campaign_id
                WHERE cr.contact_id = c.id AND cr.status IN ('queued','sent')), '') AS "campaigns"
    FROM contact c
    WHERE c.org_id = ${orgId} AND c.deleted_at IS NULL
      AND (${afterId}::uuid IS NULL OR c.id > ${afterId}::uuid)
    ORDER BY c.id
    LIMIT ${limit}`);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    createdAt: toIso(r.createdAt), firstContactedAt: toIsoOrNull(r.firstContactedAt),
    lastContactedAt: toIsoOrNull(r.lastContactedAt), lastRepliedAt: toIsoOrNull(r.lastRepliedAt)
  })) as unknown as ExportRow[];
}

/** Timestamps arrive as strings from the driver; normalise to ISO so the file is unambiguous. */
function toIso(v: unknown): string {
  return new Date(String(v)).toISOString();
}

/** As `toIso`, keeping null. */
function toIsoOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : toIso(v);
}
