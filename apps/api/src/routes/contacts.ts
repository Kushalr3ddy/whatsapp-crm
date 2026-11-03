import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { normalisePhone } from '@crm/shared';
import { writeAudit, AUDIT, csvHeader, csvLine, vcardEntry, fetchExportBatch } from '@crm/core';
import { requireScope, requireRole, auditActor } from '../auth.js';
import {
  loadCustomFields, validateCustomFields, searchPredicate, countSegmentCriteria, type SegmentDefinition
} from '@crm/core';
import { requireUuidParam } from '../params.js';
import { problem } from '../problem.js';
import { contactViewQuery, readView } from './contact-view.js';

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
const listContactsQuery = contactViewQuery.extend({
  /** Newest added first (default), oldest first, name A to Z or Z to A, or most recently imported first. */
  sort: z.enum(['added_desc', 'added_asc', 'name_asc', 'name_desc', 'imported_desc']).default('added_desc'),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  /** Skips this many people, for paging by number (the Contacts screen). */
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  cursor: z.string().datetime().optional()
});

/** Body for attaching a tag to a contact. */
const attachTag = z.object({ tagId: z.string().uuid() });

/**
 * The columns of a file worth showing as extra columns: all its headers except the ones already shown as Name,
 * Phone and Email (the columns the import read the name and the identities from).
 */
