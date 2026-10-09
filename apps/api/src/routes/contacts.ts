import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { normalisePhone } from '@crm/shared';
import { writeAudit, AUDIT, csvHeader, csvLine, vcardEntry, fetchExportBatch } from '@crm/core';
import { requireScope, requireRole, auditActor } from '../auth.js';
import { loadCustomFields, validateCustomFields } from '@crm/core';
import { requireUuidParam } from '../params.js';
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
  /** Narrow to contacts carrying this tag — the "select people by label" path. */
  tag: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional()
});

/** Body for attaching a tag to a contact. */
const attachTag = z.object({ tagId: z.string().uuid() });

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

  /**
   * Exports everyone the system holds about the people it messages, as CSV or vCard.
   *
   * **Admin session only** (an API key is refused — an integration should not be able to walk out
   * with the whole book), **at most 5 exports an hour per organisation**, and **audited before any
   * byte is sent** with the format and the number of people, so an abandoned download still counts.
   * People's details only, never message text. Streamed in keyset batches, so a large book never
   * sits in memory as one result. `Content-Disposition: attachment`, `nosniff`, `no-store` — the
   * same posture as a stored file.
   */
  router.get('/export', requireRole('admin'), async (req: Request, res: Response) => {
    const format = req.query.format === 'vcf' ? 'vcf' : req.query.format === undefined || req.query.format === 'csv' ? 'csv' : null;
    if (format === null) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'format must be `csv` or `vcf`.'));
      return;
    }
    const orgId = req.crm!.orgId;

    const gate = await req.tenant!(async (tx) => {
      const recent = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM audit_log
        WHERE org_id = ${orgId} AND action = ${AUDIT.contactsExported}
          AND at > now() - interval '1 hour'`)) as unknown as Array<{ n: number }>;
      if ((recent[0]?.n ?? 0) >= 5) return { limited: true as const };
      const total = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM contact WHERE org_id = ${orgId} AND deleted_at IS NULL`)
      ) as unknown as Array<{ n: number }>;
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.contactsExported, targetType: 'contact',
        after: { format, people: total[0]?.n ?? 0 }, ip: req.ip ?? null, requestId: String(req.id)
      });
      return { limited: false as const };
    });
    if (gate.limited) {
      res.status(429).setHeader('Retry-After', '3600').json(problem(req, 429, 'EXPORT_RATE_LIMITED',
        'At most 5 exports an hour. Try again later.'));
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.status(200);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.${format}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (format === 'csv') res.write('\uFEFF' + csvHeader());     // BOM so Excel reads UTF-8 names

    let after: string | null = null;
    for (;;) {
      const batch = await req.tenant!((tx) => fetchExportBatch(tx, orgId, after, 500));
      if (batch.length === 0) break;
      for (const row of batch) {
        const chunk = format === 'csv' ? csvLine(row) : vcardEntry(row);
        if (chunk !== null) res.write(chunk);
      }
      after = batch[batch.length - 1]!.id;
      if (batch.length < 500) break;
    }
    res.end();
  });

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

    // Custom fields are a fixed vocabulary: only defined keys, each checked against its type.
    let storedFields: Record<string, string | number> = {};
    if (customFields !== undefined && Object.keys(customFields).length > 0) {
      const defs = await req.tenant!((tx) => loadCustomFields(tx, orgId));
      const checked = validateCustomFields(defs, customFields);
      if (!checked.ok) {
        res.status(422).json(problem(req, 422, 'INVALID_CUSTOM_FIELDS', checked.errors.join('; ')));
        return;
      }
      storedFields = checked.set;
    }

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
        VALUES (${orgId}, ${name}, 'api', ${JSON.stringify(storedFields)}::jsonb,
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
    const { q, tag, limit, cursor } = parsed.data;
    const orgId = req.crm!.orgId;
    const like = q === undefined ? null : `%${q}%`;
    const tagId = tag ?? null;
    const before = cursor ?? null;

    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT c.id, c.display_name AS "displayName", c.source,
             c.do_not_contact AS "doNotContact", c.created_at AS "createdAt",
             c.custom_fields AS "customFields",
             coalesce((
               SELECT json_agg(json_build_object('kind', ci.kind, 'value', ci.value_normalized)
                               ORDER BY ci.is_primary DESC)
               FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
             ), '[]'::json) AS identities,
             coalesce((
               SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'colour', t.colour)
                               ORDER BY t.name ASC)
               FROM contact_tag ct JOIN tag t ON t.id = ct.tag_id
               WHERE ct.contact_id = c.id AND ct.org_id = ${orgId}
             ), '[]'::json) AS tags
      FROM contact c
      WHERE c.org_id = ${orgId}
        AND c.deleted_at IS NULL
        AND (${like}::text IS NULL
             OR c.display_name ILIKE ${like}
             OR EXISTS (SELECT 1 FROM contact_identity ci2
                        WHERE ci2.contact_id = c.id AND ci2.value_normalized ILIKE ${like}))
        AND (${tagId}::uuid IS NULL
             OR EXISTS (SELECT 1 FROM contact_tag ct2
                        WHERE ct2.contact_id = c.id AND ct2.tag_id = ${tagId}::uuid))
        AND (${before}::timestamptz IS NULL OR c.created_at < ${before}::timestamptz)
      ORDER BY c.created_at DESC
      LIMIT ${limit}`));

    const data = rows as unknown as Array<{ createdAt: string }>;
    // A full page means there may be more; hand back the last row's timestamp as the next cursor.
    const nextCursor = data.length === limit ? data[data.length - 1]!.createdAt : null;
    res.json({ data, nextCursor });
  });

  /**
   * Attaches a tag to a contact. Idempotent — re-applying the same tag is a no-op, not an error,
   * which is what makes "tag everyone in this view" safe to run twice.
   */
  router.post('/:id/tags', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const parsed = attachTag.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
        return;
      }
      const orgId = req.crm!.orgId;
      // Both the contact and the tag must belong to this org — RLS enforces it, and checking here
      // turns a would-be foreign-key 500 into a clean 404.
      const outcome = await req.tenant!(async (tx): Promise<'ok' | 'not_found'> => {
        const c = await tx.execute(sql`
          SELECT 1 FROM contact WHERE id = ${req.params.id} AND org_id = ${orgId}
            AND deleted_at IS NULL`);
        const t = await tx.execute(sql`
          SELECT 1 FROM tag WHERE id = ${parsed.data.tagId} AND org_id = ${orgId}`);
        if ((c as unknown as unknown[]).length === 0 || (t as unknown as unknown[]).length === 0) {
          return 'not_found';
        }
        await tx.execute(sql`
          INSERT INTO contact_tag (org_id, contact_id, tag_id)
          VALUES (${orgId}, ${req.params.id}, ${parsed.data.tagId})
          ON CONFLICT (contact_id, tag_id) DO NOTHING`);
        return 'ok';
      });
      if (outcome === 'not_found') {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such contact or tag.'));
        return;
      }
      res.status(204).end();
    });

  /**
   * Sets or clears custom field values on a contact: `{ "values": { "city": "Pune", "stage": null } }`.
   * `null` or an empty string clears a field. Validated against the org's definitions.
   */
  router.put('/:id/custom-fields', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const body = z.object({ values: z.record(z.unknown()) }).safeParse(req.body);
      if (!body.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Send { "values": { key: value } }.'));
        return;
      }
      const orgId = req.crm!.orgId;
      const outcome = await req.tenant!(async (tx) => {
        const exists = await tx.execute(sql`
          SELECT 1 FROM contact WHERE id = ${req.params.id} AND org_id = ${orgId} AND deleted_at IS NULL`);
        if ((exists as unknown as unknown[]).length === 0) return { notFound: true as const };
        const defs = await loadCustomFields(tx, orgId);
        const checked = validateCustomFields(defs, body.data.values);
        if (!checked.ok) return { errors: checked.errors };
        let next = sql`custom_fields`;
        for (const key of checked.clear) next = sql`(${next}) - ${key}::text`;
        await tx.execute(sql`
          UPDATE contact SET custom_fields = (${next}) || ${JSON.stringify(checked.set)}::jsonb,
                             updated_at = now()
          WHERE id = ${req.params.id} AND org_id = ${orgId}`);
        return { ok: true as const };
      });
      if ('notFound' in outcome) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such contact.'));
        return;
      }
      if ('errors' in outcome) {
        res.status(422).json(problem(req, 422, 'INVALID_CUSTOM_FIELDS', outcome.errors.join('; ')));
        return;
      }
      res.status(204).end();
    });

  /**
   * Flags or clears do-not-contact. A flagged contact is refused by every send path (a message, a
   * campaign recipient, the gateway's last-line check) unless an admin overrides it, with a reason,
   * for one message or one campaign. The reason is kept on the contact and the change is audited.
   */
  router.put('/:id/do-not-contact', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const body = z.object({
        value: z.boolean(), reason: z.string().trim().max(500).optional()
      }).safeParse(req.body);
      if (!body.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Send { "value": true|false, "reason": "…" }.'));
        return;
      }
      const orgId = req.crm!.orgId;
      const { value, reason } = body.data;
      const found = await req.tenant!(async (tx) => {
        const rows = await tx.execute(sql`
          UPDATE contact SET
            do_not_contact = ${value}, dnc_reason = ${value ? reason ?? null : null},
            dnc_at = ${value ? sql`now()` : null}, updated_at = now()
          WHERE id = ${req.params.id} AND org_id = ${orgId} AND deleted_at IS NULL
          RETURNING id`);
        if ((rows as unknown as unknown[]).length === 0) return false;
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.contactDncChanged, targetType: 'contact',
          targetId: String(req.params.id), after: { doNotContact: value, reason: reason ?? null },
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return true;
      });
      if (!found) { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such contact.')); return; }
      res.status(204).end();
    });

  /** Removes a tag from a contact. A no-op if it was not there. */
  router.delete('/:id/tags/:tagId', requireUuidParam('id'), requireUuidParam('tagId'),
    requireScope('contacts:write'), async (req: Request, res: Response) => {
      await req.tenant!((tx) => tx.execute(sql`
        DELETE FROM contact_tag
        WHERE org_id = ${req.crm!.orgId} AND contact_id = ${req.params.id}
          AND tag_id = ${req.params.tagId}`));
      res.status(204).end();
    });

  return router;
}
