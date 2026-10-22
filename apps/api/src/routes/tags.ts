import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  resolveTarget, countMatching, bulkTag, bulkUntag, deleteTag, writeAudit, AUDIT, type TagTarget
} from '@crm/core';
import { auditActor, requireScope } from '../auth.js';
import { requireUuidParam } from '../params.js';
import { problem } from '../problem.js';

/** Body for creating a tag: a label, and an optional colour for its chip. */
const createTag = z.object({
  name: z.string().trim().min(1).max(60),
  colour: z.string().trim().max(20).optional()
});

/** A calendar day, `YYYY-MM-DD`. */
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Body for tagging or untagging many contacts at once. The audience is a `target` resolved on the
 * server. It is a dry run unless `dryRun: false` is sent, like an import; `expectedCount` (the number a
 * preview returned) makes a commit refuse if the audience has changed underneath it.
 */
const bulkBody = z.object({
  action: z.enum(['add', 'remove']),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({
      kind: z.literal('search'), q: z.string().trim().max(100).optional(), tagId: z.string().uuid().optional(),
      from: dayString.optional(), to: dayString.optional(), dateBy: z.enum(['added', 'imported']).optional()
    }),
    z.object({ kind: z.literal('segment'), segmentId: z.string().uuid() }),
    z.object({ kind: z.literal('ids'), ids: z.array(z.string().uuid()).min(1).max(5000) })
  ]),
  dryRun: z.boolean().default(true),
  expectedCount: z.number().int().min(0).optional()
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

  /**
   * Adds or removes this tag across many contacts in one statement: everyone, everyone matching a
   * search / tag filter, everyone in a segment, or an explicit list. Previews by default. Tagging
   * *everyone* is admin-only. Do-not-contact people are tagged like anyone else — tagging is not
   * messaging, and the send gate is what stops a message to them.
   */
  router.post('/:id/bulk', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const parsed = bulkBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
        return;
      }
      const { action, dryRun, expectedCount } = parsed.data;
      const target = parsed.data.target as TagTarget;
      if (target.kind === 'all' && !dryRun
        && !(req.crm!.kind === 'session' && req.crm!.role === 'admin')) {
        res.status(403).json(problem(req, 403, 'FORBIDDEN', 'Only an admin can tag everyone at once.'));
        return;
      }
      const orgId = req.crm!.orgId;
      const tagId = String(req.params.id);

      const outcome = await req.tenant!(async (tx) => {
        const tag = await tx.execute(sql`SELECT 1 FROM tag WHERE id = ${tagId} AND org_id = ${orgId}`);
        if ((tag as unknown as unknown[]).length === 0) return { error: 'no_tag' as const };
        const predicate = await resolveTarget(tx, orgId, target);
        if (predicate === null) return { error: 'no_segment' as const };

        const matched = await countMatching(tx, predicate);
        if (dryRun) return { matched, changed: 0 };
        if (expectedCount !== undefined && expectedCount !== matched) {
          return { error: 'count_changed' as const, matched };
        }
        const changed = action === 'add'
          ? await bulkTag(tx, orgId, tagId, predicate)
          : await bulkUntag(tx, orgId, tagId, predicate);
        await writeAudit(tx, {
          orgId, actor: auditActor(req),
          action: action === 'add' ? AUDIT.contactsBulkTagged : AUDIT.contactsBulkUntagged,
          targetType: 'tag', targetId: tagId,
          after: { target: target.kind, matched, changed },
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return { matched, changed };
      });

      if ('error' in outcome) {
        if (outcome.error === 'count_changed') {
          res.status(409).json({
            ...problem(req, 409, 'COUNT_CHANGED',
              `The audience changed: ${String(outcome.matched)} people match now. Review and confirm again.`),
            matched: outcome.matched
          });
          return;
        }
        const detail = outcome.error === 'no_tag' ? 'No such tag.' : 'No such segment.';
        res.status(404).json(problem(req, 404, 'NOT_FOUND', detail));
        return;
      }
      res.json({ data: { action, dryRun, matched: outcome.matched, changed: outcome.changed } });
    });

  /**
   * Deletes a tag (needs the contacts:write scope, audited). Everyone who carried it is untagged; no contact and no
   * campaign is deleted.
   */
  router.delete('/:id', requireUuidParam('id'), requireScope('contacts:write'),
    async (req: Request, res: Response) => {
      const orgId = req.crm!.orgId;
      const tagId = String(req.params.id);
      const gone = await req.tenant!(async (tx) => {
        const done = await deleteTag(tx, orgId, tagId);
        if (done === null) return false;
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.tagDeleted, targetType: 'tag', targetId: tagId,
          before: { name: done.name, contactCount: done.contactCount },
          ip: req.ip ?? null, requestId: String(req.id)
        });
        return true;
      });
      if (!gone) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such tag.'));
        return;
      }
      res.status(204).end();
    });

  return router;
}
