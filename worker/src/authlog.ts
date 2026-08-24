/**
 * Auth observability.
 *
 * `errorlog.ts` records 5xx only, on the reasoning that 4xx is intentional control flow. That
 * holds for validation and not-found. It does not hold for authentication: a 401 is the one 4xx
 * that can mean the server is wrong, and when it does, nobody finds out. A duplicate session
 * cookie from a neighbouring deployment put a real account into a permanent 401 loop — login
 * returned 200, the next request returned 401, and there was no server-side record of either.
 *
 * So every auth outcome now says what happened and why. Console always (Workers Observability);
 * D1 only for the events worth keeping, because a signed-out browser polls /api/auth/me on every
 * page load and one row per denial would be a write per page view.
 */
import type { Context } from 'hono';
import type { AppEnv, Env } from './index';

export type AuthEvent = 'login' | 'register' | 'logout' | 'session';

export interface AuthLogEntry {
  event: AuthEvent;
  outcome: 'ok' | 'denied';
  /** Why it was denied. Absent on success. */
  reason?: string;
  userId?: number | null;
  /** The address that was tried — for a failed login it is the only identifier there is. */
  email?: string | null;
  /** Session cookies presented. >1 means duplicates across Domain/Path scopes. */
  cookieCount?: number;
}

/** Whether this outcome earns a row that outlives the Workers-Logs retention window. */
function worthPersisting(entry: AuthLogEntry): boolean {
  if (entry.event !== 'session') return true;
  // A request with no cookie is simply signed out; a request WITH one that was refused is the
  // failure worth keeping.
  return entry.outcome === 'denied' && (entry.cookieCount ?? 0) > 0;
}

/**
 * Record one auth outcome. Best-effort in every direction: never throws, never changes the
 * response, and a failed insert is itself only a console line.
 */
export function logAuthEvent(c: Context<AppEnv>, entry: AuthLogEntry): void {
  const requestId = c.req.header('cf-ray') ?? null;
  const ip = c.req.header('cf-connecting-ip') ?? null;
  const userAgent = c.req.header('user-agent') ?? null;

  const line = {
    level: entry.outcome === 'ok' ? 'info' : 'warn',
    kind: 'auth',
    event: entry.event,
    outcome: entry.outcome,
    reason: entry.reason ?? null,
    userId: entry.userId ?? null,
    email: entry.email ?? null,
    path: c.req.path,
    requestId,
    ip,
    cookieCount: entry.cookieCount ?? null,
  };
  // console.warn for a denial so it separates from the ok stream in Workers Logs without being an
  // error — a wrong password is not an incident.
  if (entry.outcome === 'ok') console.info(JSON.stringify(line));
  else console.warn(JSON.stringify(line));

  if (!worthPersisting(entry)) return;
  const db = (c.env as Env | undefined)?.DB;
  if (!db) return;

  const insert = db
    .prepare(
      `INSERT INTO auth_logs
         (event, outcome, reason, user_id, email, ip, user_agent, request_id, cookie_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.event,
      entry.outcome,
      entry.reason ?? null,
      entry.userId ?? null,
      entry.email ?? null,
      ip,
      userAgent,
      requestId,
      entry.cookieCount ?? null
    )
    .run()
    .then(() => undefined)
    .catch((dbErr: unknown) => {
      console.error('auth_logs insert failed:', dbErr);
    });

  try {
    c.executionCtx.waitUntil(insert);
  } catch {
    // No executionCtx outside a request lifecycle (unit tests). The insert still runs; it just
    // cannot be deferred to the platform.
    void insert;
  }
}
