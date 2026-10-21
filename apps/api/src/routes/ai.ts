import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { setTenant, tenantDatabase, type Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import type { LlmDriver } from '@crm/llm';
import { getAiSettings, saveAiSettings, AiSettingsRuleError, getAiNotice, autoReply } from '@crm/core';
import { auditActor, requireRole, requireScope } from '../auth.js';
import { requireUuidParam } from '../params.js';
import { problem } from '../problem.js';

/** Body for changing the AI assistant's settings. Every field is optional; at least one is needed. */
const changeSettings = z.object({
  enabled: z.boolean().optional(),
  instructions: z.string().max(8000).optional(),
  dailyMessageCap: z.number().int().min(1).max(5000).optional(),
  acceptConsent: z.boolean().optional()
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'give at least one setting');

/**
 * The AI assistant's settings. Admin only, and `requireRole` means a signed-in admin: an API key can never
 * switch the assistant on, because accepting the data-sharing note is a decision for a person.
 */
export function aiRouter(db: Database, kms: KmsDriver, getLlm: () => LlmDriver, tenantRole: string | null): Router {
  const router = Router();

  router.get('/settings', requireRole('admin'), async (req: Request, res: Response) => {
    res.json({ data: await getAiSettings(db, req.crm!.orgId) });
  });

  router.put('/settings', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = changeSettings.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    try {
      res.json({ data: await saveAiSettings(db, req.crm!.orgId, parsed.data, auditActor(req)) });
    } catch (error) {
      if (error instanceof AiSettingsRuleError) {
        res.status(422).json(problem(req, 422, 'AI_RULE', error.reason));
        return;
      }
      throw error;
    }
  });

  /**
   * Why the assistant is stuck on a conversation (anti-ban spacing, a do-not-contact flag, its daily limit, a model
   * error), or null. Anyone who can read the thread may see it: it is a warning, not a control.
   */
  router.get('/conversations/:id/notice', requireUuidParam('id'), requireScope('conversations:read'), async (req: Request, res: Response) => {
    res.json({ data: await getAiNotice(db, req.crm!.orgId, String(req.params.id)) });
  });

  /**
   * An admin lets the assistant answer the contact's latest message even though they are flagged do-not-contact.
   * One message, a written reason, audited, signed-in admin only; messaging someone who asked not to be contacted
   * puts the number at risk of reports and a ban. Nothing else the anti-ban engine holds back can be overridden.
   */
  router.post('/conversations/:id/allow-reply', requireUuidParam('id'), requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = z.object({ reason: z.string().trim().min(10).max(500) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Give a reason of at least 10 characters.'));
      return;
    }
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const llm = getLlm();
    if (llm.name === 'none') {
      res.status(409).json(problem(req, 409, 'AI_NOT_CONFIGURED', 'No AI model is configured on this server.'));
      return;
    }
    const latest = await db.transaction(async (tx) => {
      await setTenant(tx, orgId);
      return (await tx.execute(sql`
        SELECT id FROM message WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND direction = 'inbound'
        ORDER BY created_at DESC LIMIT 1`) as unknown as Array<{ id: string }>)[0]?.id;
    });
    if (latest === undefined) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation, or nothing to answer.'));
      return;
    }
    const tenantDb = tenantDatabase(db, orgId, tenantRole);
    const result = await autoReply({ db: tenantDb, kms, llm }, orgId, conversationId, latest, {
      dncOverride: { reason: parsed.data.reason, adminUserId: req.crm!.userId! }
    });
    res.json({ data: result });
  });

  return router;
}
