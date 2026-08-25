/**
 * What the webhook does when a customer holds more than one subscription.
 *
 * It should not be possible any more -- checkout now moves the existing subscription instead of
 * creating a second one (billing-single-subscription.test.ts) -- but every account that switched
 * tier before that fix is still carrying strays, and a subscription created from the Stripe
 * dashboard would look exactly the same. So the webhook has to survive the state regardless.
 *
 * THE BUG THIS PINS. Every branch matched on `stripe_customer_id` alone, which cannot tell "the
 * subscription this account is on ended" from "one of the strays ended". A
 * `customer.subscription.deleted` for ANY of them set the account to free -- while the others
 * carried on charging the card. Paying and locked out at the same time is the most expensive
 * wrong answer available here, so it gets the most tests.
 *
 * `users.stripe_subscription_id` (migration 0026) is what makes the question answerable. NULL
 * means "not tracked yet", which every row predating the migration is, and must keep behaving
 * exactly as it did.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UID = 8600;
const CUSTOMER = 'cus_Strays';
const SECRET = 'whsec_test_dummy';
const BASIC = 'price_basic_monthly_test';
const ADVANCED_ANNUAL = 'price_advanced_annual_test';

const encoder = new TextEncoder();

/** The same signature app code verifies: HMAC-SHA256(secret, `${t}.${payload}`), hex, as v1. */
async function signed(payload: string): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${payload}`));
  const v1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${v1}`;
}

