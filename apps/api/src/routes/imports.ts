import { Router, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { parseCsv, profileColumns, suggestColumns } from '@crm/shared';
import {
  runImport, writeAudit, AUDIT, ensureTag, tagImportRun, type ImportMapping
} from '@crm/core';
import { assertValidKey, InvalidKeyError, type StorageDriver } from '@crm/storage';
import { auditActor, requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';
import { parseImportIsolated, ImportParseError, type ImportParseOptions } from '../import-parse.js';

/** Answers an upload or a run whose file was not read: 429 when the reader is busy, 422 for anything about the file itself. */
function refuseFile(req: Request, res: Response, error: ImportParseError): void {
  const status = error.code === 'IMPORT_BUSY' ? 429 : 422;
  if (status === 429) res.setHeader('Retry-After', '5');
  if (error.detail !== undefined) req.log.warn({ code: error.code, detail: error.detail }, 'import file not read');
  res.status(status).json(problem(req, status, error.code, error.message));
}

/** A transform a mapping may name. An allowlist — never an expression, never `eval`. */
const transform = z.enum(['trim', 'lower', 'upper', 'digits']);

/** The mapping body. Validated here so a bad mapping fails before a single row is touched. */
const mappingSchema = z.object({
  version: z.literal(1),
  displayName: z.object({ from: z.string().min(1), transform: z.array(transform).optional() }).optional(),
  /** A name built from a first-name column and a last-name column. */
  nameParts: z.object({ first: z.string().min(1), last: z.string().min(1) }).optional(),
  identities: z.array(z.object({
    kind: z.enum(['phone', 'email', 'external']),
    from: z.string().min(1),
    transform: z.array(transform).optional()
  })).min(1, 'at least one identity rule: a row with nothing to identify a person by cannot become a contact'),
  defaultCountry: z.string().length(2).optional(),
  unmapped: z.enum(['keep', 'drop']).optional(),
  /** Columns to keep on each contact as custom fields (at most 200, so one file cannot flood the field list). */
  fields: z.array(z.object({ from: z.string().min(1) })).max(200).optional()
});

/** Body for executing a run. */
const runSchema = z.object({
  mapping: mappingSchema,
  /**
   * Defaults to **true**. A commit must be asked for explicitly: the failure this guards
   * against is a sparse file silently overwriting richer data, and defaulting to the safe
   * side makes that impossible to hit by accident rather than merely discouraged (M9).
   */
  dryRun: z.boolean().default(true),
  /**
   * Tag everyone this run created, updated or matched — an existing tag by id, or a name (created if
   * new). Applied only on a commit, atomically with the run being marked committed.
   */
  tag: z.union([
    z.object({ id: z.string().uuid() }),
    z.object({ name: z.string().trim().min(1).max(60) })
  ]).optional()
});

/**
 * Importing a file of contacts.
 *
 * Three-step on purpose (docs/07-ingestion.md): upload the bytes, post a mapping as a dry run,
 * then commit. The file never round-trips through the browser, so there is no 50 MB JSON POST
 * and no client-side parsing to disagree with the server's.
 */
export function importsRouter(
  storage: StorageDriver, maxBytes: number, defaultCountry: string, parse: ImportParseOptions
): Router {
  const router = Router();

  /**
   * Stores a file and reports what is in it.
   *
   * **The same file must not import twice, whatever it is called.** `contacts.xlsx`,
   * `contacts (1).xlsx` and `contacts-FINAL.xlsx` are one file; a filename answers nothing.
   * The content hash is the identity, unique per org.
   */
  router.post('/', requireScope('contacts:write'), async (req: Request, res: Response) => {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      res.status(415).json(problem(req, 415, 'UNSUPPORTED_MEDIA_TYPE',
        'POST the file itself — a CSV (text/csv) or an .xlsx spreadsheet.'));
      return;
    }
    if (body.byteLength > maxBytes) {
      res.status(413).json(problem(req, 413, 'FILE_TOO_LARGE',
        `This file is ${String(body.byteLength)} bytes; the limit is ${String(maxBytes)}.`));
      return;
    }

    const orgId = req.crm!.orgId;
    const sha256 = createHash('sha256').update(body).digest('hex');
    const filename = typeof req.query.filename === 'string' ? req.query.filename : null;
    const force = req.query.force === 'true';

    // The duplicate check, before anything is stored or parsed.
    const existing = await req.tenant!((tx) => tx.execute(sql`
      SELECT id, status, created_at AS "createdAt", row_count AS "rowCount"
      FROM import_run
      WHERE org_id = ${orgId} AND sha256 = ${sha256} AND superseded_at IS NULL LIMIT 1`));
    const previous = (existing as unknown as Array<{
      id: string; status: string; createdAt: string; rowCount: number;
    }>)[0];

    if (previous && !force) {
      // Refused, with a pointer — not a silent success. A duplicate-but-fine is how a double
      // import gets noticed a week later, by which time it has been messaged.
      res.status(409).json({
        ...problem(req, 409, 'ALREADY_IMPORTED',
          `These exact bytes were already uploaded on ${previous.createdAt} as run ` +
          `${previous.id} (${String(previous.rowCount)} rows, status ${previous.status}). ` +
          'Re-import deliberately with ?force=true.'),
        previousRunId: previous.id
      });
      return;
    }

    // An .xlsx is converted to CSV text here, so everything downstream — this parse, the dry
    // run, the commit — is the one CSV path with one set of edge cases. The dedup hash above was
    // taken on the bytes as received (the .xlsx itself), which is what the design requires.
    // The file is first read in a child process within the import limits (R-016); only a file that
    // passed is parsed here, so this process never meets a shape it cannot hold.
    let read;
    try {
      read = await parseImportIsolated(body, parse);
    } catch (error) {
      if (error instanceof ImportParseError) { refuseFile(req, res, error); return; }
      throw error;
    }
    const isXlsx = read.isXlsx;
    const stored = read.csvText === null ? body : Buffer.from(read.csvText, 'utf8');
    const table = parseCsv(stored.toString('utf8'), parse.limits);

    const id = randomUUID();
    // Keyed by run id, not by filename: the same unguessable-key reasoning as attachments,
    // and it keeps two files of the same name from colliding. Always stored as CSV text — an
    // .xlsx has been converted — so the run step re-parses it with the CSV parser.
    const key = `org/${orgId}/imports/${id}.csv`;
    try { assertValidKey(key); } catch (error) {
      if (error instanceof InvalidKeyError) throw new Error(`built an invalid storage key: ${key}`);
      throw error;
    }
    await storage.put(key, stored, { contentType: 'text/csv' });

    await req.tenant!(async (tx) => {
      if (previous) {
        // A deliberate re-import supersedes the old run rather than sitting beside it. The
        // uniqueness below is partial — at most one LIVE run per file per org — so without
        // this the database would refuse the upload the API just decided to allow.
        await tx.execute(sql`
          UPDATE import_run SET superseded_at = now()
          WHERE id = ${previous.id} AND org_id = ${orgId}`);
      }
      await tx.execute(sql`
        INSERT INTO import_run (id, org_id, source_type, filename, storage_key, sha256,
                                byte_size, status, row_count, headers)
        VALUES (${id}, ${orgId}, ${isXlsx ? 'xlsx' : 'csv'}, ${filename}, ${key}, ${sha256},
                ${body.byteLength},
                'uploaded', ${table.rows.length}, ${JSON.stringify(table.headers)}::jsonb)`);
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.importUploaded,
        targetType: 'import_run', targetId: id,
        after: { rows: table.rows.length, sha256, filename },
        ip: req.ip ?? null, requestId: String(req.id)
      });
    });

    const profiles = profileColumns(table.headers, table.rows, defaultCountry);
    res.status(201).json({
      data: {
        id, sha256, rowCount: table.rows.length, headers: table.headers,
        // Straight from the file, so a mapping is built from fact rather than guesswork.
        sample: table.rows.slice(0, 3),
        // Which column looks like the phone, email and name, judged by the values in the first rows
        // (not only the header), so the screen can pre-fill the pickers and warn about a bad choice.
        suggestions: suggestColumns(profiles),
        columns: profiles,
        reimportOf: previous?.id ?? null
      }
    });
  });

  /** Runs a mapping over an uploaded file. Dry run unless a commit is asked for explicitly. */
  router.post('/:id/run', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const parsed = runSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED',
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
        return;
      }

      const orgId = req.crm!.orgId;
      const runId = String(req.params.id);
      const found = await req.tenant!((tx) => tx.execute(sql`
        SELECT storage_key AS "storageKey", status FROM import_run
        WHERE id = ${runId} AND org_id = ${orgId}`));
      const run = (found as unknown as Array<{ storageKey: string; status: string }>)[0];
      if (!run) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such import.'));
        return;
      }
      if (run.status === 'committed') {
        // Committing twice would double every contact the file creates.
        res.status(409).json(problem(req, 409, 'ALREADY_COMMITTED',
          'This import has already been committed. Upload the file again to re-run it.'));
        return;
      }

      // Refuse a bad tag before any contact is written, not after.
      const wantTag = parsed.data.dryRun ? undefined : parsed.data.tag;
      if (wantTag !== undefined && 'id' in wantTag) {
        const t = await req.tenant!((tx) => tx.execute(sql`
          SELECT 1 FROM tag WHERE id = ${wantTag.id} AND org_id = ${orgId}`));
        if ((t as unknown as unknown[]).length === 0) {
          res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such tag.'));
          return;
        }
      }

      // Read through the child again: a file stored before the import limits existed has never been checked.
      const file = Buffer.from(await storage.get(run.storageKey));
      try {
        await parseImportIsolated(file, parse);
      } catch (error) {
        if (error instanceof ImportParseError) { refuseFile(req, res, error); return; }
        throw error;
      }
      const table = parseCsv(file.toString('utf8'), parse.limits);
      const mapping = parsed.data.mapping as ImportMapping;
      // One tenant transaction per batch of rows, opened through the same runner every other
      // route uses — so an import is subject to row-level security exactly like a request is.
      const summary = await runImport(req.tenant!, {
        orgId, importRunId: runId, table, mapping, dryRun: parsed.data.dryRun, actor: auditActor(req)
      });

      // Tagging happens in the same transaction that marks the run committed, so a run is never
      // "committed but untagged". A dry run tags nothing.
      let tagged: { id: string; count: number } | null = null;
      const result = await req.tenant!(async (tx) => {
        if (wantTag !== undefined) {
          const tagId = 'id' in wantTag ? wantTag.id : await ensureTag(tx, orgId, wantTag.name);
          tagged = { id: tagId, count: await tagImportRun(tx, orgId, runId, tagId) };
        }
        // `tagId` lets the screen link straight to the tagged people after a commit.
        const finalSummary = tagged === null ? summary : { ...summary, tagged: tagged.count, tagId: tagged.id };
        await tx.execute(sql`
          UPDATE import_run
          SET status = ${parsed.data.dryRun ? 'dry_run' : 'committed'},
              mapping = ${JSON.stringify(mapping)}::jsonb,
              summary = ${JSON.stringify(finalSummary)}::jsonb,
              completed_at = now()
          WHERE id = ${runId} AND org_id = ${orgId}`);
        await writeAudit(tx, {
          orgId, actor: auditActor(req),
          action: parsed.data.dryRun ? AUDIT.importDryRun : AUDIT.importCommitted,
          targetType: 'import_run', targetId: runId, after: finalSummary,
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return { summary: finalSummary };
      });

      res.json({ data: result.summary });
    });

  /**
   * Lists committed import runs, newest first — the ones a campaign can target as an audience.
   *
   * Superseded runs (re-imported over) are left out: their contacts belong to the newer run, so
   * targeting the old one would message an audience nobody would recognise. `contactCount` is the
   * distinct people it created or updated — the size of the audience it would become.
   */
  router.get('/', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT ir.id, ir.filename, ir.status, ir.created_at AS "createdAt",
             (SELECT count(DISTINCT r.contact_id)::int FROM import_row r
              WHERE r.import_run_id = ir.id AND r.outcome IN ('created', 'updated')) AS "contactCount"
      FROM import_run ir
      WHERE ir.org_id = ${req.crm!.orgId}
        AND ir.status = 'committed'
        AND ir.superseded_at IS NULL
      ORDER BY ir.created_at DESC
      LIMIT 100`));
    res.json({ data: rows });
  });

  /** The run, its summary, and the rows that went wrong. */
  router.get('/:id', requireUuidParam('id'), requireScope('contacts:read'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const runId = String(req.params.id);

      const result = await req.tenant!(async (tx) => {
        const runs = await tx.execute(sql`
          SELECT id, filename, sha256, byte_size AS "byteSize", status,
                 row_count AS "rowCount", headers, mapping, summary,
                 created_at AS "createdAt", completed_at AS "completedAt"
          FROM import_run WHERE id = ${runId} AND org_id = ${orgId}`);
        const run = (runs as unknown as Array<Record<string, unknown>>)[0];
        if (!run) return null;

        // Errors only. A successful row is in the ledger and countable, but nobody needs to
        // page through fifty thousand of them to find the forty-three that failed.
        const errors = await tx.execute(sql`
          SELECT row_number AS "rowNumber", error, raw FROM import_row
          WHERE import_run_id = ${runId} AND outcome = 'error'
          ORDER BY row_number LIMIT 200`);
        // Rows that imported but dropped something (a bad second phone number): same text column,
        // a successful outcome. Shown softly, never as failures.
        const warnings = await tx.execute(sql`
          SELECT row_number AS "rowNumber", error AS note, raw FROM import_row
          WHERE import_run_id = ${runId} AND outcome <> 'error' AND error IS NOT NULL
          ORDER BY row_number LIMIT 200`);
        return { run, errors, warnings };
      });

      if (result === null) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such import.'));
        return;
      }
      res.json({ data: { ...result.run, errors: result.errors, warnings: result.warnings } });
    });

  return router;
}
