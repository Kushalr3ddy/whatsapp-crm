import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { countSegmentMatches, type SegmentDefinition } from '@crm/core';
import { requireScope } from '../auth.js';
import { requireUuidParam } from '../params.js';
import { problem } from '../problem.js';

/**
 * The allowlisted segment filter. `.strict()` rejects any unknown key with a clean 422 — so a
 * definition can only ever contain the criteria the engine understands. Safety does not depend on
 * this (the engine binds every value and ignores unknown keys), but it turns a typo into a clear
 * error rather than a silently-ignored filter.
 */
const definitionSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(20).optional(),
  replied: z.enum(['ever', 'never']).optional(),
  lastContactedWithinDays: z.coerce.number().int().min(1).max(3650).optional()
}).strict();

/** Body for creating a segment: a name and its filter. */
const createSegment = z.object({
  name: z.string().trim().min(1).max(100),
  definition: definitionSchema,
  /** False for a one-off audience built inline in a campaign: usable, but not listed for reuse. */
  saved: z.boolean().default(true)
});

/** Body for a preview: just the filter, to count matches before saving. */
const previewSegment = z.object({ definition: definitionSchema });

/**
 * Dynamic segments — saved, criteria-based audiences (docs/21-deferred.md D-28). A segment stores a
 * small allowlisted filter; a campaign can target it, and it resolves and freezes at launch like
 * every other audience. The injection-critical translation to SQL lives in `@crm/core`.
 */
export function segmentsRouter(): Router {
  const router = Router();

  /** Lists the org's segments, each with how many contacts it matches right now. */
  router.get('/', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const data = await req.tenant!(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id, name, definition, created_at AS "createdAt"
        FROM segment WHERE org_id = ${orgId} AND saved ORDER BY name ASC`);
      const segments = rows as unknown as Array<{
        id: string; name: string; definition: SegmentDefinition; createdAt: string;
      }>;
      // The live count is the point of a *dynamic* segment, so compute it per row rather than
      // trusting a cached number that drifts the moment a contact replies.
      return Promise.all(segments.map(async (s) => ({
        id: s.id, name: s.name, definition: s.definition, createdAt: s.createdAt,
        contactCount: await countSegmentMatches(tx, orgId, s.definition)
      })));
    });
    res.json({ data });
  });

  /** Counts the contacts a filter matches right now — for the builder, before saving. */
  router.post('/preview', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const parsed = previewSegment.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const count = await req.tenant!((tx) => countSegmentMatches(tx, orgId, parsed.data.definition));
    res.json({ data: { count } });
  });

  /** Creates a segment. Name unique per org, so a repeat is a 409 rather than a duplicate. */
  router.post('/', requireScope('contacts:write'), async (req: Request, res: Response) => {
    const parsed = createSegment.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { name, definition, saved } = parsed.data;
    const rows = await req.tenant!((tx) => tx.execute(sql`
      INSERT INTO segment (org_id, name, kind, definition, saved)
      VALUES (${req.crm!.orgId}, ${name}, 'dynamic', ${JSON.stringify(definition)}::jsonb, ${saved})
      ON CONFLICT (org_id, name) DO NOTHING
      RETURNING id, name, definition`));
    const created = (rows as unknown as unknown[])[0];
    if (created === undefined) {
      res.status(409).json(problem(req, 409, 'SEGMENT_EXISTS',
        `A segment named "${name}" already exists.`));
      return;
    }
    res.status(201).json({ data: created });
  });

  /** Deletes a segment. A campaign that targeted it keeps its already-frozen recipients (FK nulls). */
  router.delete('/:id', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const rows = await req.tenant!((tx) => tx.execute(sql`
        DELETE FROM segment WHERE id = ${req.params.id} AND org_id = ${req.crm!.orgId}
        RETURNING id`));
      if ((rows as unknown as unknown[]).length === 0) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such segment.'));
        return;
      }
      res.status(204).end();
    });

  return router;
}
