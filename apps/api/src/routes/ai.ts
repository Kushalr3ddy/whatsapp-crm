import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Database } from '@crm/db';
import { getAiSettings, saveAiSettings, AiSettingsRuleError } from '@crm/core';
import { auditActor, requireRole } from '../auth.js';
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
export function aiRouter(db: Database): Router {
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

  return router;
}
