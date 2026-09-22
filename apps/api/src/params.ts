import type { NextFunction, Request, Response } from 'express';
import { sendProblem } from './problem.js';

/**
 * Canonical UUID form. Deliberately not a "looks roughly like a uuid" pattern: Postgres will
 * reject anything else with a 22P02 cast error, so the two have to agree on what is acceptable
 * or this middleware simply moves the failure rather than preventing it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Refuses a path parameter that is not a UUID, before it reaches the database.
 *
 * **Bodies were validated and path parameters were not**, which is how
 * `GET /conversations/not-a-uuid/messages` produced a 500: the value went into a query, the
 * cast threw `22P02`, and the error boundary turned a caller's typo into `INTERNAL_ERROR`. A
 * 500 says "we broke"; this is the caller handing us something that cannot name any row.
 *
 * **422, not 404.** The project's "404 not 403" rule exists so that a well-formed id never
 * reveals whether it belongs to another tenant — but a malformed id cannot name a row in *any*
 * tenant, so refusing it leaks nothing, and saying which parameter was wrong saves the caller
 * guessing whether the resource merely does not exist. Well-formed-but-absent stays 404.
 */
export function requireUuidParam(...names: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const name of names) {
      const value = req.params[name];
      if (typeof value !== 'string' || !UUID.test(value)) {
        sendProblem(req, res, 422, 'VALIDATION_FAILED',
          `${name}: must be a UUID`);
        return;
      }
    }
    next();
  };
}
