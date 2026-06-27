import type { Context } from 'hono';
import type { AppEnv } from './index';

// Cloudflare Turnstile (CAPTCHA) verification for the public auth endpoints, layered on top of the
// rate limiter. The gate is DISABLED when TURNSTILE_SECRET is unset (returns true) so local dev and
// not-yet-configured deploys keep working — set the secret (and the frontend VITE_TURNSTILE_SITE_KEY)
// to enforce it. When configured it FAILS CLOSED: a missing/invalid token is rejected.
export async function verifyTurnstile(
  c: Context<AppEnv>,
  token: string | undefined
): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return true; // not configured → gate disabled
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: c.req.header('CF-Connecting-IP') ?? '',
      }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // fail closed when the gate is configured
  }
}
