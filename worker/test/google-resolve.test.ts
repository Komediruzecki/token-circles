/**
 * resolveGoogleUser contract — the function was reshaped in the branded-emails
 * change (returns { userId, created, email } so the OAuth callback can send a
 * welcome mail to brand-new accounts). These tests pin all three resolution
 * paths against the real D1 schema so a Google sign-in regression can't hide.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveGoogleUser } from '../src/auth';

const CLAIMS = {
  sub: 'google-sub-123',
  email: 'gina@example.com',
  email_verified: 'true',
} as Parameters<typeof resolveGoogleUser>[1];

describe('resolveGoogleUser', () => {
  beforeEach(async () => {
    for (const t of ['transactions', 'accounts', 'categories', 'profiles', 'users']) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
  });

  it('creates a brand-new google user with a default profile and reports created', async () => {
    const res = await resolveGoogleUser(env.DB, CLAIMS);
    expect(res.created).toBe(true);
    expect(res.email).toBe('gina@example.com');
    expect(res.userId).toBeGreaterThan(0);

    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(res.userId)
      .first<{ auth_provider: string; provider_id: string; email: string }>();
    expect(user?.auth_provider).toBe('google');
    expect(user?.provider_id).toBe('google-sub-123');
    const profile = await env.DB.prepare('SELECT name FROM profiles WHERE user_id = ?')
      .bind(res.userId)
      .first<{ name: string }>();
    expect(profile?.name).toBe('Personal Profile');
  });

  it('returns the SAME user (created=false) on a repeat sign-in', async () => {
    const first = await resolveGoogleUser(env.DB, CLAIMS);
    const again = await resolveGoogleUser(env.DB, CLAIMS);
    expect(again.userId).toBe(first.userId);
    expect(again.created).toBe(false);
  });

  it('links a verified google identity to an existing email account without creating', async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, token_version) VALUES (900, 'gina@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
    ).run();
    const res = await resolveGoogleUser(env.DB, CLAIMS);
    expect(res.userId).toBe(900);
    expect(res.created).toBe(false);
    const user = await env.DB.prepare(
      'SELECT auth_provider, provider_id FROM users WHERE id = 900'
    ).first<{ auth_provider: string; provider_id: string }>();
    expect(user?.auth_provider).toBe('google');
    expect(user?.provider_id).toBe('google-sub-123');
  });

  it('does not store an unverified email and still creates the account', async () => {
    const res = await resolveGoogleUser(env.DB, {
      ...CLAIMS,
      email_verified: 'false',
    } as typeof CLAIMS);
    expect(res.created).toBe(true);
    expect(res.email).toBeNull();
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(res.userId)
      .first<{ email: string | null }>();
    expect(user?.email).toBeNull();
  });
});
