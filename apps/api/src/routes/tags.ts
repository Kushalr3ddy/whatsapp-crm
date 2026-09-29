import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { requireScope } from '../auth.js';
import { requireUuidParam } from '../params.js';
import { problem } from '../problem.js';

/** Body for creating a tag: a label, and an optional colour for its chip. */
const createTag = z.object({
  name: z.string().trim().min(1).max(60),
  colour: z.string().trim().max(20).optional()
});

/**
 * Tags — flat labels on contacts (`vip`, `pune`). This router owns the tags themselves; attaching
 * one to a contact lives on the contacts router (`/contacts/:id/tags`), next to the contact.
 */
export function tagsRouter(): Router {
  const router = Router();

  /** Lists the org's tags with how many contacts carry each — for a tag bar or picker. */
  router.get('/', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT t.id, t.name, t.colour,
             (SELECT count(*)::int FROM contact_tag ct WHERE ct.tag_id = t.id) AS "contactCount"
      FROM tag t
      WHERE t.org_id = ${req.crm!.orgId}
      ORDER BY t.name ASC`));
    res.json({ data: rows });
  });

  /** Creates a tag. Unique per org, so a repeat name is a 409 rather than a duplicate. */
  router.post('/', requireScope('contacts:write'), async (req: Request, res: Response) => {
    const parsed = createTag.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { name, colour } = parsed.data;
    // ON CONFLICT rather than check-then-insert, so two requests racing on the same name cannot
    // both create it — the unique index decides, and a losing insert returns no row.
    const rows = await req.tenant!((tx) => tx.execute(sql`
      INSERT INTO tag (org_id, name, colour)
      VALUES (${req.crm!.orgId}, ${name}, ${colour ?? null})
      ON CONFLICT (org_id, name) DO NOTHING
      RETURNING id, name, colour`));
    const created = (rows as unknown as unknown[])[0];
    if (created === undefined) {
      res.status(409).json(problem(req, 409, 'TAG_EXISTS', `A tag named "${name}" already exists.`));
      return;
    }
    res.status(201).json({ data: created });
  });

  /** Deletes a tag; its `contact_tag` links cascade away with it. */
  router.delete('/:id', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const rows = await req.tenant!((tx) => tx.execute(sql`
        DELETE FROM tag WHERE id = ${req.params.id} AND org_id = ${req.crm!.orgId} RETURNING id`));
      if ((rows as unknown as unknown[]).length === 0) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such tag.'));
        return;
      }
      res.status(204).end();
    });

  return router;
}
