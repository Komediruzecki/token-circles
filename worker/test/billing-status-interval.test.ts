/**
 * `/api/billing/status` reports the billing interval.
 *
 * The column has been written by the webhook since migration 0025 and read back by nothing, so
 * the app could not say whether an account was on monthly or annual — and, worse, could not tell
 * a monthly -> annual switch from a no-op. The tier either side of that switch is the same one
 * and is already entitled, so the client's "has it landed yet?" check matched on the first read
 * and announced a change Stripe had not made. The interval is the only field that separates
 * before from after, which is why it has to reach the client.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const UID = 8600;

async function seed(interval: string | null, plan = 'basic', status: string | null = 'active') {
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, plan, subscription_status, subscription_interval) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)'
  )
    .bind(UID, 'interval@example.com', 'pbkdf2$100000$x$y', 'password', plan, status, interval)
    .run();
}

const status = async () =>
  (await (
    await SELF.fetch('https://api.example.com/api/billing/status', {
      headers: { Cookie: (await issueSessionCookie(UID, 'password', env)).split(';')[0] },
    })
  ).json()) as { plan: string; status: string | null; interval: string | null };

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
});

describe('GET /api/billing/status — interval', () => {
  it('reports an annual subscription as annual', async () => {
    await seed('annual');

    expect(await status()).toMatchObject({ plan: 'basic', interval: 'annual' });
  });

  it('reports a monthly subscription as monthly', async () => {
    await seed('monthly');

    expect(await status()).toMatchObject({ plan: 'basic', interval: 'monthly' });
  });

  it('reports null for a subscription that predates the column', async () => {
    // Not 'monthly'. A row written before 0025 has no interval, and guessing the commoner one
    // would put a number on the billing card that nobody verified — and would make the client
    // wait out its whole backoff for an interval that is never going to arrive.
    await seed(null);

    expect((await status()).interval).toBeNull();
  });

  it('reports null on a free account, which has no subscription to have an interval', async () => {
    await seed(null, 'free', null);

    expect(await status()).toMatchObject({ plan: 'free', interval: null });
  });
});