let eventSeq = 0;
async function deliver(type: string, object: Record<string, unknown>): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_stray_${++eventSeq}`,
    type,
    created: Math.floor(Date.now() / 1000) + eventSeq,
    data: { object },
  });
  return SELF.fetch('https://api.example.com/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': await signed(payload) },
    body: payload,
  });
}

/** What Stripe answers when the webhook asks what is still live. */
let listReply: () => Response;
/** Times the webhook asked. */
let lookups = 0;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

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

const readUser = () =>
  env.DB.prepare(
    'SELECT plan, subscription_status, subscription_interval, stripe_subscription_id, cancel_at_period_end, plan_renews_at FROM users WHERE id = ?'
  )
    .bind(UID)
    .first<{
      plan: string;
      subscription_status: string | null;
      subscription_interval: string | null;
      stripe_subscription_id: string | null;
      cancel_at_period_end: number | null;
      plan_renews_at: string | null;
    }>();

/** Put the account on a paid plan tracking `subscriptionId`, the way a real checkout would. */
const subscribedTo = async (subscriptionId: string | null, plan = 'basic') =>
  env.DB.prepare(
    'UPDATE users SET plan = ?, subscription_status = ?, subscription_interval = ?, stripe_subscription_id = ? WHERE id = ?'
  )
    .bind(plan, 'active', 'monthly', subscriptionId, UID)
    .run();

beforeEach(async () => {
  eventSeq += 100; // keep `created` moving forward across tests, past every watermark
  lookups = 0;
  listReply = () => ok({ data: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://api.stripe.com/')) return new Response('{}', { status: 200 });
      lookups += 1;
      return listReply();
    })
  );
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  // Without a key liveSubscriptions short-circuits to "nothing live" and never asks — which is
  // right for a self-hosted install with billing off, but would make these tests vacuous.
  env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  env.STRIPE_PRICE_BASIC_MONTHLY = BASIC;
  env.STRIPE_PRICE_ADVANCED_ANNUAL = ADVANCED_ANNUAL;
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM stripe_events').run();
  await env.DB.prepare(
    'INSERT INTO users (id, email, auth_provider, email_verified, token_version, stripe_customer_id) VALUES (?, ?, ?, 1, 1, ?)'
  )
    .bind(UID, 'strays@example.com', 'google', CUSTOMER)
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.STRIPE_WEBHOOK_SECRET;
  delete env.STRIPE_SECRET_KEY;
  delete env.STRIPE_PRICE_BASIC_MONTHLY;
  delete env.STRIPE_PRICE_ADVANCED_ANNUAL;
});

describe('recording which subscription the account is on', () => {
  it('stores it from the checkout session that created it', async () => {
    await deliver('checkout.session.completed', {
      client_reference_id: String(UID),
      customer: CUSTOMER,
      subscription: 'sub_new',
      metadata: { plan: 'basic', interval: 'monthly' },
    });

    expect(await readUser()).toMatchObject({ plan: 'basic', stripe_subscription_id: 'sub_new' });
  });

  it('does not blank it for a session that carries no subscription', async () => {
    await subscribedTo('sub_live');

    await deliver('checkout.session.completed', {
      client_reference_id: String(UID),
      customer: CUSTOMER,
      metadata: { plan: 'basic' },
    });

    expect((await readUser())?.stripe_subscription_id).toBe('sub_live');
  });

  it('stores it from an entitled subscription event', async () => {
    await deliver('customer.subscription.created', {
      id: 'sub_created',
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'basic', interval: 'monthly' },
      items: { data: [{ price: { id: BASIC }, current_period_end: 1800000000 }] },
    });

    expect(await readUser()).toMatchObject({
      plan: 'basic',
      stripe_subscription_id: 'sub_created',
    });
  });

  it('adopts an entitled event for a different subscription — that is money being paid', async () => {
    // The one direction that is always safe: whatever they are paying for is what they get.
    await subscribedTo('sub_old');

    await deliver('customer.subscription.updated', {
      id: 'sub_other',
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'advanced', interval: 'annual' },
      items: { data: [{ price: { id: ADVANCED_ANNUAL }, current_period_end: 1800000000 }] },
    });

    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_interval: 'annual',
      stripe_subscription_id: 'sub_other',
    });
  });
});

describe('a stray ending does not end the account’s plan', () => {
  it('ignores a deleted event for a subscription the account is not on', async () => {
    await subscribedTo('sub_live', 'advanced');

    const res = await deliver('customer.subscription.deleted', {
      id: 'sub_stray',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_status: 'active',
      stripe_subscription_id: 'sub_live',
    });
    // Nothing to check: the id alone settled it.
    expect(lookups).toBe(0);
  });

  it('ignores a non-entitled update for a stray', async () => {
    await subscribedTo('sub_live', 'advanced');

    await deliver('customer.subscription.updated', {
      id: 'sub_stray',
      customer: CUSTOMER,
      status: 'incomplete_expired',
      items: { data: [{ price: { id: BASIC } }] },
    });

    expect(await readUser()).toMatchObject({ plan: 'advanced', subscription_status: 'active' });
  });

  it('moves a survivor in when the tracked one goes unpaid, not only when it is deleted', async () => {
    // `deleted` is not the only way out of entitlement -- an `updated` can land on unpaid or
    // incomplete_expired. Both mean the same thing for the account, so both get the same answer;
    // handling only one of them would leave a hole shaped exactly like the original bug.
    await subscribedTo('sub_live', 'basic');
    listReply = () => ok({ data: [stripeSub('sub_survivor', ADVANCED_ANNUAL)] });

    await deliver('customer.subscription.updated', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'unpaid',
      items: { data: [{ price: { id: BASIC } }] },
    });

    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_status: 'active',
      stripe_subscription_id: 'sub_survivor',
    });
  });

  it('still applies a non-entitled update for the tracked subscription', async () => {
    // The guard must not become a way to never lose a plan.
    await subscribedTo('sub_live', 'advanced');

    await deliver('customer.subscription.updated', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
      items: { data: [{ price: { id: BASIC } }] },
    });

    expect(await readUser()).toMatchObject({
      plan: 'free',
      subscription_status: 'canceled',
      subscription_interval: null,
      stripe_subscription_id: null,
    });
  });
});

describe('the tracked subscription ending', () => {
  it('drops to free when nothing else is live', async () => {
    await subscribedTo('sub_live', 'advanced');
    listReply = () => ok({ data: [] });

    await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(await readUser()).toMatchObject({
      plan: 'free',
      subscription_status: 'canceled',
      subscription_interval: null,
      stripe_subscription_id: null,
      plan_renews_at: null,
    });
    expect(lookups).toBe(1);
  });

  it('moves onto whatever is still live instead of locking out someone still paying', async () => {
    // The expensive case, and the reason for the lookup. Cancelling one of several used to set
    // the account to free while the rest kept charging the card.
    await subscribedTo('sub_live', 'basic');
    listReply = () => ok({ data: [stripeSub('sub_survivor', ADVANCED_ANNUAL)] });

    await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_status: 'active',
      subscription_interval: 'annual',
      stripe_subscription_id: 'sub_survivor',
    });
    expect((await readUser())?.plan_renews_at).toContain('20');
  });

  it('reads the survivor’s own metadata over its Price', async () => {
    await subscribedTo('sub_live', 'basic');
    listReply = () =>
      ok({
        data: [
          stripeSub('sub_survivor', 'price_unknown_to_this_env', 'active', {
            metadata: { plan: 'advanced', interval: 'monthly' },
          }),
        ],
      });

    await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_interval: 'monthly',
    });
  });

  it('carries the survivor’s pending cancellation across', async () => {
    await subscribedTo('sub_live', 'basic');
    listReply = () =>
      ok({ data: [stripeSub('sub_survivor', BASIC, 'active', { cancel_at_period_end: true })] });

    await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    // Saying "renews" about a subscription already set to end would be a small, specific lie.
    expect((await readUser())?.cancel_at_period_end).toBe(1);
  });

  it('never adopts the subscription that just ended', async () => {
    // Stripe reports a deleted subscription as canceled, so the status filter already excludes
    // it — but a list that lagged by a second must not resurrect the plan either.
    await subscribedTo('sub_live', 'basic');
    listReply = () => ok({ data: [stripeSub('sub_live', BASIC, 'active')] });

    await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(await readUser()).toMatchObject({ plan: 'free', stripe_subscription_id: null });
  });

  it('ignores survivors that are not entitled', async () => {
    await subscribedTo('sub_live', 'basic');
    listReply = () => ok({ data: [stripeSub('sub_dead', BASIC, 'incomplete_expired')] });

    await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(await readUser()).toMatchObject({ plan: 'free' });
  });
});

describe('failure and legacy paths', () => {
  it('falls back to free when Stripe cannot be reached, and still acks', async () => {
    // An unacked webhook is retried, and the retry is swallowed by the idempotency ledger — so
    // throwing here would lose the event outright. Free is what this branch did before the
    // lookup existed, and it fails in the safe direction: inferring "still entitled" from an
    // error would hand out the product.
    await subscribedTo('sub_live', 'advanced');
    listReply = () => new Response('boom', { status: 500 });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver('customer.subscription.deleted', {
      id: 'sub_live',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({ plan: 'free', subscription_status: 'canceled' });
    logged.mockRestore();
  });

  it('treats an untracked row as a match, so a legacy account can still cancel', async () => {
    // Every row predating migration 0026. NULL has to mean "no opinion" and never "no match", or
    // the first cancel after deploy would be ignored and the plan would outlive the payment.
    await subscribedTo(null, 'advanced');

    await deliver('customer.subscription.deleted', {
      id: 'sub_whatever',
      customer: CUSTOMER,
      status: 'canceled',
    });

    expect(await readUser()).toMatchObject({ plan: 'free', subscription_status: 'canceled' });
  });

  it('treats an event with no subscription id as a match rather than skipping it', async () => {
    await subscribedTo('sub_live', 'advanced');

    await deliver('customer.subscription.deleted', { customer: CUSTOMER, status: 'canceled' });

    expect(await readUser()).toMatchObject({ plan: 'free' });
  });

  it('still refuses an event older than the last one applied', async () => {
    // The ordering watermark predates all of this and must survive it: a late `deleted` cannot
    // undo a subscription that has since been re-created.
    await subscribedTo('sub_live', 'advanced');
    const payload = JSON.stringify({
      id: 'evt_stray_ancient',
      type: 'customer.subscription.deleted',
      created: 1,
      data: { object: { id: 'sub_live', customer: CUSTOMER, status: 'canceled' } },
    });
    await env.DB.prepare('UPDATE users SET stripe_event_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), UID)
      .run();

    const res = await SELF.fetch('https://api.example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': await signed(payload) },
      body: payload,
    });

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({ plan: 'advanced', subscription_status: 'active' });
  });

  it('is idempotent — a redelivered cancel does not re-run the lookup', async () => {
    await subscribedTo('sub_live', 'advanced');
    const payload = JSON.stringify({
      id: 'evt_stray_dupe',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000) + 500,
      data: { object: { id: 'sub_live', customer: CUSTOMER, status: 'canceled' } },
    });
    const send = async () =>
      SELF.fetch('https://api.example.com/api/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': await signed(payload) },
        body: payload,
      });

    await send();
    const second = await send();

    expect((await second.json()) as { duplicate?: boolean }).toMatchObject({ duplicate: true });
    expect(lookups).toBe(1);
  });
});
