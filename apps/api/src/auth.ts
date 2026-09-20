import type { NextFunction, Request, Response } from 'express';
import { resolveApiKey, resolveSession, secretsMatch } from '@crm/core';
import type { Config } from '@crm/shared';
import type { Database } from '@crm/db';

/** The cookie a browser session travels in. HttpOnly: script must never read it. */
export const SESSION_COOKIE = 'crm_session';

/** The CSRF cookie. Deliberately readable by script — that is how double-submit works. */
export const CSRF_COOKIE = 'crm_csrf';

/** The header a browser must echo the CSRF cookie back in. */
export const CSRF_HEADER = 'x-csrf-token';

/** How a request proved who it is. Kept so handlers and the audit log can tell them apart. */
export type PrincipalKind = 'session' | 'api_key' | 'bootstrap';

/** The tenant and identity a request acts as, attached by the auth middleware. */
export interface RequestContext {
  readonly orgId: string;
  readonly kind: PrincipalKind;
  /** Present for a session. Null for a key: a key is not a person. */
  readonly userId: string | null;
  /** `admin` or `agent` for a session; null for a key, which carries scopes instead. */
  readonly role: string | null;
  readonly scopes: readonly string[];
  /** Which key or session authorised this, for the audit trail. */
  readonly credentialId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    /** Express's request type, augmented with the tenant context our middleware attaches. */
    interface Request {
      /** Present on every authenticated request. Absent means the middleware did not run. */
      crm?: RequestContext;
    }
  }
}

/** Builds an RFC 7807 problem body. `status` mirrors the HTTP status code, as the spec says. */
function problem(req: Request, status: number, code: string, detail: string) {
  return { type: 'about:blank', title: code, status, code, detail, request_id: req.id };
}

/** Reads one cookie without pulling in a parser dependency for a single value. */
function readCookie(header: string | undefined, name: string): string {
  if (header === undefined) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

/** Pulls a bearer token out of the Authorization header, or '' when there is not one. */
function bearer(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/**
 * Authenticates a request as a person (session cookie) or a machine (API key).
 *
 * Both are resolved here so that one middleware establishes the tenant for every route, and
 * handlers never have to care which arrived. `docs/05-data-model.md` sets the division:
 * sessions are for the first-party UI only, integrations always use a key.
 *
 * The org is no longer guessed. It comes from the credential itself, which is what makes more
 * than one organisation possible at all — the previous implementation ran
 * `SELECT id FROM org LIMIT 2` and refused with 409 the moment a second one existed.
 */
export function attachPrincipal(config: Config, db: Database) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (cookie !== '') {
      const principal = await resolveSession(db, cookie);
      if (principal !== null) {
        req.crm = {
          orgId: principal.orgId, kind: 'session', userId: principal.userId,
          role: principal.role, scopes: [], credentialId: principal.sessionId
        };
        next();
        return;
      }
    }

    const token = bearer(req);
    if (token !== '') {
      const key = await resolveApiKey(db, token);
      if (key !== null) {
        req.crm = {
          orgId: key.orgId, kind: 'api_key', userId: null, role: null,
          scopes: key.scopes, credentialId: key.keyId
        };
        next();
        return;
      }

      // The deployment-level key. Deliberately reaches provisioning ONLY — it cannot read a
      // message or a contact, because a single shared secret with full data access is exactly
      // the hole per-org keys exist to close. `requireBootstrap` is what admits it anywhere.
      if (secretsMatch(token, config.API_KEY)) {
        req.crm = {
          orgId: '', kind: 'bootstrap', userId: null, role: null,
          scopes: [], credentialId: null
        };
        next();
        return;
      }
    }

    // Deliberately does not reject. Signing in is how a credential is obtained, so the login
    // route has to be reachable without one — `requireAuthenticated` below is what refuses.
    next();
  };
}

