import type { Request, Response } from 'express';

/**
 * The one RFC 7807 problem body in this application.
 *
 * It exists because there were six copies of it and two of them were wrong: they took no
 * status and hardcoded `"status": 0` into the body while the real code went out on the status
 * line, so a client reading `body.status` got `0` from some routes and the truth from others.
 * That is the kind of defect that only appears once somebody trusts the field.
 *
 * `status` mirrors the HTTP status code, which is what the spec requires and the only reason
 * the field is in the body at all.
 */
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly request_id: string;
}

/** Builds a problem body. Always pass the same status you are about to send. */
export function problem(req: Request, status: number, code: string, detail: string): Problem {
  return {
    type: 'about:blank',
    title: code,
    status,
    code,
    detail,
    request_id: String(req.id)
  };
}

/**
 * Sends a problem response, so the status cannot disagree with the body at all.
 *
 * Preferred over `res.status(n).json(problem(req, n, …))` — repeating the number is how the
 * two drifted apart in the first place.
 */
export function sendProblem(
  req: Request, res: Response, status: number, code: string, detail: string
): void {
  res.status(status).json(problem(req, status, code, detail));
}
