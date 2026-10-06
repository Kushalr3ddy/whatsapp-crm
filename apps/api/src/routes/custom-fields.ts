import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { CUSTOM_FIELD_TYPES, FIELD_KEY, writeAudit, AUDIT } from '@crm/core';
import { auditActor, requireRole, requireScope } from '../auth.js';
import { problem } from '../problem.js';

/** Body for defining a field. */
const createField = z.object({
  key: z.string().regex(FIELD_KEY, 'lower-case letters, digits and _, starting with a letter'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(CUSTOM_FIELD_TYPES).default('text'),
  options: z.array(z.string().trim().min(1).max(80)).max(50).default([])
}).refine((v) => v.type !== 'select' || v.options.length > 0, {
  message: 'a select field needs at least one option', path: ['options']
});

/**
 * Custom field definitions. Anyone who can read contacts can see them; only an admin changes the
 * vocabulary, since a rename or removal affects every contact and every `{{key}}` in a campaign.
 */
export function customFieldsRouter(): Router {
  const router = Router();

  router.get('/', requireScope('contacts:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT key, label, type, options FROM custom_field
      WHERE org_id = ${req.crm!.orgId} ORDER BY created_at`));
    res.json({ data: rows });
  });

  router.post('/', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = createField.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { key, label, type, options } = parsed.data;
    const orgId = req.crm!.orgId;
    const created = await req.tenant!(async (tx) => {
      const rows = await tx.execute(sql`
        INSERT INTO custom_field (org_id, key, label, type, options)
        VALUES (${orgId}, ${key}, ${label}, ${type},
                ${sql`ARRAY[${sql.join(options.map((o) => sql`${o}`), sql`, `)}]::text[]`})
        ON CONFLICT (org_id, key) DO NOTHING RETURNING key`);
      if ((rows as unknown as unknown[]).length === 0) return false;
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.customFieldCreated, targetType: 'custom_field',
        after: { key, type }, ip: req.ip ?? null, requestId: String(req.id)
      });
      return true;
    });
    if (!created) {
      res.status(409).json(problem(req, 409, 'FIELD_EXISTS', 'A field with this key already exists.'));
      return;
    }
    res.status(201).json({ data: { key, label, type, options } });
  });

  /** Removes a definition and clears its value from every contact, so nothing orphaned lingers. */
  router.delete('/:key', requireRole('admin'), async (req: Request, res: Response) => {
    const key = String(req.params.key);
    const orgId = req.crm!.orgId;
    const done = await req.tenant!(async (tx) => {
      const rows = await tx.execute(sql`
        DELETE FROM custom_field WHERE org_id = ${orgId} AND key = ${key} RETURNING key`);
      if ((rows as unknown as unknown[]).length === 0) return false;
      await tx.execute(sql`
        UPDATE contact SET custom_fields = custom_fields - ${key}
        WHERE org_id = ${orgId} AND custom_fields ? ${key}`);
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.customFieldDeleted, targetType: 'custom_field',
        after: { key }, ip: req.ip ?? null, requestId: String(req.id)
      });
      return true;
    });
    if (!done) { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such field.')); return; }
    res.status(204).end();
  });

  return router;
}
