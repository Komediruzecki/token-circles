import type { Context } from 'hono';
import type { AppEnv, Env } from './index';
import * as db from './db';

// Lightweight D1-backed fixed-window rate limiter. Keyed by an arbitrary bucket string
// (e.g. "forgot:<ip>"). Enough to blunt email-bombing and brute-force on the public endpoints;
// it is not a distributed token bucket. Buckets self-reset each window; expired rows are swept
// from the cron (sweepRateLimits). Portable — works the same on a self-hosted worker.
export async function rateLimit(
  env: Env,
  bucket: string,
  limit: number,
  windowSec: number
): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Date.now();
  const resetAt = now + windowSec * 1000;
  // Single atomic statement: insert a fresh bucket, OR (on conflict) reset an expired window /
  // increment a live one — but the DO UPDATE only fires while the window is expired or still under
  // the cap. When the row is live and at/over the cap the WHERE makes it a no-op (0 rows changed),
  // which is our "denied" signal. This collapses the old SELECT-then-UPDATE into one write, so a
  // concurrent burst can no longer all read the same sub-limit count and overshoot the cap.
  const res = await db.run(
    env.DB,
    `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
     WHERE reset_at <= ? OR count < ?`,
    bucket,
    resetAt,
    now,
    now,
    resetAt,
    now,
    limit
  );
  if ((res.meta.changes ?? 0) > 0) return { ok: true, retryAfter: 0 };
  // Denied: the live bucket is at/over the cap. Read reset_at only here for the Retry-After hint.
  const row = await db.first<{ reset_at: number }>(
    env.DB,
    'SELECT reset_at FROM rate_limits WHERE bucket = ?',
    bucket
  );
  const retryAfter = row ? Math.ceil((row.reset_at - now) / 1000) : windowSec;
  return { ok: false, retryAfter: Math.max(retryAfter, 1) };
}

/**
 * Forget a bucket entirely.
 *
 * Called after a SUCCESSFUL sign-in. The limit exists to blunt credential guessing, and a
 * successful sign-in is proof the credentials are right — counting it against the same budget
 * locked out the one person who could not possibly be the attacker. Ten successful logins in a
 * quarter of an hour is a person testing on three devices, not a break-in.
 *
 * Failures still accumulate, so a run of wrong passwords is refused exactly as before.
 */
export async function clearRateLimit(env: Env, bucket: string): Promise<void> {
  await db.run(env.DB, 'DELETE FROM rate_limits WHERE bucket = ?', bucket);
}

// Best-effort cleanup of expired buckets. Called from the scheduled (cron) handler.
export async function sweepRateLimits(env: Env): Promise<void> {
  await db.run(env.DB, 'DELETE FROM rate_limits WHERE reset_at <= ?', Date.now());
}

/** Best-effort client IP for keying. Cloudflare sets CF-Connecting-IP. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown';
}

/** "in about 12 minutes" / "in about a minute" / "in 30 seconds". */
export function humanWait(seconds: number): string {
  if (seconds <= 90) return `in ${Math.max(seconds, 1)} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'in about a minute' : `in about ${minutes} minutes`;
}

/**
 * Enforce a limit inside a handler: returns a ready-to-return 429 Response when exceeded,
 * or null when the request may proceed. Usage: `const rl = await enforce(c, key, 5, 900); if (rl) return rl;`
 */
export async function enforce(
  c: Context<AppEnv>,
  bucket: string,
  limit: number,
  windowSec: number
): Promise<Response | null> {
  const r = await rateLimit(c.env, bucket, limit, windowSec);
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfter));
    // Say how long. "Please wait a bit" leaves the user guessing whether that is seconds or an
    // hour, and the only way to find out is to keep trying — which is the one thing that must not
    // help, and here does not.
    return c.json(
      { error: `Too many attempts. Please try again ${humanWait(r.retryAfter)}.` },
      429
    );
  }
  return null;
}
