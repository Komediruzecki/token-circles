/**
 * A password account has to confirm its address before it can start paying.
 *
 * Everything else about verification is a soft nudge. This one is hard, and the cases that
 * matter are the ones it must NOT catch: a Google account (verified by Google), and anybody
 * already subscribed reaching the portal to cancel. A gate that traps an existing subscriber
 * away from the cancel button is worse than no gate.
 *
 * STRIPE_SECRET_KEY is unset in tests, so "got past the gate" reads as 501 (billing not
 * configured) rather than a real Stripe call. That is exactly why the account precondition is
 * checked before the Stripe config: it is a fact about the user either way.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

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

const session = async (): Promise<string> =>
  (await issueSessionCookie(UID, 'password', env)).split(';')[0];

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
  (await (
    await SELF.fetch('https://api.example.com/api/billing/status', {
      headers: { Cookie: await session() },
    })
  ).json()) as { email_verification_required?: boolean };

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
});

describe('POST /api/billing/checkout', () => {
  it('refuses an unconfirmed password account, and says why', async () => {
    await seed({ provider: 'password', verified: 0 });

    const res = await checkout();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Confirm your email address before subscribing' });
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
  it('stays open to an unconfirmed account that is already paying', async () => {
    // The one thing this gate must never do: strand a subscriber away from the cancel button.
    await seed({ provider: 'password', verified: 0, customer: 'cus_existing' });

    const res = await portal();

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(501);
  });
});

describe('GET /api/billing/status', () => {
  it('tells the upgrade panel to ask, rather than letting it find out at Stripe', async () => {
    await seed({ provider: 'password', verified: 0 });

    expect((await status()).email_verification_required).toBe(true);
  });

  it('says nothing to ask once the address is confirmed', async () => {
    await seed({ provider: 'password', verified: 1 });

    expect((await status()).email_verification_required).toBe(false);
  });

  it('says nothing to ask for a Google account', async () => {
    await seed({ provider: 'google', verified: 0 });

    expect((await status()).email_verification_required).toBe(false);
  });
});