/**
 * Refuses anything that did not authenticate.
 *
 * Separate from `attachPrincipal` so that the login route can sit between them: resolve
 * whoever is calling, let `/auth/login` through unauthenticated, then close the door.
 */
export function requireAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (req.crm === undefined) {
    // Never say which part was wrong: distinguishing "no credential" from "wrong credential"
    // confirms to an attacker that their format was right.
    res.status(401).json(problem(req, 401, 'UNAUTHORIZED',
      'Authenticate with a session cookie, or send an API key as: Authorization: Bearer <key>'));
    return;
  }
  next();
}

/**
 * Refuses anything that is not a real tenant credential.
 *
 * Mounted on every data route. The bootstrap key authenticates but carries no org, so without
 * this it would reach handlers with `orgId: ''` and read nothing — a confusing empty result
 * rather than a clear refusal.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  if (req.crm === undefined) {
    res.status(401).json(problem(req, 401, 'UNAUTHORIZED', 'Not authenticated.'));
    return;
  }
  if (req.crm.kind === 'bootstrap') {
    res.status(403).json(problem(req, 403, 'BOOTSTRAP_KEY_SCOPE',
      'The deployment API_KEY can only provision an organisation and mint its first key. ' +
      'Use a per-org key from POST /api/v1/admin/keys, or sign in.'));
    return;
  }
  next();
}

/** Admits only the deployment-level key, for provisioning routes. */
export function requireBootstrap(req: Request, res: Response, next: NextFunction): void {
  if (req.crm?.kind !== 'bootstrap') {
    res.status(403).json(problem(req, 403, 'BOOTSTRAP_ONLY',
      'This endpoint accepts the deployment API_KEY only.'));
    return;
  }
  next();
}

/** Requires a signed-in person in one of the given roles. Keys are not people and are refused. */
export function requireRole(...roles: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.crm?.kind !== 'session') {
      res.status(403).json(problem(req, 403, 'SESSION_REQUIRED',
        'This endpoint requires a signed-in user, not an API key.'));
      return;
    }
    if (!roles.includes(req.crm.role ?? '')) {
      res.status(403).json(problem(req, 403, 'FORBIDDEN',
        `Requires role: ${roles.join(' or ')}.`));
      return;
    }
    next();
  };
}

/**
 * Requires a scope, for API-key requests.
 *
 * A session is allowed through: a person's permissions come from their role, and scopes are a
 * way of restricting a machine below its org's full access, not a second system for people.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.crm === undefined) {
      res.status(401).json(problem(req, 401, 'UNAUTHORIZED', 'Not authenticated.'));
      return;
    }
    if (req.crm.kind === 'session') { next(); return; }
    if (!req.crm.scopes.includes(scope)) {
      res.status(403).json(problem(req, 403, 'INSUFFICIENT_SCOPE',
        `This key does not hold the "${scope}" scope.`));
      return;
    }
    next();
  };
}

/**
 * Double-submit CSRF protection for cookie-authenticated writes.
 *
 * Only cookies are vulnerable: a browser attaches them to cross-site requests automatically,
 * which is the whole attack. An `Authorization` header is never sent automatically, so API-key
 * requests need none of this and are passed straight through.
 *
 * The check is that a readable cookie and a header match. An attacker on another origin can
 * cause the request but cannot read the cookie to set the header, because the same-origin
 * policy stops them.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (req.crm?.kind !== 'session') { next(); return; }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }

  const cookie = readCookie(req.headers.cookie, CSRF_COOKIE);
  const header = req.headers[CSRF_HEADER];
  const sent = Array.isArray(header) ? (header[0] ?? '') : (header ?? '');

  if (cookie === '' || sent === '' || !secretsMatch(cookie, sent)) {
    res.status(403).json(problem(req, 403, 'CSRF_FAILED',
      `Cookie-authenticated writes must echo the ${CSRF_COOKIE} cookie in the ${CSRF_HEADER} header.`));
    return;
  }
  next();
}