export function fileColumns(headers: unknown, mapping: unknown): string[] {
  if (!Array.isArray(headers)) return [];
  const m = (mapping ?? {}) as {
    displayName?: { from?: string }; nameParts?: { first?: string; last?: string };
    identities?: Array<{ from?: string }>;
  };
  const used = new Set<string>([
    m.displayName?.from, m.nameParts?.first, m.nameParts?.last, ...(m.identities ?? []).map((i) => i.from)
  ].filter((x): x is string => typeof x === 'string'));
  return (headers as unknown[]).filter((h): h is string => typeof h === 'string' && !used.has(h));
}

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
    const view = readView(req);
    if ('error' in view) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', view.error));
      return;
    }
    const narrowed = ['q', 'tag', 'file', 'filter', 'from', 'to'].some((k) => req.query[k] !== undefined);
    const filter = narrowed ? searchPredicate(req.crm!.orgId, view.filter) : null;
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
        SELECT count(*)::int AS n FROM contact c WHERE ${filter ?? sql`c.org_id = ${orgId} AND c.deleted_at IS NULL`}`)
      ) as unknown as Array<{ n: number }>;
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.contactsExported, targetType: 'contact',
        after: { format, people: total[0]?.n ?? 0, ...(narrowed ? { filtered: true } : {}) }, ip: req.ip ?? null, requestId: String(req.id)
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
      const batch = await req.tenant!((tx) => fetchExportBatch(tx, orgId, after, 500, filter));
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

  /** How many contacts match a search / source / filter — the number a bulk action would affect. */
  router.get('/count', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const view = readView(req);
    if ('error' in view) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', view.error));
      return;
    }
    const orgId = req.crm!.orgId;
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT count(*)::int AS n FROM contact c WHERE ${searchPredicate(orgId, view.filter)}`));
    res.json({ data: { total: (rows as unknown as Array<{ n: number }>)[0]!.n } });
  });

  /**
   * What the Contacts screen offers to look at: every imported file (with its columns and how many people it
   * brought in), the person's own tags, the saved lists, and what the filters need to name (campaigns, saved
   * columns). A file is also a tag named after it, so it is left out of "tags"; those cannot be deleted.
   */
  router.get('/sources', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const data = await req.tenant!(async (tx) => {
      const all = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM contact c WHERE c.org_id = ${orgId} AND c.deleted_at IS NULL`)
      ) as unknown as Array<{ n: number }>;
      const files = (await tx.execute(sql`
        SELECT ir.id, ir.filename, ir.created_at AS "importedAt", ir.headers, ir.mapping,
               CASE WHEN ir.summary ->> 'tagId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN ir.summary ->> 'tagId' END AS "tagId",
               (SELECT t.name FROM tag t WHERE t.org_id = ${orgId} AND t.id::text = ir.summary ->> 'tagId') AS "tagName",
               (SELECT count(DISTINCT r.contact_id)::int FROM import_row r
                 JOIN contact c ON c.id = r.contact_id AND c.deleted_at IS NULL
                 WHERE r.import_run_id = ir.id AND r.contact_id IS NOT NULL
                   AND r.outcome IN ('created', 'updated', 'skipped')) AS "count"
        FROM import_run ir
        WHERE ir.org_id = ${orgId} AND ir.status = 'committed' AND ir.superseded_at IS NULL
        ORDER BY ir.created_at DESC LIMIT 200`)) as unknown as Array<{
          id: string; filename: string | null; importedAt: string; headers: unknown; mapping: unknown;
          tagId: string | null; tagName: string | null; count: number;
        }>;
      const tags = await tx.execute(sql`
        SELECT t.id, t.name, t.colour,
               (SELECT count(*)::int FROM contact_tag ct JOIN contact c ON c.id = ct.contact_id AND c.deleted_at IS NULL
                 WHERE ct.tag_id = t.id) AS "count"
        FROM tag t
        WHERE t.org_id = ${orgId}
          AND NOT EXISTS (SELECT 1 FROM import_run r WHERE r.org_id = ${orgId} AND r.summary ->> 'tagId' = t.id::text)
        ORDER BY lower(t.name) ASC`);
      const lists = (await tx.execute(sql`
        SELECT id, name, definition FROM segment WHERE org_id = ${orgId} AND saved ORDER BY lower(name) ASC`)
      ) as unknown as Array<{ id: string; name: string; definition: SegmentDefinition }>;
      const campaigns = await tx.execute(sql`
        SELECT id, name FROM campaign WHERE org_id = ${orgId} AND status <> 'draft'
        ORDER BY coalesce(started_at, created_at) DESC LIMIT 200`);
      const fields = await loadCustomFields(tx, orgId);
      return {
        total: all[0]?.n ?? 0,
        files: files.map((f) => ({
          id: f.id, filename: f.filename, importedAt: f.importedAt, count: f.count, tagId: f.tagId, tagName: f.tagName,
          columns: fileColumns(f.headers, f.mapping)
        })),
        tags,
        lists: await Promise.all(lists.map(async (l) => ({
          id: l.id, name: l.name, definition: l.definition, count: await countSegmentCriteria(tx, orgId, l.definition)
        }))),
        campaigns,
        fields: fields.map((f) => ({ key: f.key, label: f.label }))
      };
    });
    res.json({ data });
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
    const view = readView(req);
    if ('error' in view) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', view.error));
      return;
    }
    const { sort, limit, offset, cursor, file } = parsed.data;
    const orgId = req.crm!.orgId;
    // Paging by cursor follows the added date, newest first; other orders page by offset.
    const before = sort === 'added_desc' && offset === 0 ? cursor ?? null : null;
    // The same search / source / filter rule bulk tagging resolves, so what is listed is what gets tagged.
    const filter = searchPredicate(orgId, view.filter);
    const importedAt = sql`(SELECT max(r.created_at) FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
                            WHERE ir.contact_id = c.id)`;
    const order = {
      added_desc: sql`c.created_at DESC`,
      added_asc: sql`c.created_at ASC`,
      name_asc: sql`lower(c.display_name) ASC NULLS LAST, c.created_at DESC, c.id ASC`,
      name_desc: sql`lower(c.display_name) DESC NULLS LAST, c.created_at DESC, c.id ASC`,
      imported_desc: sql`${importedAt} DESC NULLS LAST, c.created_at DESC`
    }[sort];
    // With a file picked, each person's row of that file (every column as it was read); else nothing.
    const fileValues = file === undefined ? sql`NULL::jsonb` : sql`(
      SELECT ir.raw FROM import_row ir
      WHERE ir.contact_id = c.id AND ir.import_run_id = ${file}::uuid AND ir.raw IS NOT NULL
      ORDER BY ir.row_number DESC LIMIT 1)`;
    const isFileTag = sql`EXISTS (SELECT 1 FROM import_run r2
                                  WHERE r2.org_id = ${orgId} AND r2.summary ->> 'tagId' = t.id::text)`;

    const [rows, counted] = await req.tenant!(async (tx) => [
      await tx.execute(sql`
        SELECT c.id, c.display_name AS "displayName", c.source,
               c.do_not_contact AS "doNotContact", c.created_at AS "createdAt",
               c.custom_fields AS "customFields",
               c.last_inbound_at AS "lastActiveAt",
               ${importedAt} AS "lastImportedAt",
               (SELECT json_build_object('id', r.id, 'filename', r.filename, 'importedAt', r.created_at)
                FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
                WHERE ir.contact_id = c.id AND r.status = 'committed'
                ORDER BY r.created_at DESC LIMIT 1) AS file,
               (SELECT json_build_object('id', cam.id, 'name', cam.name,
                                         'at', coalesce(cam.started_at, cam.created_at))
                FROM campaign_recipient cr JOIN campaign cam ON cam.id = cr.campaign_id
                WHERE cr.contact_id = c.id AND cr.status IN ('pending', 'queued', 'sent')
                ORDER BY coalesce(cam.started_at, cam.created_at) DESC LIMIT 1) AS "lastCampaign",
               ${fileValues} AS "fileValues",
               coalesce((
                 SELECT json_agg(json_build_object('kind', ci.kind, 'value', ci.value_normalized)
                                 ORDER BY ci.is_primary DESC)
                 FROM contact_identity ci
                 WHERE ci.contact_id = c.id AND ci.org_id = ${orgId}
               ), '[]'::json) AS identities,
               coalesce((
                 SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'colour', t.colour, 'isFile', ${isFileTag})
                                 ORDER BY ${isFileTag} DESC, t.name ASC)
                 FROM contact_tag ct JOIN tag t ON t.id = ct.tag_id
                 WHERE ct.contact_id = c.id AND ct.org_id = ${orgId}
               ), '[]'::json) AS tags
        FROM contact c
        WHERE ${filter}
          AND (${before}::timestamptz IS NULL OR c.created_at < ${before}::timestamptz)
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}`),
      await tx.execute(sql`SELECT count(*)::int AS n FROM contact c WHERE ${filter}`)
    ] as const);

    const data = rows as unknown as Array<{ createdAt: string }>;
    const total = (counted as unknown as Array<{ n: number }>)[0]!.n;
    // A full page means there may be more; hand back the last row's timestamp as the next cursor.
    const nextCursor = sort === 'added_desc' && data.length === limit ? data[data.length - 1]!.createdAt : null;
    res.json({ data, total, nextCursor });
  });

  /**
   * One person for the side panel: the file they came from with every column as it was read, every campaign
   * they have been in, and their latest chat (what Open chat links to).
   */
  router.get('/:id/detail', requireUuidParam('id'), requireScope('contacts:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const id = String(req.params.id);
      const data = await req.tenant!(async (tx) => {
        const exists = await tx.execute(sql`
          SELECT 1 FROM contact WHERE id = ${id} AND org_id = ${orgId} AND deleted_at IS NULL`);
        if ((exists as unknown as unknown[]).length === 0) return null;
        const sources = (await tx.execute(sql`
          SELECT r.id, r.filename, r.created_at AS "importedAt", r.headers, ir.raw
          FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
          WHERE ir.contact_id = ${id} AND ir.org_id = ${orgId} AND r.status = 'committed'
          ORDER BY r.created_at DESC, ir.row_number DESC LIMIT 1`)) as unknown as Array<{
            id: string; filename: string | null; importedAt: string; headers: unknown;
            raw: Record<string, string> | null;
          }>;
        const campaigns = await tx.execute(sql`
          SELECT cam.id, cam.name, cam.status AS "campaignStatus", s.label AS "numberLabel",
                 coalesce(cam.started_at, cam.created_at) AS "at",
                 CASE
                   WHEN cr.status = 'skipped' THEN 'skipped'
                   WHEN EXISTS (SELECT 1 FROM message im JOIN conversation iv ON iv.id = im.conversation_id
                                WHERE iv.contact_id = cr.contact_id AND im.direction = 'inbound'
                                  AND im.created_at > coalesce(m.sent_at, cr.attempted_at, cam.started_at)) THEN 'replied'
                   WHEN m.status IN ('read', 'delivered', 'sent', 'failed') THEN m.status
                   ELSE cr.status
                 END AS "outcome"
          FROM campaign_recipient cr
          JOIN campaign cam ON cam.id = cr.campaign_id
          JOIN sender_identity s ON s.id = cam.sender_identity_id
          LEFT JOIN message m ON m.id = cr.message_id
          WHERE cr.contact_id = ${id} AND cr.org_id = ${orgId}
          ORDER BY coalesce(cam.started_at, cam.created_at) DESC LIMIT 100`);
        const chat = (await tx.execute(sql`
          SELECT id FROM conversation WHERE contact_id = ${id} AND org_id = ${orgId}
          ORDER BY coalesce(last_inbound_at, last_outbound_at, created_at) DESC LIMIT 1`)
        ) as unknown as Array<{ id: string }>;
        const src = sources[0];
        return {
          source: src === undefined ? null : {
            fileId: src.id, filename: src.filename, importedAt: src.importedAt,
            // Every column the file had, in its order, with this person's value ('' when blank or not kept).
            columns: Array.isArray(src.headers)
              ? (src.headers as string[]).map((h) => ({ header: h, value: src.raw?.[h] ?? '' }))
              : Object.entries(src.raw ?? {}).map(([header, value]) => ({ header, value }))
          },
          campaigns,
          conversationId: chat[0]?.id ?? null
        };
      });
      if (data === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such contact.'));
        return;
      }
      res.json({ data });
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
