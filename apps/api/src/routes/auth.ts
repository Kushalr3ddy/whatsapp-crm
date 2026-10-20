import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { PasswordHasher } from '@crm/auth-builtin';
import { createSession, revokeSession, writeAuditInTenant, AUDIT, SYSTEM_ACTOR } from '@crm/core';
import { SESSION_COOKIE, CSRF_COOKIE } from '../auth.js';
import { problem } from '../problem.js';

/** Body for signing in. */
const login = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(512)
});

/** After this many consecutive failures for one email, refuse for a while. */
const LOCKOUT_AFTER = 5;

/** How long the lockout lasts, growing with each further failure. */
const LOCKOUT_BASE_MS = 30_000;

/** Tracked per email: how many failures in a row, and when attempts may resume. */
interface Attempts { failures: number; blockedUntil: number }

/**
 * Login throttling.
 *
 * In-process on purpose for now: the lean preset runs one API process, and a shared store
 * would mean Redis. That is a real limitation rather than a hidden one — with several
 * replicas each would count separately, so this moves into the rate-limit layer with the rest
 * of it (P9). It is still far better than nothing, which is what was here before.
 */
const attempts = new Map<string, Attempts>();

/** Milliseconds a caller must wait, or 0 when they may try now. */
function blockedFor(email: string): number {
  const a = attempts.get(email);
  if (a === undefined) return 0;
  return Math.max(0, a.blockedUntil - Date.now());
}

/** Records a failure and extends the lockout, doubling each time past the threshold. */
function recordFailure(email: string): void {
  const a = attempts.get(email) ?? { failures: 0, blockedUntil: 0 };
  a.failures += 1;
  if (a.failures >= LOCKOUT_AFTER) {
    const over = a.failures - LOCKOUT_AFTER;
    a.blockedUntil = Date.now() + Math.min(LOCKOUT_BASE_MS * 2 ** over, 15 * 60_000);
  }
  attempts.set(email, a);
}

/** Clears the record. Called on success, so a correct login un-penalises an honest typo. */
function recordSuccess(email: string): void {
  attempts.delete(email);
}


/**
 * Sign in, sign out, and "who am I".
 *
 * Mounted **before** the authentication middleware, because logging in is how you obtain a
 * credential and cannot itself require one.
 */
export function authRouter(db: Database, hasher: PasswordHasher, isProduction: boolean): Router {
  const router = Router();

  /** Exchanges an email and password for a session cookie. */
  router.post('/login', async (req: Request, res: Response) => {
    const parsed = login.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'email and password are required'));
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();

    // For whoever reads the server log: a masked email (first letter and domain), never the whole address.
    const masked = `${email.slice(0, 1)}***@${email.split('@')[1] ?? '?'}`;

    const wait = blockedFor(email);
    if (wait > 0) {
      req.log.warn({ email: masked, reason: 'locked_out' }, 'sign-in refused');
      res.status(429).json(problem(req, 429, 'TOO_MANY_ATTEMPTS',
        `Too many failed sign-ins. Try again in ${String(Math.ceil(wait / 1000))} seconds.`));
      return;
    }

    const rows = await db.execute(sql`
      SELECT u.id, u.password_hash AS "passwordHash", u.status,
             m.org_id AS "orgId", m.role
      FROM app_user u
      JOIN org_membership m ON m.user_id = u.id
      WHERE u.email = ${email}
      ORDER BY m.joined_at ASC
      LIMIT 1`);
    const user = (rows as unknown as Array<{
      id: string; passwordHash: string | null; status: string; orgId: string; role: string;
    }>)[0];

    // Verify against a dummy hash when there is no such user, so that a missing account and a
    // wrong password take the same time. Otherwise the response time enumerates valid emails.
    const storedHash = user?.passwordHash
      ?? '$argon2id$v=19$m=19456,t=2,p=1$aaaaaaaaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const ok = await hasher.verify(storedHash, parsed.data.password);

    if (!ok || user === undefined || user.status !== 'active') {
      recordFailure(email);
      // The screen says the same thing for every cause (so it cannot be used to find valid emails); the log does not.
      req.log.warn({
        email: masked,
        reason: user === undefined ? 'no_such_account' : user.status !== 'active' ? 'disabled' : 'wrong_password'
      }, 'sign-in failed');
      // Only recorded when the account exists. An unknown email has no tenant to record it
      // against, and inventing one would leak into some org's log that a stranger typed an
      // address it has never heard of.
      if (user !== undefined) {
        await writeAuditInTenant(db, {
          orgId: user.orgId, actor: { type: 'user', id: user.id }, action: AUDIT.loginFailed,
          targetType: 'app_user', targetId: user.id,
          after: { reason: user.status !== 'active' ? 'account_disabled' : 'wrong_password' },
          ip: req.ip ?? null, requestId: String(req.id)
        });
      }
      res.status(401).json(problem(req, 401, 'INVALID_CREDENTIALS', 'Email or password is wrong.'));
      return;
    }

    recordSuccess(email);
    const issued = await createSession(db, {
      userId: user.id, orgId: user.orgId,
      ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null
    });
    await db.execute(sql`UPDATE app_user SET last_login_at = now() WHERE id = ${user.id}`);
    await writeAuditInTenant(db, {
      orgId: user.orgId, actor: { type: 'user', id: user.id }, action: AUDIT.loginSucceeded,
      targetType: 'session', targetId: issued.sessionId,
      ip: req.ip ?? null, requestId: String(req.id)
    });

    const csrf = randomBytes(24).toString('base64url');
    const secure = isProduction ? ' Secure;' : '';
    res.setHeader('Set-Cookie', [
      // HttpOnly: script must never be able to read the session token.
      `${SESSION_COOKIE}=${issued.token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${String(7 * 24 * 60 * 60)}`,
      // Deliberately readable — the browser has to echo it back in a header. That is the
      // double-submit pattern, and it is why this one is not HttpOnly.
      `${CSRF_COOKIE}=${csrf};${secure} SameSite=Lax; Path=/; Max-Age=${String(7 * 24 * 60 * 60)}`
    ]);
    res.status(200).json({ data: { userId: user.id, orgId: user.orgId, role: user.role, csrf } });
  });

  /** Ends the current session and clears both cookies. */
  router.post('/logout', async (req: Request, res: Response) => {
    if (req.crm?.kind === 'session' && req.crm.credentialId !== null) {
      const { orgId, userId, credentialId } = req.crm;
      await revokeSession(db, credentialId);
      await writeAuditInTenant(db, {
        orgId, actor: { type: 'user', id: userId ?? SYSTEM_ACTOR.id }, action: AUDIT.logout,
        targetType: 'session', targetId: credentialId,
        ip: req.ip ?? null, requestId: String(req.id)
      });
    }
    res.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `${CSRF_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0`
    ]);
    res.status(204).end();
  });

  /** Reports who the caller is. The UI uses it to decide whether to show a login screen. */
  router.get('/me', (req: Request, res: Response) => {
    if (req.crm === undefined) {
      res.status(401).json(problem(req, 401, 'UNAUTHORIZED', 'Not authenticated.'));
      return;
    }
    res.json({ data: {
      kind: req.crm.kind, orgId: req.crm.orgId, userId: req.crm.userId,
      role: req.crm.role, scopes: req.crm.scopes
    } });
  });

  return router;
}
