import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { normalisePhone } from '@crm/shared';
import { requireScope } from '../auth.js';
import { problem } from '../problem.js';

/**
 * Body for creating a contact.
 *
 * At least one of `phone` or `email` is required — a contact with nothing to reach them by is
 * not a contact, the same rule the importer enforces (M7). `externalRef` is the hook the host
 * app (the job portal) uses to carry its own id — the candidate this contact corresponds to —
 * so the two systems can be joined without this one knowing anything about candidates.
 */
const createContact = z.object({
  displayName: z.string().min(1).max(200).optional(),
  phone: z.string().min(4).optional(),
  email: z.string().email().optional(),
  customFields: z.record(z.unknown()).optional(),
  externalRef: z.record(z.unknown()).optional()
}).refine((v) => v.phone !== undefined || v.email !== undefined, {
  message: 'a contact needs at least one of `phone` or `email` to be reachable by'
});

/**
 * Query for listing / searching contacts. `q` is a free-text substring; `cursor` is the
 * `createdAt` of the last row seen, for keyset paging without offsets on an unbounded list.
 */
const listContactsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional()
});

/**
 * Creating a contact over HTTP.
 *
 * The one way to add a single person that did not previously exist — until now a contact could
 * only appear from an inbound message, a one-off send, or a CSV/Excel import, so anything wanting
 * to push one person (the host app, an integration) had no route. `contacts:write` was an
 * enforceable scope with nothing behind it; this is what it now guards.
 */
export function contactsRouter(defaultCountry: string): Router {
  const router = Router();

  /** Creates a contact with its identities, refusing when an identity already names someone. */
  router.post('/', requireScope('contacts:write'), async (req: Request, res: Response) => {
    const parsed = createContact.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { displayName, phone, email, customFields, externalRef } = parsed.data;
    const orgId = req.crm!.orgId;

    // One normalisation boundary, the same function the send path and the importer use, so a
    // number written three ways becomes one identity rather than three contacts (M8). A phone
    // that cannot be normalised is refused; one that is valid but not WhatsApp-reachable is
    // still stored — this is contact management, not a send, and a landline is a real contact.
    const identities: Array<{ kind: string; value: string }> = [];
    if (phone !== undefined) {
      const p = normalisePhone(phone, defaultCountry);
      if (!p.ok) {
        res.status(422).json(problem(req, 422, `PHONE_${p.reason.toUpperCase()}`, p.message));
        return;
      }
      identities.push({ kind: 'phone', value: p.value.e164 });
    }
    if (email !== undefined) identities.push({ kind: 'email', value: email.trim().toLowerCase() });

    const name = displayName ?? identities[0]!.value;

    /** Either an identity already named someone (with which id and kind), or a fresh contact. */
    type CreateResult = { exists: string; matchedKind: string } | { contactId: string };
    const result = await req.tenant!(async (tx): Promise<CreateResult> => {
      // Refuse if any identity already names a contact — a create must not silently merge into
      // an existing person. The caller gets the existing id and can decide (M7: never match on
      // a blank, but these are all non-empty by construction).
      for (const id of identities) {
        const found = (await tx.execute(sql`
          SELECT contact_id AS "contactId" FROM contact_identity
          WHERE org_id = ${orgId} AND kind = ${id.kind} AND value_normalized = ${id.value} LIMIT 1`)
        ) as unknown as Array<{ contactId: string }>;
        if (found.length > 0) return { exists: found[0]!.contactId, matchedKind: id.kind };
      }

      const created = (await tx.execute(sql`
        INSERT INTO contact (org_id, display_name, source, custom_fields, external_ref)
        VALUES (${orgId}, ${name}, 'api', ${JSON.stringify(customFields ?? {})}::jsonb,
                ${externalRef === undefined ? null : JSON.stringify(externalRef)}::jsonb)
        RETURNING id`)
      ) as unknown as Array<{ id: string }>;
      const contactId = created[0]!.id;

      for (const [index, id] of identities.entries()) {
        await tx.execute(sql`
          INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
          VALUES (${orgId}, ${contactId}, ${id.kind}, ${id.value}, ${index === 0})`);
      }
      return { contactId };
    });

    if ('exists' in result) {
      res.status(409).json({
        ...problem(req, 409, 'CONTACT_EXISTS',
          `A contact with this ${result.matchedKind} already exists.`),
        existingContactId: result.exists
      });
      return;
    }

    res.status(201).json({
      data: {
        id: result.contactId,
        displayName: name,
        identities: identities.map((i) => ({ kind: i.kind, value: i.value }))
      }
    });
  });

  /**
   * Lists and searches contacts, newest first.
   *
   * Search matches the display name **or any identity** (phone/email) with a case-insensitive
   * substring. Contact fields are not encrypted, so this is a plain `ILIKE` — no blind index and
   * no design decision (the encrypted message-body search of D-23 is the separate, harder half).
   * Keyset-paginated on `created_at` so a large contact book pages without offsets.
   */
  router.get('/', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const parsed = listContactsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { q, limit, cursor } = parsed.data;
    const orgId = req.crm!.orgId;
    const like = q === undefined ? null : `%${q}%`;
    const before = cursor ?? null;

    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT c.id, c.display_name AS "displayName", c.source,
             c.do_not_contact AS "doNotContact", c.created_at AS "createdAt",
             coalesce((
               SELECT json_agg(json_build_object('kind', ci.kind, 'value', ci.value_normalized)
                               ORDER BY ci.is_primary DESC)
               FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
             ), '[]'::json) AS identities
      FROM contact c
      WHERE c.org_id = ${orgId}
        AND c.deleted_at IS NULL
        AND (${like}::text IS NULL
             OR c.display_name ILIKE ${like}
             OR EXISTS (SELECT 1 FROM contact_identity ci2
                        WHERE ci2.contact_id = c.id AND ci2.value_normalized ILIKE ${like}))
        AND (${before}::timestamptz IS NULL OR c.created_at < ${before}::timestamptz)
      ORDER BY c.created_at DESC
      LIMIT ${limit}`));

    const data = rows as unknown as Array<{ createdAt: string }>;
    // A full page means there may be more; hand back the last row's timestamp as the next cursor.
    const nextCursor = data.length === limit ? data[data.length - 1]!.createdAt : null;
    res.json({ data, nextCursor });
  });

  return router;
}
