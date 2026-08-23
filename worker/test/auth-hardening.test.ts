/**
 * Audit auth hardening regressions, run against the real worker in workerd via Miniflare.
 *   - S7: passwords are hashed with PBKDF2 at 100k iterations (the Cloudflare Workers cap); a registered user can log in and a
 *         wrong password is rejected.
 *   - S9: verifyTurnstile fails CLOSED when TURNSTILE_SECRET is unset in a deployed environment
 *         (APP_ENV !== 'development'), and stays open for local dev (APP_ENV === 'development').
 *
 * Worker deps can't install in the CI sandbox — run locally with `pnpm -C worker test`.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import type { AppEnv } from '../src/index';
import { hashPassword, verifyPassword } from '../src/auth';
import {
  captchaRejection,
  turnstileConfigured,
  verifyTurnstile,
  verifyTurnstileDetailed,
} from '../src/turnstile';

// ── S7: PBKDF2 at 100k iterations (the Cloudflare Workers cap) ─────────────────────────────────────────────

describe('password hashing (audit S7)', () => {
  beforeEach(async () => {
    for (const t of ['transactions', 'accounts', 'categories', 'profiles', 'users']) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
  });

  it('hashes at 100k iterations and round-trips verification', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('a registered account can log in and is rejected on a wrong password', async () => {
    const email = 'user@example.com';
    const password = 'correct horse battery staple';
    const stored = await hashPassword(password);
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, token_version) VALUES (701, ?, ?, 'password', 1)"
    )
      .bind(email, stored)
      .run();
    await env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (7010, 701, ?)')
      .bind('Main')
      .run();

    const ok = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(ok.status).toBe(200);

    const bad = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'not-the-password' }),
    });
    expect(bad.status).toBe(401);
  });
});

// ── S9: Turnstile fail-closed when the secret is unset ────────────────────────

// verifyTurnstile only reads c.env in the no-secret branch, so a minimal fake Context is enough.
function fakeCtx(envOverrides: Record<string, unknown>): Context<AppEnv> {
  return { env: envOverrides, req: { header: () => undefined } } as unknown as Context<AppEnv>;
}

describe('turnstile fail-closed when secret unset (audit S9)', () => {
  it('fails closed in production (APP_ENV != development) with no secret', async () => {
    expect(await verifyTurnstile(fakeCtx({ APP_ENV: 'production' }), undefined)).toBe(false);
    // Even a non-empty token can't pass when the secret is unset in a deployed env.
    expect(await verifyTurnstile(fakeCtx({ APP_ENV: 'production' }), 'some-token')).toBe(false);
  });

  it('an unset APP_ENV is treated as non-development → fails closed', async () => {
    expect(await verifyTurnstile(fakeCtx({}), undefined)).toBe(false);
  });

  it('passes in local development with no secret', async () => {
    expect(await verifyTurnstile(fakeCtx({ APP_ENV: 'development' }), undefined)).toBe(true);
  });
});

/**
 * Failing closed is right; failing closed indistinguishably is what cost an afternoon.
 *
 * A dev deployment whose TURNSTILE_SECRET was never set refuses every password sign-in and
 * answers "Captcha verification failed" — the same words a genuinely bad token gets. The
 * widget still goes green, because the site key is fine and only the server half is
 * missing, so there is nothing on screen or in the response to point at the real cause.
 */
