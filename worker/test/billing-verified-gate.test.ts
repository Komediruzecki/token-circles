/**
 * A password account has to confirm its address before it can start paying.
 *
 * Its session reaches no billing route before then: requireAuth answers it 403 EMAIL_UNCONFIRMED
 * (confirm-email-gate.test.ts), ahead of billing's own check. The cases that matter are the ones
 * it must NOT catch: a Google account (verified by Google), and a password account once its
 * address is confirmed.
 *
 * STRIPE_SECRET_KEY is unset in tests, so "got past the gate" reads as 501 (billing not
 * configured) rather than a real Stripe call. That is exactly why the account precondition is
 * checked before the Stripe config: it is a fact about the user either way.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { unconfirmedSessionCookie } from './helpers/session';

const UID = 8200;

async function seed(opts: { provider: string; verified: number; customer?: string | null }) {
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)'
  )
    .bind(
      UID,
      'buyer@example.com',
      opts.provider === 'password' ? 'pbkdf2$100000$x$y' : null,
      opts.provider,
      opts.verified,
      opts.customer ?? null
    )
    .run();
}

/** A session that leaves the address as the test seeded it. */
const session = async (): Promise<string> =>
  (await unconfirmedSessionCookie(UID, 'password', env)).split(';')[0];

const UNCONFIRMED = {
  error: 'Confirm your email address to use this account. Open the link we emailed you.',
  code: 'EMAIL_UNCONFIRMED',
};

const checkout = async () =>
  SELF.fetch('https://api.example.com/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: await session() },
    body: JSON.stringify({ plan: 'advanced', interval: 'monthly' }),
  });

const portal = async () =>
  SELF.fetch('https://api.example.com/api/billing/portal', {
    method: 'POST',
    headers: { Cookie: await session() },
  });

const status = async () =>
  SELF.fetch('https://api.example.com/api/billing/status', {
    headers: { Cookie: await session() },
  });

const asked = async () =>
  ((await (await status()).json()) as { email_verification_required?: boolean })
    .email_verification_required;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
});

describe('POST /api/billing/checkout', () => {
  it('refuses an unconfirmed password account, and says why', async () => {
    await seed({ provider: 'password', verified: 0 });

    const res = await checkout();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(UNCONFIRMED);
  });

  it('lets a confirmed password account through', async () => {
    await seed({ provider: 'password', verified: 1 });

    const res = await checkout();

    // 501 = past the gate, stopped by billing not being configured in tests.
    expect(res.status).toBe(501);
  });

  it('never gates a Google account, which Google verified', async () => {
    // auth_provider = 'google' with email_verified = 0 is a real state: Google reports an
    // unverified address by leaving it off the account. Gating on the flag alone would lock
    // those users out of paying with no way to fix it — there is no password to reset.
    await seed({ provider: 'google', verified: 0 });

    const res = await checkout();

    expect(res.status).toBe(501);
  });
});

describe('POST /api/billing/portal', () => {
  it('opens for an account already paying once its address is confirmed, and not before', async () => {
    // A password account that subscribed before checkout asked for a confirmed address. It meets
    // the confirm screen like any other, and reaches the portal from the moment it confirms.
    await seed({ provider: 'password', verified: 0, customer: 'cus_existing' });

    const before = await portal();
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(UID).run();
    const after = await portal();

    expect(before.status).toBe(403);
    expect(await before.json()).toEqual(UNCONFIRMED);
    expect(after.status).toBe(501);
  });
});

describe('GET /api/billing/status', () => {
  it('is not reached by an unconfirmed password account, which sees the confirm screen instead', async () => {
    await seed({ provider: 'password', verified: 0 });

    const res = await status();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(UNCONFIRMED);
  });

  it('says nothing to ask once the address is confirmed', async () => {
    await seed({ provider: 'password', verified: 1 });

    expect(await asked()).toBe(false);
  });

  it('says nothing to ask for a Google account', async () => {
    await seed({ provider: 'google', verified: 0 });

    expect(await asked()).toBe(false);
  });
});
