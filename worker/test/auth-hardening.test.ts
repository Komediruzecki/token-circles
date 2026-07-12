/**
 * Audit auth hardening regressions, run against the real worker in workerd via Miniflare.
 *   - S7: passwords are hashed with PBKDF2 at 600k iterations; a registered user can log in and a
 *         wrong password is rejected.
 *   - S9: verifyTurnstile fails CLOSED when TURNSTILE_SECRET is unset in a deployed environment
 *         (APP_ENV !== 'development'), and stays open for local dev (APP_ENV === 'development').
 *
 * Worker deps can't install in the CI sandbox — run locally with `pnpm -C worker test`.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import type { AppEnv } from '../src/index';
import { hashPassword, verifyPassword } from '../src/auth';
import { verifyTurnstile } from '../src/turnstile';

// ── S7: PBKDF2 at 600k iterations ─────────────────────────────────────────────

describe('password hashing (audit S7)', () => {
  beforeEach(async () => {
    for (const t of ['transactions', 'accounts', 'categories', 'profiles', 'users']) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
  });

  it('hashes at 600k iterations and round-trips verification', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('pbkdf2$600000$')).toBe(true);
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
