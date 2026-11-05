import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { setTenant, tenantDatabase, type Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import {
  PROVIDERS, providerById, providerFor, listModels, probeLlm, assertSafeBaseUrl, UnsafeUrlError, defaultBaseUrl,
  readLlmEnv, writeLlmEnv, LlmError, type LlmDriver, type LlmConfig, type LiveLlm, type ProviderPreset
} from '@crm/llm';
import {
  enqueueAiJob, listAiJobs, cancelAiJob, AiJobError, type QueueViewer,
  getAiSettings, saveAiSettings, AiSettingsRuleError, getAiNotice, autoReply, runAiCommand, draftCampaignText, AiCommandError,
  auditLlmChange, generateTemplate, listTemplates, getTemplate, AI_ALWAYS_ON_RULES, saveTemplate, useTemplate, deleteTemplate, AiTemplateError
} from '@crm/core';
import { auditActor, requireRole, requireScope } from '../auth.js';
import { requireUuidParam } from '../params.js';
import type { AiJobRunner } from '../ai-runner.js';
import { problem } from '../problem.js';

/** Body for changing the AI assistant's settings. Every field is optional; at least one is needed. */
const changeSettings = z.object({
  enabled: z.boolean().optional(),
  instructions: z.string().max(8000).optional(),
  dailyMessageCap: z.number().int().min(1).max(5000).optional(),
  mayStartCampaigns: z.boolean().optional(),
  acceptConsent: z.boolean().optional()
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'give at least one setting');

/**
 * The AI assistant's settings. Admin only, and `requireRole` means a signed-in admin: an API key can never
 * switch the assistant on, because accepting the data-sharing note is a decision for a person.
 */
export function aiRouter(
  db: Database, kms: KmsDriver, getLlm: () => LlmDriver, tenantRole: string | null, runner: AiJobRunner,
  llmSettings: { live: LiveLlm; envFile: string; allowPrivate: boolean; injected: boolean }
): Router {
  const router = Router();

  /** Whether the assistant is on, so screens can offer its helpers. Anyone signed in may ask; it reveals nothing else. */
  router.get('/status', requireScope('conversations:read'), async (req: Request, res: Response) => {
    res.json({ data: { enabled: (await getAiSettings(db, req.crm!.orgId)).enabled } });
  });

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
   * Why the assistant is stuck on a conversation (a number that is not connected, a do-not-contact flag, its daily limit, a model
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

  /**
   * After a person hands a chat to the assistant: have it answer the contact's latest message now, if that message is still
   * waiting for an answer. Assigning is the ordinary thread update; this only starts the answer, so it never changes who owns
   * the chat, and `autoReply` itself refuses unless the chat really is assigned to the assistant and every anti-ban rule holds.
   * Returns at once; the answer arrives in the thread like any other.
   */
  router.post('/conversations/:id/answer-now', requireUuidParam('id'), requireScope('conversations:write'), async (req: Request, res: Response) => {
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
        SELECT id, direction FROM message WHERE org_id = ${orgId} AND conversation_id = ${conversationId}
        ORDER BY created_at DESC LIMIT 1`) as unknown as Array<{ id: string; direction: string }>)[0];
    });
    // Nothing waiting: the last word was ours, or the chat is empty. The assistant answers the contact's next message on its own.
    if (latest === undefined || latest.direction !== 'inbound') {
      res.json({ data: { answering: false } });
      return;
    }
    void autoReply({ db: tenantDatabase(db, orgId, tenantRole), kms, llm }, orgId, conversationId, latest.id).catch(() => undefined);
    res.json({ data: { answering: true } });
  });

  /**
   * Tells the assistant, in plain language, to run campaigns: create one, pause, resume or edit. A signed-in admin, or an
   * API key that may send messages (which could create and start campaigns directly anyway). The assistant goes through
   * the same checks as a person, can never lift an anti-ban or do-not-contact gate, and only starts a campaign if the org
   * allowed it. The answer lists what it did and what it refused.
   */
  router.post('/commands', requireScope('messages:send'), async (req: Request, res: Response) => {
    if (req.crm!.kind === 'session' && req.crm!.role !== 'admin') {
      res.status(403).json(problem(req, 403, 'FORBIDDEN', 'Only an admin can instruct the AI assistant.'));
      return;
    }
    const parsed = z.object({ instruction: z.string().trim().min(3).max(2000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Write what you want the assistant to do (3 to 2000 characters).'));
      return;
    }
    const orgId = req.crm!.orgId;
    try {
      const result = await runAiCommand({ db: tenantDatabase(db, orgId, tenantRole), kms, llm: getLlm() }, orgId, req.crm!.userId, parsed.data.instruction);
      res.json({ data: result });
    } catch (error) {
      if (error instanceof AiCommandError) {
        res.status(error.code === 'ai_off' ? 409 : 502).json(problem(req, error.code === 'ai_off' ? 409 : 502, error.code === 'ai_off' ? 'AI_OFF' : 'AI_UNAVAILABLE', error.message));
        return;
      }
      throw error;
    }
  });

  /** Who is looking at the queue: admins and API keys see everyone's requests, anyone else only their own. */
  const viewerOf = (req: Request): QueueViewer => ({
    userId: req.crm!.userId, seesAll: req.crm!.kind !== 'session' || req.crm!.role === 'admin'
  });

  /**
   * Puts a request in the AI queue: `command` (an instruction, admins and message-sending API keys) or `draft` (campaign
   * wording, anyone signed in). It runs when its turn comes, one at a time per org, and answers at once with its id.
   */
  router.post('/jobs', requireScope('messages:send'), async (req: Request, res: Response) => {
    const parsed = z.object({ kind: z.enum(['command', 'draft']), input: z.string().trim().min(3).max(2000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Say what you want (3 to 2000 characters).'));
      return;
    }
    if (parsed.data.kind === 'command' && req.crm!.kind === 'session' && req.crm!.role !== 'admin') {
      res.status(403).json(problem(req, 403, 'FORBIDDEN', 'Only an admin can instruct the AI assistant.'));
      return;
    }
    const orgId = req.crm!.orgId;
    try {
      const { id } = await enqueueAiJob(tenantDatabase(db, orgId, tenantRole), orgId, {
        kind: parsed.data.kind, input: parsed.data.input, requestedBy: req.crm!.userId
      });
      runner.kick(orgId);
      res.status(202).json({ data: { id } });
    } catch (error) {
      if (error instanceof AiJobError) { res.status(429).json(problem(req, 429, 'QUEUE_FULL', error.message)); return; }
      throw error;
    }
  });

  /** The queue: what is waiting (with its place in line), what is running, and the last day's finished requests. */
  router.get('/jobs', requireScope('messages:send'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    res.json({ data: await listAiJobs(tenantDatabase(db, orgId, tenantRole), orgId, viewerOf(req)) });
  });

  /** Cancels a request that has not started. One already running cannot be stopped. */
  router.post('/jobs/:id/cancel', requireUuidParam('id'), requireScope('messages:send'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const outcome = await cancelAiJob(tenantDatabase(db, orgId, tenantRole), orgId, String(req.params.id), viewerOf(req));
    if (outcome === 'cancelled') { res.json({ data: { id: String(req.params.id), status: 'cancelled' } }); return; }
    if (outcome === 'not_found') { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such request.')); return; }
    if (outcome === 'forbidden') { res.status(403).json(problem(req, 403, 'FORBIDDEN', 'That request is not yours to cancel.')); return; }
    res.status(409).json(problem(req, 409, 'NOT_QUEUED', 'It has already started or finished, so it cannot be cancelled.'));
  });

  /** Writes campaign wording from a short goal, for the campaign form. Creates and sends nothing. */
  router.post('/draft-campaign-text', requireScope('messages:send'), async (req: Request, res: Response) => {
    const parsed = z.object({ goal: z.string().trim().min(3).max(1000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Describe what the message should do (3 to 1000 characters).'));
      return;
    }
    const orgId = req.crm!.orgId;
    try {
      res.json({ data: { body: await draftCampaignText({ db: tenantDatabase(db, orgId, tenantRole), llm: getLlm() }, orgId, parsed.data.goal) } });
    } catch (error) {
      if (error instanceof AiCommandError) {
        res.status(error.code === 'ai_off' ? 409 : 502).json(problem(req, error.code === 'ai_off' ? 409 : 502, error.code === 'ai_off' ? 'AI_OFF' : 'AI_UNAVAILABLE', error.message));
        return;
      }
      throw error;
    }
  });

  // ---- AI settings: which provider, key and model the install uses (D-9) ---------------------------------------------------
  // Admin session only (an API key can never change it). The key is never returned; the settings are written to the env file that the API and
  // the gateway re-read, so a change applies from the next model call with no restart.

  const llmCalls = new Map<string, number[]>();
  /** At most ten model-settings calls (listing, testing, saving) per organisation per minute; testing costs a little money. */
  const underLlmLimit = (orgId: string): boolean => {
    const now = Date.now();
    const recent = (llmCalls.get(orgId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 10) { llmCalls.set(orgId, recent); return false; }
    recent.push(now); llmCalls.set(orgId, recent);
    return true;
  };

  const llmInput = z.object({
    provider: z.string().min(1).max(40),
    baseUrl: z.string().trim().max(500).optional(),
    apiKey: z.string().trim().max(500).optional(),
    model: z.string().trim().max(200).optional()
  });

  /** What a settings call means once the page's choices are resolved against what is saved: the model configuration, the preset, and whether the key was typed now. */
  async function resolveLlm(body: z.infer<typeof llmInput>): Promise<{ config: LlmConfig; preset: ProviderPreset; baseUrl: string; keyTyped: boolean } | { error: string }> {
    const preset = providerById(body.provider);
    if (preset === undefined) return { error: 'Choose a provider from the list.' };
    const saved = await readLlmEnv(llmSettings.envFile);
    const status = llmSettings.live.status();
    // A key left blank means "keep the saved one", but only for the same provider; a key is never carried to a different service.
    const sameProvider = providerFor(status.driver, status.baseUrl ?? undefined)?.id === preset.id;
    const keyTyped = body.apiKey !== undefined && body.apiKey !== '';
    const apiKey = keyTyped ? body.apiKey! : sameProvider ? (saved.LLM_API_KEY ?? '') : '';
    if (preset.needsKey && apiKey === '') return { error: 'Enter the API key.' };
    const baseUrl = preset.baseUrl ?? (preset.id === 'custom' ? body.baseUrl ?? '' : defaultBaseUrl(preset.driver) ?? '');
    if (baseUrl === '') return { error: 'Enter the address of the service.' };
    try { await assertSafeBaseUrl(baseUrl, { ollama: preset.id === 'ollama', allowPrivate: llmSettings.allowPrivate }); }
    catch (error) { return { error: error instanceof UnsafeUrlError ? error.message : 'That address cannot be used.' }; }
    const timeout = Number(saved.LLM_TIMEOUT_MS);
    return {
      preset, baseUrl, keyTyped,
      config: {
        LLM_DRIVER: preset.driver, LLM_MODEL: body.model !== undefined && body.model !== '' ? body.model : undefined,
        LLM_API_KEY: apiKey === '' ? undefined : apiKey, LLM_BASE_URL: baseUrl,
        LLM_TIMEOUT_MS: Number.isFinite(timeout) && timeout >= 1000 ? timeout : 60000
      }
    };
  }

  /** The providers the page offers and what is in use now. Anyone signed in may see it; only an admin sees the last four characters of the key. */
  router.get('/llm', requireScope('conversations:read'), (req: Request, res: Response) => {
    const status = llmSettings.live.status();
    const isAdmin = req.crm!.kind !== 'session' || req.crm!.role === 'admin';
    res.json({
      data: {
        ...status, keyLast4: isAdmin ? status.keyLast4 : null, baseUrl: isAdmin ? status.baseUrl : null,
        provider: providerFor(status.driver, status.baseUrl ?? undefined)?.id ?? null,
        providers: PROVIDERS, ready: llmSettings.live.name !== 'none' || llmSettings.injected
      }
    });
  });

  /** The models this provider and key offer, for the picker. A blank key reuses the saved one for the same provider. */
  router.post('/llm/models', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = llmInput.safeParse(req.body);
    if (!parsed.success) { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Choose a provider and enter the key.')); return; }
    if (!underLlmLimit(req.crm!.orgId)) { res.status(429).json(problem(req, 429, 'RATE_LIMITED', 'That is a lot of requests. Wait a minute and try again.')); return; }
    const r = await resolveLlm(parsed.data);
    if ('error' in r) { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', r.error)); return; }
    try {
      res.json({ data: await listModels({ preset: r.preset, baseUrl: r.baseUrl, apiKey: r.config.LLM_API_KEY ?? '' }) });
    } catch (error) {
      const detail = error instanceof LlmError && (error.statusCode === 401 || error.statusCode === 403)
        ? 'The provider refused the key. Check that it is correct.' : error instanceof LlmError ? error.message : 'Could not list the models.';
      res.status(502).json(problem(req, 502, 'PROVIDER_ERROR', `${detail} You can still type a model name yourself.`));
    }
  });

  /** Tests a model with two tiny real calls. Saves nothing. */
  router.post('/llm/test', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = llmInput.safeParse(req.body);
    if (!parsed.success || parsed.data.model === undefined || parsed.data.model === '') { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Choose a provider, enter the key and pick a model.')); return; }
    if (!underLlmLimit(req.crm!.orgId)) { res.status(429).json(problem(req, 429, 'RATE_LIMITED', 'That is a lot of requests. Wait a minute and try again.')); return; }
    const r = await resolveLlm(parsed.data);
    if ('error' in r) { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', r.error)); return; }
    res.json({ data: await probeLlm(r.config) });
  });

  /**
   * Makes this the model the install uses from now on: tests it first (unless `anyway` is sent after a failed test the admin chose to ignore),
   * then writes the `LLM_*` lines to the env file. Audited without the key.
   */
  router.put('/llm', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = llmInput.extend({ anyway: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success || parsed.data.model === undefined || parsed.data.model === '') { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Choose a provider, enter the key and pick a model.')); return; }
    const orgId = req.crm!.orgId;
    if (!underLlmLimit(orgId)) { res.status(429).json(problem(req, 429, 'RATE_LIMITED', 'That is a lot of requests. Wait a minute and try again.')); return; }
    const r = await resolveLlm(parsed.data);
    if ('error' in r) { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', r.error)); return; }
    let tested = false;
    if (parsed.data.anyway !== true) {
      const result = await probeLlm(r.config);
      if (!result.usable) { res.status(422).json(problem(req, 422, 'TEST_FAILED', `${result.problem ?? 'The test failed.'} Nothing was changed.`)); return; }
      tested = true;
    }
    await writeLlmEnv(llmSettings.envFile, {
      LLM_DRIVER: r.preset.driver, LLM_MODEL: r.config.LLM_MODEL, LLM_API_KEY: r.config.LLM_API_KEY,
      LLM_BASE_URL: r.preset.driver === 'compatible' || r.preset.id === 'ollama' ? r.baseUrl : undefined,
      LLM_TIMEOUT_MS: String(r.config.LLM_TIMEOUT_MS)
    });
    await auditLlmChange(db, orgId, auditActor(req), {
      provider: r.preset.id, model: r.config.LLM_MODEL ?? null, baseUrlHost: new URL(r.baseUrl).hostname, keyReplaced: r.keyTyped, tested
    });
    const status = llmSettings.live.status();
    res.json({ data: { ...status, provider: providerFor(status.driver, status.baseUrl ?? undefined)?.id ?? null } });
  });

  /** Turns the model off: the assistant keeps its settings but cannot answer until a model is set again. The key is removed from the file. */
  router.delete('/llm', requireRole('admin'), async (req: Request, res: Response) => {
    await writeLlmEnv(llmSettings.envFile, { LLM_DRIVER: 'none', LLM_MODEL: undefined, LLM_API_KEY: undefined, LLM_BASE_URL: undefined });
    await auditLlmChange(db, req.crm!.orgId, auditActor(req), { provider: 'none', model: null, baseUrlHost: null, keyReplaced: false, tested: false });
    res.status(204).end();
  });

  // ---- Templates: describe in plain words, the AI writes the instructions, save, pick again ----------------------------

  /** At most this many generations per organisation per minute, so one org cannot run up the bill or the provider's rate limit. */
  const generations = new Map<string, number[]>();
  const GENERATIONS_PER_MINUTE = 5;
  const underRateLimit = (orgId: string): boolean => {
    const now = Date.now();
    const recent = (generations.get(orgId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= GENERATIONS_PER_MINUTE) { generations.set(orgId, recent); return false; }
    recent.push(now);
    generations.set(orgId, recent);
    return true;
  };

  /** Turns a template error into a response. */
  const templateProblem = (req: Request, res: Response, error: AiTemplateError): void => {
    const status = { too_long: 422, invalid: 422, ai_off: 409, not_found: 404, no_model: 502 }[error.code];
    const code = { too_long: 'TOO_LONG', invalid: 'VALIDATION_FAILED', ai_off: 'AI_OFF', not_found: 'NOT_FOUND', no_model: 'AI_UNAVAILABLE' }[error.code];
    res.status(status).json(problem(req, status, code, error.message));
  };

  /** Writes a template from a plain-words description. Saves nothing. Admin, and limited to a few a minute. */
  router.post('/templates/generate', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = z.object({ description: z.string().max(20000), answers: z.array(z.string().max(500)).max(10).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Send { "description": "..." }.'));
      return;
    }
    const orgId = req.crm!.orgId;
    if (!underRateLimit(orgId)) {
      res.status(429).json(problem(req, 429, 'RATE_LIMITED', 'That is a lot of requests. Wait a minute and try again.'));
      return;
    }
    try {
      res.json({ data: await generateTemplate({ db: tenantDatabase(db, orgId, tenantRole), llm: getLlm() }, orgId, parsed.data.description, parsed.data.answers ?? []) });
    } catch (error) {
      if (error instanceof AiTemplateError) { templateProblem(req, res, error); return; }
      throw error;
    }
  });

  /** The fixed always-on rules, so the page can show exactly what is added in front of every set of instructions. */
  router.get('/always-on-rules', requireRole('admin'), (_req: Request, res: Response) => {
    res.json({ data: AI_ALWAYS_ON_RULES });
  });

  router.get('/templates', requireRole('admin'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    res.json({ data: await listTemplates(tenantDatabase(db, orgId, tenantRole), orgId) });
  });

  router.get('/templates/:id', requireUuidParam('id'), requireRole('admin'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const found = await getTemplate(tenantDatabase(db, orgId, tenantRole), orgId, String(req.params.id));
    if (found === null) { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such template.')); return; }
    res.json({ data: found });
  });

  router.post('/templates', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = z.object({
      id: z.string().uuid().optional(), name: z.string().max(200), description: z.string().max(20000),
      instructions: z.string().max(60000), audience: z.string().max(1000).default(''), firstMessage: z.string().max(4000).default('')
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    try {
      res.json({ data: await saveTemplate(tenantDatabase(db, orgId, tenantRole), orgId, parsed.data, auditActor(req)) });
    } catch (error) {
      if (error instanceof AiTemplateError) { templateProblem(req, res, error); return; }
      throw error;
    }
  });

  router.post('/templates/:id/use', requireUuidParam('id'), requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = z.object({ setAsDefault: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) { res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'Send { "setAsDefault": true } or nothing.')); return; }
    const orgId = req.crm!.orgId;
    try {
      res.json({ data: await useTemplate(tenantDatabase(db, orgId, tenantRole), orgId, String(req.params.id), { setAsDefault: parsed.data.setAsDefault === true }, auditActor(req)) });
    } catch (error) {
      if (error instanceof AiTemplateError) { templateProblem(req, res, error); return; }
      if (error instanceof AiSettingsRuleError) { res.status(422).json(problem(req, 422, 'AI_RULE', error.reason)); return; }
      throw error;
    }
  });

  router.delete('/templates/:id', requireUuidParam('id'), requireRole('admin'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const gone = await deleteTemplate(tenantDatabase(db, orgId, tenantRole), orgId, String(req.params.id), auditActor(req));
    if (!gone) { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such template.')); return; }
    res.status(204).end();
  });

  return router;
}
