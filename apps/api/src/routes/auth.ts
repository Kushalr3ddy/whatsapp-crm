import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import type { PasswordHasher } from '@crm/auth-builtin';
import {
  createSession, revokeSession, writeAuditInTenant, createOrgWithAdmin, AlreadyExistsError, AUDIT, SYSTEM_ACTOR
} from '@crm/core';
import { SESSION_COOKIE, CSRF_COOKIE } from '../auth.js';
import { problem } from '../problem.js';

/** Body for signing in. */
const login = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(512)
});

/** Body for self-service signup: a new organisation and its first admin. */
const signup = z.object({
  orgName: z.string().trim().min(2).max(100),
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  password: z.string().min(12, 'at least 12 characters').max(512)
});

/** Signups allowed from one address per window — the first unauthenticated write route, so it is capped. */
const SIGNUP_WINDOW_MS = 60 * 60_000;

/**
 * A per-address signup allowance, one window long. In-process, like the login throttle (P9 moves both
 * into the shared rate-limit layer). Returns a checker that records the attempt when it is allowed.
 */
function signupLimiter(perHour: number): (ip: string) => boolean {
  const log = new Map<string, number[]>();
  return (ip) => {
    const now = Date.now();
    const recent = (log.get(ip) ?? []).filter((t) => now - t < SIGNUP_WINDOW_MS);
    if (recent.length >= perHour) { log.set(ip, recent); return false; }
    recent.push(now);
    log.set(ip, recent);
    return true;
  };
}

/** A URL-safe org slug from a display name, with a random tail so two "Acme"s do not collide. */
function slugFor(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base === '' ? 'org' : base}-${randomBytes(3).toString('hex')}`;
}

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
export function authRouter(
  db: Database, hasher: PasswordHasher, isProduction: boolean, signupEnabled = false, signupPerHour = 5
): Router {
  const router = Router();
  const signupAllowed = signupLimiter(signupPerHour);

  /** An org's billing status, for the UI to decide between the app and the Billing page. */
  const billingOf = async (orgId: string): Promise<string> => {
    const rows = (await db.execute(sql`SELECT billing_status AS status FROM org WHERE id = ${orgId}`)) as
      unknown as Array<{ status: string }>;
    return rows[0]?.status ?? 'exempt';
  };

  /** Sets the session and CSRF cookies on a response. One place, so login and signup cannot drift. */
  const setSessionCookies = (res: Response, token: string): string => {
    const csrf = randomBytes(24).toString('base64url');
    const secure = isProduction ? ' Secure;' : '';
    res.setHeader('Set-Cookie', [
      // HttpOnly: script must never be able to read the session token.
      `${SESSION_COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${String(7 * 24 * 60 * 60)}`,
      // Deliberately readable — the browser has to echo it back in a header. That is the
      // double-submit pattern, and it is why this one is not HttpOnly.
      `${CSRF_COOKIE}=${csrf};${secure} SameSite=Lax; Path=/; Max-Age=${String(7 * 24 * 60 * 60)}`
    ]);
    return csrf;
  };

  /** What the sign-in screen needs before anyone is signed in: whether to offer "create an account". */
  router.get('/config', (_req: Request, res: Response) => {
    res.json({ data: { signupEnabled: signupEnabled } });
  });

  /**
   * Self-service signup: a new organisation with its first admin, signed in straight away.
   *
   * Off unless `SIGNUP_ENABLED=true`. The org starts `unpaid`, so the UI sends the person to Billing
   * until an operator marks it `paid` or `exempt` (a beta tester). Same provisioning seam as the CLI.
   */
  router.post('/signup', async (req: Request, res: Response) => {
    if (!signupEnabled) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'Signup is not enabled on this install.'));
      return;
    }
    if (!signupAllowed(req.ip ?? 'unknown')) {
      res.status(429).json(problem(req, 429, 'TOO_MANY_SIGNUPS', 'Too many signups from this address. Try again later.'));
      return;
    }
    const parsed = signup.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { orgName, displayName, email, password } = parsed.data;
    let created: { orgId: string; userId: string } | null = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt++) {
      try {
        created = await createOrgWithAdmin(db, hasher, {
          orgName, slug: slugFor(orgName), email, password, displayName, billingStatus: 'unpaid'
        });
      } catch (error) {
        if (!(error instanceof AlreadyExistsError)) throw error;
        if (error.field === 'email') {
          res.status(409).json(problem(req, 409, 'EMAIL_TAKEN', 'That email already has an account. Sign in instead.'));
          return;
        }
        // A slug collision: loop and draw a new random tail.
      }
    }
    if (created === null) {
      res.status(503).json(problem(req, 503, 'SIGNUP_FAILED', 'Could not create the organisation. Try again.'));
      return;
    }
    const issued = await createSession(db, {
      userId: created.userId, orgId: created.orgId,
      ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null
    });
    const csrf = setSessionCookies(res, issued.token);
    res.status(201).json({ data: {
      userId: created.userId, orgId: created.orgId, role: 'admin', csrf, billingStatus: 'unpaid'
    } });
  });

  /** Exchanges an email and password for a session cookie. */
  router.post('/login', async (req: Request, res: Response) => {
    const parsed = login.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'email and password are required'));
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();

    const wait = blockedFor(email);
    if (wait > 0) {
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

    const csrf = setSessionCookies(res, issued.token);
    res.status(200).json({ data: {
      userId: user.id, orgId: user.orgId, role: user.role, csrf, billingStatus: await billingOf(user.orgId)
    } });
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
  router.get('/me', async (req: Request, res: Response) => {
    if (req.crm === undefined) {
      res.status(401).json(problem(req, 401, 'UNAUTHORIZED', 'Not authenticated.'));
      return;
    }
    // The bootstrap key holds no org, so it has no billing status to report.
    const billingStatus = req.crm.kind === 'bootstrap' ? null : await billingOf(req.crm.orgId);
    res.json({ data: {
      kind: req.crm.kind, orgId: req.crm.orgId, userId: req.crm.userId,
      role: req.crm.role, scopes: req.crm.scopes, billingStatus
    } });
  });

  return router;
}