describe('a missing secret says so, instead of blaming the captcha', () => {
  function rejectionCtx(env: Record<string, unknown>) {
    const captured: { body?: unknown; status?: number } = {};
    const ctx = {
      env,
      json: (body: unknown, status?: number) => {
        captured.body = body;
        captured.status = status;
        return { body, status };
      },
    } as unknown as Context<AppEnv>;
    return { ctx, captured };
  }

  it('reports a deployment problem, not a captcha problem, when the secret is unset', () => {
    const { ctx, captured } = rejectionCtx({ APP_ENV: 'dev' });
    captchaRejection(ctx);
    // 503, because the server is misconfigured — the caller did nothing wrong and
    // retrying, which a 403 invites, cannot help.
    expect(captured.status).toBe(503);
    expect((captured.body as { code?: string }).code).toBe('captcha_not_configured');
    expect((captured.body as { error: string }).error).toContain('TURNSTILE_SECRET');
  });

  it('still blames the captcha when the gate is configured and the token is bad', () => {
    const { ctx, captured } = rejectionCtx({ APP_ENV: 'dev', TURNSTILE_SECRET: 'a-secret' });
    captchaRejection(ctx);
    expect(captured.status).toBe(403);
    expect((captured.body as { error: string }).error).toContain('Captcha verification failed');
  });

  it('blames the captcha in local development, where an unset secret is deliberate', () => {
    const { ctx, captured } = rejectionCtx({ APP_ENV: 'development' });
    captchaRejection(ctx);
    expect(captured.status).toBe(403);
  });

  it('knows whether the gate is on', () => {
    expect(turnstileConfigured({ TURNSTILE_SECRET: 'x' })).toBe(true);
    expect(turnstileConfigured({})).toBe(false);
    expect(turnstileConfigured({ TURNSTILE_SECRET: '' })).toBe(false);
  });
});

/**
 * The incident this came from was the blunter version of this: dev had no TURNSTILE_SECRET
 * at all. 5caef64 (2026-06-30) gave dev a site key, which switched the widget on and made
 * the frontend start sending tokens, while the worker took its fail-closed branch on every
 * one. Prod had its secret and kept working, so it read as a dev-only regression.
 *
 * A secret that is present but belongs to a different widget fails the same way from the
 * outside — green widget, 403, "captcha failed" — and is the harder of the two to see,
 * because `wrangler secret list` shows the name and says nothing about which widget it is
 * for. Cloudflare distinguishes them, so the code does too.
 */
describe('a secret that does not match the site key', () => {
  function fetchingCtx(env: Record<string, unknown>, payload: unknown) {
    const captured: { body?: unknown; status?: number } = {};
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const ctx = {
      env,
      req: { header: () => undefined },
      json: (body: unknown, status?: number) => {
        captured.body = body;
        captured.status = status;
        return { body, status };
      },
    } as unknown as Context<AppEnv>;
    return { ctx, captured };
  }

  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('is called out as a deployment fault, not a failed challenge', async () => {
    const { ctx, captured } = fetchingCtx(
      { APP_ENV: 'dev', TURNSTILE_SECRET: 'secret-for-the-other-widget' },
      { success: false, 'error-codes': ['invalid-input-secret'] }
    );
    const result = await verifyTurnstileDetailed(ctx, 'a-token-from-widget-b');
    expect(result).toEqual({
      ok: false,
      reason: 'secret-rejected',
      codes: ['invalid-input-secret'],
    });

    captchaRejection(ctx, result);
    expect(captured.status).toBe(503);
    expect((captured.body as { error: string }).error).toContain('does not match the site key');
  });

  it('still blames the caller for an expired or reused token', async () => {
    const { ctx, captured } = fetchingCtx(
      { APP_ENV: 'dev', TURNSTILE_SECRET: 'the-right-secret' },
      { success: false, 'error-codes': ['timeout-or-duplicate'] }
    );
    const result = await verifyTurnstileDetailed(ctx, 'a-stale-token');
    expect(result).toEqual({ ok: false, reason: 'rejected', codes: ['timeout-or-duplicate'] });

    captchaRejection(ctx, result);
    expect(captured.status).toBe(403);
    expect((captured.body as { error: string }).error).toContain('Captcha verification failed');
  });

  it('passes a genuine success through', async () => {
    const { ctx } = fetchingCtx(
      { APP_ENV: 'dev', TURNSTILE_SECRET: 'the-right-secret' },
      { success: true }
    );
    expect(await verifyTurnstileDetailed(ctx, 'a-good-token')).toEqual({ ok: true });
    expect(await verifyTurnstile(ctx, 'a-good-token')).toBe(true);
  });

  it('fails closed when siteverify cannot be reached', async () => {
    const realFetchLocal = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const ctx = {
      env: { APP_ENV: 'dev', TURNSTILE_SECRET: 'x' },
      req: { header: () => undefined },
    } as unknown as Context<AppEnv>;
    expect(await verifyTurnstileDetailed(ctx, 't')).toEqual({
      ok: false,
      reason: 'unreachable',
      codes: [],
    });
    globalThis.fetch = realFetchLocal;
  });
});
