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

/**
 * The app's onError. Two kinds of error are written for the client and pass through with their
 * own status and message: the project's HttpError and Hono's HTTPException, 5xx ones included
 * ("Billing is not configured" is a 501 the page shows as is). Everything else is unexpected and
 * answers 500 with GENERIC_ERROR.
 *
 * Never throw a plain Error to send a message to the client. Throw an HttpError.
 */
export function errorResponse(err: Error, c: Context<AppEnv>): Response {
  // The crawler middleware sets this after next(); when next() threw, the response it stamped is
  // the one this handler is about to replace. Say it again here so a 5xx is never the one
  // response on the host without it.
  c.header('X-Robots-Tag', 'noindex, nofollow');
  // A `d1 export` backup (deploy-worker.yml) or a transient blip briefly locks D1 — and the
  // in-helper retries (db.ts) were exhausted (or the query bypassed the helpers). Return a
  // retryable 503 instead of a hard 500, and skip persisting it to the (also-locked) error_logs.
  if (isTransientD1Error(err)) {
    c.header('Retry-After', '5');
    return c.json({ error: 'Service temporarily unavailable, please retry shortly.' }, 503);
  }

  const intended =
    err instanceof HttpError
      ? err.statusCode
      : err instanceof HTTPException
        ? err.status
        : undefined;
  const status = intended ?? 500;
  // Log the failure (structured console.error → Workers Observability; 5xx also persisted to the
  // error_logs D1 table): message, stack, method, path, never the request body. Best-effort;
  // never let logging change the response.
  logWorkerError(c, err, status);
  if (intended === undefined) return c.json({ error: GENERIC_ERROR }, 500);
  return c.json({ error: err.message || GENERIC_ERROR }, status as 500);
}
