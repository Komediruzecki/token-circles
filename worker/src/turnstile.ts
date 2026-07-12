import type { Context } from 'hono';
import type { AppEnv } from './index';

// Cloudflare Turnstile (CAPTCHA) verification for the public auth endpoints, layered on top of the
// rate limiter. When TURNSTILE_SECRET is unset the gate is disabled ONLY in local development
// (APP_ENV === 'development'); in any deployed environment an unset secret now FAILS CLOSED (S9) so
// a misconfigured production can't silently drop the CAPTCHA — set the secret (and the frontend
// VITE_TURNSTILE_SITE_KEY) to enforce it. When configured it also fails closed on a missing/invalid token.
export async function verifyTurnstile(
  c: Context<AppEnv>,
  token: string | undefined
): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    // Local dev convenience: no secret needed to exercise the auth flow.
    if (c.env.APP_ENV === 'development') return true;
    // Deployed without a secret → fail closed and make it visible in observability.
    console.warn(
      'TURNSTILE_SECRET is not set while APP_ENV is not "development"; failing CAPTCHA verification closed.'
    );
    return false;
  }
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
