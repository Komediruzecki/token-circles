import type { Context } from 'hono';
import type { AppEnv } from './index';
import { isAppHostname } from './request-origin';
import type { CaptchaAction } from '../../shared/captchaActions';

// Cloudflare Turnstile (CAPTCHA) verification for the public auth endpoints, layered on top of the
// rate limiter. When TURNSTILE_SECRET is unset the gate is disabled ONLY in local development
// (APP_ENV === 'development'); in any deployed environment an unset secret now FAILS CLOSED (S9) so
// a misconfigured production can't silently drop the CAPTCHA — set the secret (and the frontend
// VITE_TURNSTILE_SITE_KEY) to enforce it. When configured it also fails closed on a missing/invalid token.
//
// A passed check counts when it was solved on the app's own pages, for the form being sent: the
// siteverify answer's `hostname` is one of the app's hosts, and its `action` is one the route
// names (shared/captchaActions.ts), or none (verifyTurnstileDetailed).
export async function verifyTurnstile(
  c: Context<AppEnv>,
  token: string | undefined,
  accepted: readonly CaptchaAction[]
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
  return (await verifyTurnstileDetailed(c, token, accepted)).ok;
}

/** Why a captcha did not pass. The first two are ours to fix; the rest are the caller's. */
export type TurnstileFailure =
  | 'not-configured' // no secret in a deployed environment
  | 'secret-rejected' // Cloudflare says the secret is wrong or missing for this widget
  | 'no-token' // the client sent nothing
  | 'rejected' // expired, already used, or simply invalid
  | 'other-host' // passed, and the answer names no host of the app's
  | 'other-action' // passed, and the answer names a form other than the route's
  | 'unreachable'; // siteverify did not answer

export type TurnstileResult =
  | {
      ok: true;
      /**
       * When Cloudflare says the check was solved (`challenge_ts`, epoch ms, never later than
       * now), when it said so. A password sign-in counts its login check from it, and leaves none
       * without it (login-check.ts).
       */
      solvedAt?: number;
    }
  | { ok: false; reason: TurnstileFailure; codes: string[] };

/** What siteverify answers, as far as it is read here. */
interface SiteverifyAnswer {
  success?: boolean;
  'error-codes'?: string[];
  challenge_ts?: unknown;
  hostname?: unknown;
  action?: unknown;
  metadata?: { result_with_testing_key?: unknown };
}

/**
 * Whether a passed check counts for this route, or which of its two fields says it does not.
 *
 * - `hostname` has to be one of the app's hosts: the hosts of CORS_ORIGIN and APP_ORIGINS, and in
 *   development a loopback host (isAppHostname). Cloudflare's public test key pair answers for
 *   example.com whatever page the widget was on, so in development an answer it marks as a test
 *   (`metadata.result_with_testing_key`) counts on any host.
 * - `action` has to be one of the route's (`accepted`), or empty or absent. App tabs, and builds
 *   the service worker keeps, from before the forms named their action send none, and the frontend
 *   deploys apart from the Worker. Each such check writes one `captcha_without_action` line, so the
 *   action can be required once those builds are gone (dev-changelog.md). An action that is there
 *   and is not a string names no form of the route's.
 */
function countsHere(
  c: Context<AppEnv>,
  data: SiteverifyAnswer,
  accepted: readonly CaptchaAction[]
): 'other-host' | 'other-action' | null {
  const hostname = typeof data.hostname === 'string' ? data.hostname : '';
  const testPair =
    c.env.APP_ENV === 'development' && data.metadata?.result_with_testing_key === true;
  const absent = data.action === undefined || data.action === '';
  const said = typeof data.action === 'string' ? data.action : '';
  const why =
    !testPair && !isAppHostname(hostname, c.env)
      ? 'other-host'
      : !absent && !(accepted as readonly string[]).includes(said)
        ? 'other-action'
        : null;
  if (why) {
    // Which field, and what it said, so an app host missing from APP_ORIGINS is a look at the log.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'captcha_not_counted',
        why,
        hostname: hostname || null,
        action: absent ? null : data.action,
        accepted,
        path: c.req.path,
        requestId: c.req.header('cf-ray') ?? null,
      })
    );
    return why;
  }
  if (absent) {
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'captcha_without_action',
        note: 'A captcha that names no form counted.',
        accepted,
        path: c.req.path,
        requestId: c.req.header('cf-ray') ?? null,
      })
    );
  }
  return null;
}

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
  token: string | undefined,
  accepted: readonly CaptchaAction[]
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
    const data = (await res.json()) as SiteverifyAnswer;
    // Only a 2xx answer can pass. Cloudflare answers a TURNSTILE_SECRET it does not know with a
    // 400 that names it (measured 2026-11-01), so the codes below are read whatever the status.
    if (data.success === true && res.ok) {
      const why = countsHere(c, data, accepted);
      if (why) return { ok: false, reason: why, codes: [] };
      const solved = typeof data.challenge_ts === 'string' ? Date.parse(data.challenge_ts) : NaN;
      return Number.isFinite(solved)
        ? { ok: true, solvedAt: Math.min(solved, Date.now()) }
        : { ok: true };
    }
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
    if (!res.ok) return { ok: false, reason: 'unreachable', codes };
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
