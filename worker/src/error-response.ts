import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isTransientD1Error } from './db';
import { logWorkerError } from './errorlog';
import { HttpError } from './http';
import type { AppEnv } from './index';
import type { FieldErrors } from '../../shared/refusal';

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
  /**
   * A refused body's reason per field (http.ts `refuse`), which a form puts under each field.
   * Only an HttpError carries them.
   */
  fields?: FieldErrors;
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
    const answer = {
      status: err.statusCode,
      message: err.message || GENERIC_ERROR,
      transient: false,
    };
    return err.fields ? { ...answer, fields: err.fields } : answer;
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

/**
 * The app's onError: reportError, as JSON. An HTTPException that carries its own response
 * (Hono's basicAuth and bearerAuth build a 401 with WWW-Authenticate) is answered with that
 * response instead, since rebuilding it as JSON would drop its headers.
 */
export function errorResponse(err: Error, c: Context<AppEnv>): Response {
  // The crawler middleware sets this after next(); when next() threw, the response it stamped is
  // the one this handler is about to replace. Say it again here so a 5xx is never the one
  // response on the host without it.
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const { status, message, transient, fields } = reportError(c, err);
  if (err instanceof HTTPException && err.res) {
    const res = err.getResponse();
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
  }
  if (transient) c.header('Retry-After', '5');
  // A refused body names its fields (shared/refusal.ts), and the form marks them.
  // worker/test/category-refusals.test.ts fails if they stop arriving.
  if (fields) return c.json({ error: message, fields }, status as 400);
  return c.json({ error: message }, status as 500);
}

/** The answer to a request body that is not JSON: the client's mistake, so a 400. */
export const MALFORMED_JSON = "The request body isn't valid JSON.";

/**
 * Makes a body that will not parse a 400 instead of a 500, for every route at once. It wraps this
 * request's c.req.json() so that its SyntaxError, and only that one, becomes an HttpError(400).
 * A SyntaxError from anywhere else (JSON.parse of a stored value, a token) is still unexpected
 * and still a generic 500. Routes that read the body with `.catch(() => ({}))` see no difference.
 */
export const rejectMalformedJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  const req = c.req;
  const parse = req.json.bind(req);
  req.json = (async () => {
    try {
      return await parse();
    } catch (err) {
      if (err instanceof SyntaxError) throw new HttpError(400, MALFORMED_JSON);
      throw err;
    }
  }) as typeof req.json;
  await next();
};
