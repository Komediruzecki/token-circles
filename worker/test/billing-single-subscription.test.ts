/**
 * One account, one subscription. Ever.
 *
 * WHAT WENT WRONG. `POST /api/billing/checkout` built a `mode: subscription` Checkout Session
 * unconditionally, and Stripe creates a NEW subscription for every one of those. Stripe allows a
 * customer to hold several at once -- a real feature, for products that sell more than one thing
 * -- so nothing anywhere refused. Switching Basic -> Advanced -> Basic left three live
 * subscriptions on one customer, all three billing the same card, while `users` showed whichever
 * webhook happened to land last. The portal showed three cancellable rows and no way to tell
 * which one the app was talking about.
 *
 * THE FIX. If the customer already holds a live subscription, a tier change is an UPDATE of that
 * subscription's price, not a purchase. These tests are the guarantee: the assertion that matters
 * in almost every case below is `sessions()` being empty -- no Checkout Session created -- and it
 * is asserted even in the failure paths, because "we could not tell what exists" must never
 * resolve to "so create another one".
 *
 * The companion file billing-webhook-strays.test.ts covers the other half: what the webhook does
 * when one of several subscriptions ends.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const UID = 8500;
const CUSTOMER = 'cus_SingleSub';
const BASIC = 'price_basic_monthly_test';
const ADVANCED = 'price_advanced_monthly_test';
const ADVANCED_ANNUAL = 'price_advanced_annual_test';

/** Every call the worker made to Stripe: method, path, and the form body for POSTs. */
let calls: Array<{ method: string; path: string; params: URLSearchParams }> = [];
/** What the subscriptions list endpoint answers with. */
let listReply: () => Response;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** A Stripe subscription as the list endpoint returns it. */
const stripeSub = (
  id: string,
  priceId: string,
  status = 'active',
  extra: Record<string, unknown> = {}
) => ({
  id,
  status,
  created: Number(id.replace(/\D/g, '')) || 1,
  items: { data: [{ id: `si_${id}`, price: { id: priceId }, current_period_end: 1800000000 }] },
  ...extra,
});

const posts = (pathFragment: string) =>
  calls.filter((c) => c.method === 'POST' && c.path.includes(pathFragment));
/** Checkout Sessions created. Empty is the point of this file. */
const sessions = () => posts('checkout/sessions');
const updates = () => posts('subscriptions/');

const seed = async (customer: string | null, subscriptionId: string | null = null) =>
  env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, stripe_customer_id, stripe_subscription_id) VALUES (?, ?, ?, ?, 1, 1, ?, ?)'
  )
    .bind(UID, 'switcher@example.com', 'pbkdf2$100000$x$y', 'password', customer, subscriptionId)
    .run();

const choose = async (plan: string, interval: 'monthly' | 'annual' = 'monthly') =>
  SELF.fetch('https://api.example.com/api/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: (await issueSessionCookie(UID, 'password', env)).split(';')[0],
    },
    body: JSON.stringify({ plan, interval }),
  });

beforeEach(async () => {
  calls = [];
  listReply = () => ok({ data: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://api.stripe.com/'))
        return new Response('unexpected', { status: 500 });
      const method = init?.method ?? 'GET';
      const path = url.slice('https://api.stripe.com/v1/'.length);
      calls.push({ method, path, params: new URLSearchParams(String(init?.body ?? '')) });
      if (method === 'GET') return listReply();
      if (path.startsWith('subscriptions/')) return ok(stripeSub('sub_updated', ADVANCED));
      return ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
    })
  );
  env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  env.STRIPE_PRICE_BASIC_MONTHLY = BASIC;
  env.STRIPE_PRICE_ADVANCED_MONTHLY = ADVANCED;
  env.STRIPE_PRICE_ADVANCED_ANNUAL = ADVANCED_ANNUAL;
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.STRIPE_SECRET_KEY;
  delete env.STRIPE_PRICE_BASIC_MONTHLY;
  delete env.STRIPE_PRICE_ADVANCED_MONTHLY;
  delete env.STRIPE_PRICE_ADVANCED_ANNUAL;
});

