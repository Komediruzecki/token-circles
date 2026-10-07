import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isTransientD1Error } from './db';
import { logWorkerError } from './errorlog';
import { HttpError } from './http';
import type { AppEnv } from './index';

/**
 * What a client sees when the Worker fails in a way nobody wrote a message for. The real error
 * (a D1 constraint, a TypeError, a JSON parse failure) goes to the logs instead: its text names
 * tables, columns and code paths, and the person reading it in a toast cannot act on any of it.
 */
export const GENERIC_ERROR = 'Something went wrong on our side. Try again in a moment.';

const RETRY_SHORTLY = 'Service temporarily unavailable, please retry shortly.';

/** The status and words a client may see for an error, and whether D1 was only briefly busy. */
export interface PublicError {
  status: number;
  message: string;
  transient: boolean;
}

/**
 * The one rule for what an error may say to a client. Two kinds of error are written for the
 * client and pass through with their own status and message: the project's HttpError and Hono's
 * HTTPException, 5xx ones included ("Billing is not configured" is a 501 the page shows as is).
 * A transient D1 lock is a retryable 503. Everything else is unexpected: 500 and GENERIC_ERROR.
 *
 * Never throw a plain Error to send a message to the client. Throw an HttpError.
 */
export function publicError(err: unknown): PublicError {
  // A `d1 export` backup (deploy-worker.yml) or a transient blip briefly locks D1 — and the
  // in-helper retries (db.ts) were exhausted (or the query bypassed the helpers).
  if (isTransientD1Error(err)) return { status: 503, message: RETRY_SHORTLY, transient: true };
  if (err instanceof HttpError) {
    return { status: err.statusCode, message: err.message || GENERIC_ERROR, transient: false };
  }
  if (err instanceof HTTPException) {
    return { status: err.status, message: err.message || GENERIC_ERROR, transient: false };
  }
  return { status: 500, message: GENERIC_ERROR, transient: false };
}

/**
 * publicError plus the log line. A 5xx is logged in full (structured console.error → Workers
 * Observability, and a row in error_logs): message, stack, method, path, never the request body.
 * A transient lock is not persisted, since error_logs is behind the same lock. Best-effort; the
 * logging never changes what the client is told.
 */
export function reportError(c: Context<AppEnv>, err: unknown): PublicError {
  const answer = publicError(err);
  if (!answer.transient) logWorkerError(c, err, answer.status);
  return answer;
}

/** The app's onError: reportError, as JSON. */
export function errorResponse(err: Error, c: Context<AppEnv>): Response {
  // The crawler middleware sets this after next(); when next() threw, the response it stamped is
  // the one this handler is about to replace. Say it again here so a 5xx is never the one
  // response on the host without it.
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const { status, message, transient } = reportError(c, err);
  if (transient) c.header('Retry-After', '5');
  return c.json({ error: message }, status as 500);
}
