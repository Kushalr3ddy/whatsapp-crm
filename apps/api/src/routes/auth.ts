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

/** After this many consecutive failures for one email from one address, refuse for a while. */
const LOCKOUT_AFTER = 5;

/** How long the lockout lasts, growing with each further failure. */
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 15 * 60_000;

/** One address may fail this many sign-ins, whatever emails it tries, in one window, before it is refused for the rest of the window. */
const IP_FAILURES_PER_WINDOW = 30;
const IP_WINDOW_MS = 15 * 60_000;

/** Tracked per (address, email): how many failures in a row, and when attempts may resume. */
interface Attempts { failures: number; blockedUntil: number; lastAt: number }
/** Tracked per address: failures in the current window, across every email. */
interface IpWindow { startedAt: number; failures: number }

/**
 * Login throttling.
 *
 * The lock is per (address, email), not per email: a limit on the email alone let anyone, from anywhere, lock the real owner out for up
 * to 15 minutes by guessing wrong passwords for it (R-035). Now the guesser is slowed down and the owner, from another address, is not.
 * A second limit per address stops one machine from trying many emails. Both are in-process on purpose for now: the lean preset runs one
 * API process, and a shared store would mean Redis. With several replicas each would count separately (P9). The address is `req.ip`,
 * which follows `X-Forwarded-For` because the API sits behind a proxy: a caller that reaches the API directly can pick its own, so these
 * limits belong at the proxy as well (docs/13-deployment.md).
 */
const attempts = new Map<string, Attempts>();
const ipWindows = new Map<string, IpWindow>();

/** Drops entries that have gone quiet, so a long-running process does not keep one per address and email ever seen. */
function evict(now: number): void {
  if (attempts.size > 5000) for (const [k, a] of attempts) if (now - a.lastAt > LOCKOUT_MAX_MS * 2) attempts.delete(k);
  if (ipWindows.size > 5000) for (const [k, w] of ipWindows) if (now - w.startedAt > IP_WINDOW_MS) ipWindows.delete(k);
}

const keyOf = (ip: string, email: string): string => `${ip}|${email}`;

/** Milliseconds a caller must wait, or 0 when they may try now. */
function blockedFor(ip: string, email: string): number {
  const now = Date.now();
  const a = attempts.get(keyOf(ip, email));
  const byEmail = a === undefined ? 0 : Math.max(0, a.blockedUntil - now);
  const w = ipWindows.get(ip);
  const byIp = w !== undefined && now - w.startedAt < IP_WINDOW_MS && w.failures >= IP_FAILURES_PER_WINDOW ? w.startedAt + IP_WINDOW_MS - now : 0;
  return Math.max(byEmail, byIp);
}

/** Records a failure and extends the lockout, doubling each time past the threshold. */
function recordFailure(ip: string, email: string): void {
  const now = Date.now();
  evict(now);
  const k = keyOf(ip, email);
  const a = attempts.get(k) ?? { failures: 0, blockedUntil: 0, lastAt: now };
  a.failures += 1;
  a.lastAt = now;
  if (a.failures >= LOCKOUT_AFTER) {
    const over = a.failures - LOCKOUT_AFTER;
    a.blockedUntil = now + Math.min(LOCKOUT_BASE_MS * 2 ** over, LOCKOUT_MAX_MS);
  }
  attempts.set(k, a);
  const w = ipWindows.get(ip);
  if (w === undefined || now - w.startedAt >= IP_WINDOW_MS) ipWindows.set(ip, { startedAt: now, failures: 1 });
  else w.failures += 1;
}

/** Clears the record for this address and email. Called on success, so a correct login un-penalises an honest typo. */
function recordSuccess(ip: string, email: string): void {
  attempts.delete(keyOf(ip, email));
}

/** Forgets every failure. For tests, so one test's attempts cannot lock out the next. */
export function resetLoginThrottle(): void {
  attempts.clear();
  ipWindows.clear();
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

    const ip = req.ip ?? 'unknown';
    const wait = blockedFor(ip, email);
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
      recordFailure(ip, email);
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

    recordSuccess(ip, email);
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
