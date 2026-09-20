import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Database } from '@crm/db';
import type { PasswordHasher } from '@crm/auth-builtin';
import {
  createOrgWithAdmin, addUserToOrg, issueApiKey, listApiKeys, revokeApiKey,
  API_SCOPES, AlreadyExistsError, writeAuditInTenant, AUDIT
} from '@crm/core';
import { auditActor, requireBootstrap, requireRole } from '../auth.js';

/** Body for provisioning an organisation and its first admin. */
const createOrg = z.object({
  orgName: z.string().min(1).max(200),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens'),
  email: z.string().email(),
  password: z.string().min(12, 'at least 12 characters').max(512),
  displayName: z.string().min(1).max(200)
});

/** Body for minting an API key. */
const createKey = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'a key with no scopes can do nothing'),
  /** Only the bootstrap key supplies this; a signed-in admin's org comes from their session. */
  orgId: z.string().uuid().optional()
});

/** Body for inviting someone into an org. */
const createUser = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'at least 12 characters').max(512),
  displayName: z.string().min(1).max(200),
  role: z.enum(['admin', 'agent'])
});

/** Builds an RFC 7807 problem body with the real status in it. */
function problem(req: Request, status: number, code: string, detail: string) {
  return { type: 'about:blank', title: code, status, code, detail, request_id: req.id };
}

/** Turns Zod issues into one readable line. */
function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

/**
 * Provisioning and key management.
 *
 * Two distinct audiences, which is why the guards differ per route: the deployment-level
 * bootstrap key can bring an organisation into existence and mint its first key — and can do
 * nothing else anywhere — while everything afterwards belongs to a signed-in admin of that org.
 */
export function adminRouter(db: Database, hasher: PasswordHasher): Router {
  const router = Router();

  /** Creates an org and its first admin. The only way in, for a brand-new deployment. */
  router.post('/orgs', requireBootstrap, async (req: Request, res: Response) => {
    const parsed = createOrg.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', issues(parsed.error)));
      return;
    }
    try {
      const result = await createOrgWithAdmin(db, hasher, parsed.data, auditActor(req));
      res.status(201).json({ data: result });
    } catch (error) {
      if (error instanceof AlreadyExistsError) {
        res.status(409).json(problem(req, 409, 'ALREADY_EXISTS', `That ${error.field} is taken.`));
        return;
      }
      throw error;
    }
  });

  /**
   * Mints a key, showing the secret exactly once.
   *
   * Accepts either the bootstrap key — which must name the org, having none of its own — or a
   * signed-in admin, whose org comes from the session and cannot be overridden by the body.
   */
  router.post('/keys', async (req: Request, res: Response) => {
    const parsed = createKey.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', issues(parsed.error)));
      return;
    }
    const ctx = req.crm!;

    let orgId: string;
    if (ctx.kind === 'bootstrap') {
      if (parsed.data.orgId === undefined) {
        res.status(422).json(problem(req, 422, 'ORG_REQUIRED',
          'The bootstrap key holds no organisation, so orgId must be given.'));
        return;
      }
      orgId = parsed.data.orgId;
    } else if (ctx.kind === 'session' && ctx.role === 'admin') {
      orgId = ctx.orgId;
    } else {
      res.status(403).json(problem(req, 403, 'FORBIDDEN',
        'Minting a key requires an admin session, or the deployment bootstrap key.'));
      return;
    }

    const issued = await issueApiKey(db, { orgId, name: parsed.data.name, scopes: parsed.data.scopes });
    // The prefix, never the secret. An audit log holding working credentials would be a
    // second copy of the thing it exists to police.
    await writeAuditInTenant(db, {
      orgId, actor: auditActor(req), action: AUDIT.apiKeyIssued,
      targetType: 'api_key', targetId: issued.id,
      after: { name: parsed.data.name, prefix: issued.prefix, scopes: parsed.data.scopes },
      ip: req.ip ?? null, requestId: String(req.id)
    });
    res.status(201).json({ data: {
      id: issued.id, prefix: issued.prefix, scopes: parsed.data.scopes,
      // Shown once. There is no endpoint that can return it again, by design.
      secret: issued.secret,
      warning: 'Copy this now. It is not stored and cannot be shown again.'
    } });
  });

  /** Lists this org's keys. Never returns a secret — only what is safe to display. */
  router.get('/keys', requireRole('admin'), async (req: Request, res: Response) => {
    res.json({ data: await listApiKeys(db, req.crm!.orgId) });
  });

  /** Revokes a key. Soft, so audit entries referencing it still resolve. */
  router.delete('/keys/:id', requireRole('admin'), async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const done = await revokeApiKey(db, id, req.crm!.orgId);
    if (!done) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such key.'));
      return;
    }
    await writeAuditInTenant(db, {
      orgId: req.crm!.orgId, actor: auditActor(req), action: AUDIT.apiKeyRevoked,
      targetType: 'api_key', targetId: id, ip: req.ip ?? null, requestId: String(req.id)
    });
    res.status(204).end();
  });

  /** Adds someone to this org. The invite path, until email-based invitations exist. */
  router.post('/users', requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = createUser.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', issues(parsed.error)));
      return;
    }
    try {
      const result = await addUserToOrg(db, hasher, { orgId: req.crm!.orgId, ...parsed.data }, auditActor(req));
      res.status(201).json({ data: result });
    } catch (error) {
      if (error instanceof AlreadyExistsError) {
        res.status(409).json(problem(req, 409, 'ALREADY_EXISTS', 'That person is already in this organisation.'));
        return;
      }
      throw error;
    }
  });

  return router;
}
