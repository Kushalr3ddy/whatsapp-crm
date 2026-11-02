import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { writeAudit, AUDIT, loadAntiBanSettings, saveAntiBanSettings, missingContactDetails, type AntiBanSettings } from '@crm/core';
import { auditActor, requireRole } from '../auth.js';
import { problem } from '../problem.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM, 24 hours');
const zone = z.string().min(1).max(64).refine((z) => {
  try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; }
}, 'not a time zone name, e.g. Asia/Kolkata');
/** A contact detail that may be cleared by sending an empty string or null. */
const optionalText = (max: number) => z.union([z.string().trim().max(max), z.null()]).transform((v) => (v === null || v === '' ? null : v));
const words = z.array(z.string().trim().min(1).max(60)).max(50);

/** Body for changing the org's sending settings. Every field is optional; at least one is needed. */
const changeSettings = z.object({
  closingMessageEnabled: z.boolean().optional(),
  contactPhone: optionalText(40).optional(),
  contactEmail: z.union([z.string().trim().email().max(200), z.literal(''), z.null()]).transform((v) => (v === null || v === '' ? null : v)).optional(),
  defaultPurpose: optionalText(300).optional(),
  stopWords: words.optional(),
  restartWords: words.optional(),
  quietHours: z.object({
    enabled: z.boolean().optional(), start: hhmm.optional(), end: hhmm.optional(), timeZone: zone.optional()
  }).optional()
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'give at least one setting');

/** What the settings page shows: the settings, and which contact details the closing message is still missing. */
const view = (s: AntiBanSettings) => ({ ...s, missing: missingContactDetails(s) });

/**
 * The org's sending settings (F6 AC-6.7): the closing message when someone opts out (on or off, the contact number and email it quotes,
 * a default purpose), the org's own stop and restart words, and the quiet hours. Admin only, like the AI settings. `missing` lists the
 * contact details that are not set yet, so the page can ask for them.
 */
export function antibanRouter(): Router {
  const router = Router();

  router.get('/settings', requireRole('admin'), async (req: Request, res: Response) => {
    const settings = await req.tenant!((tx) => loadAntiBanSettings(tx, req.crm!.orgId));
    res.json({ data: view(settings) });
  });

  router.put('/settings', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = changeSettings.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const saved = await req.tenant!(async (tx) => {
      const before = await loadAntiBanSettings(tx, orgId);
      const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
      const after = await saveAntiBanSettings(tx, orgId, patch);
      await writeAudit(tx, {
        orgId, actor: auditActor(req), action: AUDIT.antibanSettingsChanged, targetType: 'org', targetId: orgId,
        before: { closingMessageEnabled: before.closingMessageEnabled }, after: { changed: Object.keys(patch) },
        ip: req.ip ?? null, requestId: String(req.id)
      });
      return after;
    });
    res.json({ data: view(saved) });
  });

  return router;
}