describe('switching tier never creates a second subscription', () => {
  it('moves the existing subscription onto the new price instead of buying another', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', BASIC)] });

    const res = await choose('advanced');

    expect(res.status).toBe(200);
    // The assertion this entire file exists for.
    expect(sessions()).toHaveLength(0);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].path).toBe('subscriptions/sub_1');
  });

  it('replaces the existing item rather than appending a second one', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', BASIC)] });

    await choose('advanced');

    const p = updates()[0].params;
    // Omit items[0][id] and Stripe ADDS a line -- one subscription billing both tiers, which is
    // the same bug wearing a different hat.
    expect(p.get('items[0][id]')).toBe('si_sub_1');
    expect(p.get('items[0][price]')).toBe(ADVANCED);
    // Bill the difference next cycle. An immediate invoice can demand SCA, and a POST from a
    // settings page has nowhere to send someone to complete it.
    expect(p.get('proration_behavior')).toBe('create_prorations');
    // customer.subscription.updated reads the tier back off this metadata; leaving it stale
    // would have the webhook re-apply the tier the user just left.
    expect(p.get('metadata[plan]')).toBe('advanced');
    expect(p.get('metadata[interval]')).toBe('monthly');
  });

  it('answers with no url, so the page knows not to redirect', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', BASIC)] });

    const body = (await (await choose('advanced')).json()) as {
      url: string | null;
      changed: boolean;
      plan: string;
    };

    expect(body.url).toBeNull();
    expect(body.changed).toBe(true);
    expect(body.plan).toBe('advanced');
  });

  it('switches interval on the same tier too', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', ADVANCED)] });

    await choose('advanced', 'annual');

    expect(sessions()).toHaveLength(0);
    expect(updates()[0].params.get('items[0][price]')).toBe(ADVANCED_ANNUAL);
    expect(updates()[0].params.get('metadata[interval]')).toBe('annual');
  });

  it('does nothing at all when the plan asked for is the plan already held', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', ADVANCED)] });

    const res = await choose('advanced');
    const body = (await res.json()) as { changed: boolean };

    expect(body.changed).toBe(false);
    // Not merely "no session" -- no WRITE. A no-op update would still emit a webhook and a
    // zero-value proration.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('what counts as already subscribed', () => {
  it('counts a trial: selling a trialing customer a second subscription is the same bug', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', BASIC, 'trialing')] });

    await choose('advanced');

    expect(sessions()).toHaveLength(0);
    expect(updates()).toHaveLength(1);
  });

  it('counts past_due — the card is failing, not gone, and Stripe is still retrying', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () => ok({ data: [stripeSub('sub_1', BASIC, 'past_due')] });

    await choose('advanced');

    expect(sessions()).toHaveLength(0);
    expect(updates()).toHaveLength(1);
  });

  it('does not count a canceled one, so re-subscribing still opens checkout', async () => {
    // The returning-subscriber path. There is nothing live to move, so a new subscription is
    // exactly right here -- refusing would leave them unable to buy anything.
    await seed(CUSTOMER, 'sub_old');
    listReply = () =>
      ok({
        data: [
          stripeSub('sub_old', BASIC, 'canceled'),
          stripeSub('sub_older', BASIC, 'incomplete_expired'),
        ],
      });

    const res = await choose('advanced');

    expect(res.status).toBe(200);
    expect(updates()).toHaveLength(0);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].params.get('customer')).toBe(CUSTOMER);
  });

  it('does not count unpaid or incomplete', async () => {
    await seed(CUSTOMER, null);
    listReply = () =>
      ok({ data: [stripeSub('sub_a', BASIC, 'unpaid'), stripeSub('sub_b', BASIC, 'incomplete')] });

    await choose('advanced');

    expect(sessions()).toHaveLength(1);
    expect(updates()).toHaveLength(0);
  });

  it('never asks Stripe anything for an account with no customer id', async () => {
    await seed(null);

    const res = await choose('advanced');

    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].params.get('customer_email')).toBe('switcher@example.com');
  });
});

