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
  return (await verifyTurnstileDetailed(c, token)).ok;
}

/** Why a captcha did not pass. The first two are ours to fix; the rest are the caller's. */
export type TurnstileFailure =
  | 'not-configured' // no secret in a deployed environment
  | 'secret-rejected' // Cloudflare says the secret is wrong or missing for this widget
  | 'no-token' // the client sent nothing
  | 'rejected' // expired, already used, or simply invalid
  | 'unreachable'; // siteverify did not answer

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: TurnstileFailure; codes: string[] };

/**
 * The same check, but it says WHY — because "the captcha failed" covers two very different
 * situations and only one of them is the user's to do anything about.
 *
 * A site key pairs with exactly one secret. Point a frontend at a different widget without
 * rotating the worker's secret and every token is minted by widget B while the worker
 * verifies against widget A's secret: the widget still goes green, and every sign-in 403s
 * with a message blaming the captcha. Cloudflare names that case exactly —
 * `invalid-input-secret` — and throwing that away is what makes it hard to find.
 */
export async function verifyTurnstileDetailed(
  c: Context<AppEnv>,
  token: string | undefined
): Promise<TurnstileResult> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    if (c.env.APP_ENV === 'development') return { ok: true };
    return { ok: false, reason: 'not-configured', codes: [] };
  }
  if (!token) return { ok: false, reason: 'no-token', codes: [] };
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
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (data.success === true) return { ok: true };
    const codes = data['error-codes'] ?? [];
    // A secret Cloudflare will not accept is a deployment fault, not a failed challenge.
    const ours = codes.some(
      (code) => code === 'invalid-input-secret' || code === 'missing-input-secret'
    );
    if (ours) {
      console.error(
        `Turnstile rejected this deployment's TURNSTILE_SECRET (${codes.join(', ')}). ` +
          'It does not belong to the site key the frontend is using — rotate it for this environment.'
      );
      return { ok: false, reason: 'secret-rejected', codes };
    }
    return { ok: false, reason: 'rejected', codes };
  } catch {
    return { ok: false, reason: 'unreachable', codes: [] }; // fail closed when the gate is configured
  }
}

/**
 * Is the gate switched on for this deployment?
 *
 * `false` in a deployed environment means every captcha-guarded endpoint fails closed, so
 * nobody can sign in with a password at all. That is the safe behaviour, but it is
 * indistinguishable — from the outside — from a genuinely failed captcha, which is exactly
 * how an unset secret on one environment costs an afternoon: the widget goes green, the
 * request 403s, and the response says the captcha failed.
 */
export function turnstileConfigured(env: { TURNSTILE_SECRET?: string }): boolean {
  return !!env.TURNSTILE_SECRET;
}

/**
 * The response for a captcha that did not pass — saying WHICH of the two things went wrong.
 *
 * Naming a missing secret gives an attacker nothing: with no secret the endpoint refuses
 * everyone, so there is no weaker path to find. It gives whoever deployed it the one fact
 * they need.
 */
export function captchaRejection(c: Context<AppEnv>, result?: TurnstileResult) {
  const reason = result && !result.ok ? result.reason : undefined;
  const misconfigured =
    reason === 'not-configured' ||
    reason === 'secret-rejected' ||
    (reason === undefined && !turnstileConfigured(c.env) && c.env.APP_ENV !== 'development');
  if (misconfigured) {
    return c.json(
      {
        error:
          reason === 'secret-rejected'
            ? 'Sign-in is unavailable on this deployment: the captcha secret does not match the site key the app is using. Rotate TURNSTILE_SECRET for this environment.'
            : 'Sign-in is unavailable on this deployment: the captcha gate has no secret. Set TURNSTILE_SECRET for this environment.',
        code: 'captcha_not_configured',
      },
      503
    );
  }
  return c.json({ error: 'Captcha verification failed. Please try again.' }, 403);
}
