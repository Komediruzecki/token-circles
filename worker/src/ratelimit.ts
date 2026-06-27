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
  const row = await db.first<{ count: number; reset_at: number }>(
    env.DB,
    'SELECT count, reset_at FROM rate_limits WHERE bucket = ?',
    bucket
  );
  if (!row || row.reset_at <= now) {
    const resetAt = now + windowSec * 1000;
    await db.run(
      env.DB,
      'INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = ?',
      bucket,
      resetAt,
      resetAt
    );
    return { ok: true, retryAfter: 0 };
  }
  if (row.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((row.reset_at - now) / 1000) };
  }
  await db.run(env.DB, 'UPDATE rate_limits SET count = count + 1 WHERE bucket = ?', bucket);
  return { ok: true, retryAfter: 0 };
}

// Best-effort cleanup of expired buckets. Called from the scheduled (cron) handler.
export async function sweepRateLimits(env: Env): Promise<void> {
  await db.run(env.DB, 'DELETE FROM rate_limits WHERE reset_at <= ?', Date.now());
}

/** Best-effort client IP for keying. Cloudflare sets CF-Connecting-IP. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown';
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
    return c.json({ error: 'Too many requests. Please wait a bit and try again.' }, 429);
  }
  return null;
}