describe('accounts that already have duplicates', () => {
  it('switches exactly one of them and creates none', async () => {
    await seed(CUSTOMER, null); // predates the tracking column — the accounts that have strays
    listReply = () =>
      ok({
        data: [stripeSub('sub_1', BASIC), stripeSub('sub_2', ADVANCED), stripeSub('sub_3', BASIC)],
      });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await choose('advanced');

    expect(sessions()).toHaveLength(0);
    expect(updates()).toHaveLength(1);
    // Newest first: sub_3 is the one the account most recently ended up on.
    expect(updates()[0].path).toBe('subscriptions/sub_3');
    // Nothing else on this path would ever say out loud that somebody is paying twice.
    const line = logged.mock.calls.flat().join(' ');
    expect(line).toContain('more than one live subscription');
    expect(line).toContain('sub_1');
    logged.mockRestore();
  });

  it('prefers the subscription the account is actually on over the newest', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () =>
      ok({ data: [stripeSub('sub_1', BASIC), stripeSub('sub_9', ADVANCED_ANNUAL)] });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await choose('advanced');

    // sub_9 is newer, but sub_1 is the one whose tier the app is displaying and enforcing.
    expect(updates()[0].path).toBe('subscriptions/sub_1');
    logged.mockRestore();
  });

  it('falls back to the newest when the tracked one is already gone', async () => {
    await seed(CUSTOMER, 'sub_vanished');
    listReply = () => ok({ data: [stripeSub('sub_2', BASIC), stripeSub('sub_7', BASIC)] });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await choose('advanced');

    expect(sessions()).toHaveLength(0);
    expect(updates()[0].path).toBe('subscriptions/sub_7');
    logged.mockRestore();
  });
});

describe('when Stripe cannot be asked', () => {
  it('fails the request rather than risking a duplicate', async () => {
    // The single most important negative in this file. Not knowing whether a subscription
    // exists is not a reason to create one: an error here is recoverable, a second live
    // subscription is somebody's money.
    await seed(CUSTOMER, 'sub_1');
    listReply = () =>
      new Response(JSON.stringify({ error: { type: 'api_error', message: 'upstream' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await choose('advanced');

    expect(res.status).toBe(502);
    expect(sessions()).toHaveLength(0);
    expect(updates()).toHaveLength(0);
    logged.mockRestore();
  });

  it('keeps Stripe’s wording out of the response here too', async () => {
    await seed(CUSTOMER, 'sub_1');
    listReply = () =>
      new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'No such customer' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const body = (await (await choose('advanced')).json()) as { error?: string };

    expect(body.error).not.toContain('No such customer');
    expect(logged.mock.calls.flat().join(' ')).toContain('No such customer');
    logged.mockRestore();
  });

  it('ignores a malformed subscription rather than treating it as live', async () => {
    // A row with no items array cannot be updated -- there is no item id to target. Skipping it
    // is right; pretending it is live would leave the account unable to buy anything.
    await seed(CUSTOMER, null);
    listReply = () => ok({ data: [{ id: 'sub_broken', status: 'active' }] });

    const res = await choose('advanced');

    expect(res.status).toBe(200);
    expect(sessions()).toHaveLength(1);
  });
});

describe('the gates in front of all of this still hold', () => {
  it('refuses an unverified password account before touching Stripe', async () => {
    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, stripe_customer_id) VALUES (?, ?, ?, ?, 0, 1, ?)'
    )
      .bind(UID, 'unverified@example.com', 'pbkdf2$100000$x$y', 'password', CUSTOMER)
      .run();

    const res = await choose('advanced');

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses a tier that has no Price configured, without asking Stripe', async () => {
    await seed(CUSTOMER, 'sub_1');

    const res = await choose('ultimate');

    expect(res.status).toBe(501);
    expect(calls).toHaveLength(0);
  });
});
