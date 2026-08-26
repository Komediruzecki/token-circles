/**
 * The renewal date after a FIRST subscription.
 *
 * WHAT WENT WRONG, found on prod. A paying subscriber's billing card said "You're on the Basic
 * plan" with no renewal date, and `users.plan_renews_at` was NULL, with no error logged anywhere.
 *
 * A Checkout Session carries the tier but no period end. The event that does carry one --
 * customer.subscription.created/updated -- has two ways to miss for a first-time subscriber, and
 * it only has to lose once:
 *
 *   1. It matches on stripe_customer_id, which checkout.session.completed has only just written.
 *      An event that arrives BEFORE the session matches zero rows and is silently dropped.
 *   2. An event that arrives AFTER can still be refused, because its `created` is frequently a
 *      second EARLIER than the session's and the ordering guard rejects anything older than the
 *      watermark the session just advanced. That is exactly what prod's timeline showed:
 *      subscription.updated at 15:39:21, checkout.session.completed at 15:39:22.
 *
 * Nobody notices, because everything else about the account is right and the date reappears on
 * its own at the first renewal -- a month later. Returning subscribers were never affected: their
 * customer link already existed, so the subscription event matched.
 *
 * The fix reads the subscription from Stripe once the link exists. These tests pin that it fills
 * gaps and never overwrites, and that a Stripe failure cannot take the webhook down with it.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UID = 8700;
const CUSTOMER = 'cus_FirstCheckout';
const SECRET = 'whsec_test_dummy';
const BASIC = 'price_basic_monthly_test';
const ADVANCED_ANNUAL = 'price_advanced_annual_test';
/** 2026-09-23T15:38:53.000Z — the value prod was missing. */
const PERIOD_END = 1790177933;

const encoder = new TextEncoder();

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
    id: `evt_renewal_${++eventSeq}`,
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

let listReply: () => Response;
let lookups = 0;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const stripeSub = (
  id: string,
  priceId: string,
  currentPeriodEnd: number | null = PERIOD_END,
  extra: Record<string, unknown> = {}
) => ({
  id,
  status: 'active',
  created: 1,
  items: {
    data: [
      {
        id: `si_${id}`,
        price: { id: priceId },
        ...(currentPeriodEnd === null ? {} : { current_period_end: currentPeriodEnd }),
      },
    ],
  },
  ...extra,
});

/** The session Stripe sends when a first subscription completes. */
const session = (over: Record<string, unknown> = {}) => ({
  client_reference_id: String(UID),
  customer: CUSTOMER,
  subscription: 'sub_bought',
  metadata: { plan: 'basic', interval: 'monthly' },
  ...over,
});

const readUser = () =>
  env.DB.prepare(
    'SELECT plan, subscription_status, subscription_interval, plan_renews_at, stripe_subscription_id, stripe_customer_id FROM users WHERE id = ?'
  )
    .bind(UID)
    .first<{
      plan: string;
      subscription_status: string | null;
      subscription_interval: string | null;
      plan_renews_at: string | null;
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
    }>();

beforeEach(async () => {
  eventSeq += 100;
  lookups = 0;
  listReply = () => ok({ data: [stripeSub('sub_bought', BASIC)] });
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
  env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  env.STRIPE_PRICE_BASIC_MONTHLY = BASIC;
  env.STRIPE_PRICE_ADVANCED_ANNUAL = ADVANCED_ANNUAL;
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM stripe_events').run();
  // A brand-new subscriber: no customer link yet. That absence is the whole bug.
  await env.DB.prepare(
    'INSERT INTO users (id, email, auth_provider, email_verified, token_version) VALUES (?, ?, ?, 1, 1)'
  )
    .bind(UID, 'firsttimer@example.com', 'google')
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.STRIPE_WEBHOOK_SECRET;
  delete env.STRIPE_SECRET_KEY;
  delete env.STRIPE_PRICE_BASIC_MONTHLY;
  delete env.STRIPE_PRICE_ADVANCED_ANNUAL;
});

describe('a first subscription lands with its renewal date', () => {
  it('fills plan_renews_at, which the session itself cannot supply', async () => {
    const res = await deliver('checkout.session.completed', session());

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({
      plan: 'basic',
      subscription_status: 'active',
      plan_renews_at: '2026-09-23T15:38:53.000Z',
      stripe_subscription_id: 'sub_bought',
      stripe_customer_id: CUSTOMER,
    });
  });

  it('asks Stripe only after the customer link exists', async () => {
    // Asking earlier would be pointless -- the row it needs to write is found BY that link.
    await deliver('checkout.session.completed', session());

    expect(lookups).toBe(1);
  });

  it('reads the period end off the subscription item, the current Stripe shape', async () => {
    // prod's webhook endpoint is on a 2026 API version, where current_period_end sits on the
    // item rather than the subscription. Reading only the legacy top-level field returns nothing.
    listReply = () =>
      ok({
        data: [
          {
            id: 'sub_bought',
            status: 'active',
            created: 1,
            items: { data: [{ id: 'si_1', price: { id: BASIC }, current_period_end: PERIOD_END }] },
          },
        ],
      });

    await deliver('checkout.session.completed', session());

    expect((await readUser())?.plan_renews_at).toBe('2026-09-23T15:38:53.000Z');
  });

  it('picks the subscription the session names, not just any of them', async () => {
    listReply = () =>
      ok({
        data: [
          stripeSub('sub_someone_else', ADVANCED_ANNUAL, 1800000000),
          stripeSub('sub_bought', BASIC, PERIOD_END),
        ],
      });

    await deliver('checkout.session.completed', session());

    expect(await readUser()).toMatchObject({
      plan_renews_at: '2026-09-23T15:38:53.000Z',
      stripe_subscription_id: 'sub_bought',
    });
  });

  it('falls back to the only live subscription when the session names none', async () => {
    await deliver('checkout.session.completed', session({ subscription: undefined }));

    expect(await readUser()).toMatchObject({
      plan_renews_at: '2026-09-23T15:38:53.000Z',
      stripe_subscription_id: 'sub_bought',
    });
  });

  it('refuses to guess when the session names none and several are live', async () => {
    listReply = () =>
      ok({ data: [stripeSub('sub_a', BASIC), stripeSub('sub_b', ADVANCED_ANNUAL, 1800000000)] });

    await deliver('checkout.session.completed', session({ subscription: undefined }));

    // The tier still lands from the session; only the date it cannot attribute is left alone.
    expect(await readUser()).toMatchObject({ plan: 'basic', plan_renews_at: null });
  });
});

describe('it fills gaps and never overwrites', () => {
  it('keeps a date a subscription event already wrote', async () => {
    // The race is a race: sometimes the subscription event wins, and when it does it wrote the
    // truth. This must not stomp on it with a second reading.
    await env.DB.prepare('UPDATE users SET stripe_customer_id = ?, plan_renews_at = ? WHERE id = ?')
      .bind(CUSTOMER, '2027-01-01T00:00:00.000Z', UID)
      .run();
    listReply = () => ok({ data: [stripeSub('sub_bought', BASIC, PERIOD_END)] });

    await deliver('checkout.session.completed', session());

    expect((await readUser())?.plan_renews_at).toBe('2027-01-01T00:00:00.000Z');
  });

  it('does not blank an existing date when Stripe returns no period end', async () => {
    await env.DB.prepare('UPDATE users SET stripe_customer_id = ?, plan_renews_at = ? WHERE id = ?')
      .bind(CUSTOMER, '2027-01-01T00:00:00.000Z', UID)
      .run();
    listReply = () => ok({ data: [stripeSub('sub_bought', BASIC, null)] });

    await deliver('checkout.session.completed', session());

    expect((await readUser())?.plan_renews_at).toBe('2027-01-01T00:00:00.000Z');
  });

  it('keeps the interval the session stamped rather than re-deriving it', async () => {
    // The session's metadata is what the person actually chose; the Price is a reconstruction.
    listReply = () => ok({ data: [stripeSub('sub_bought', ADVANCED_ANNUAL, PERIOD_END)] });

    await deliver('checkout.session.completed', session());

    expect((await readUser())?.subscription_interval).toBe('monthly');
  });

  it('recovers the interval from the Price when the session carries none', async () => {
    // Sessions minted before we stamped the interval. This is the path that backfills them.
    listReply = () => ok({ data: [stripeSub('sub_bought', ADVANCED_ANNUAL, PERIOD_END)] });

    await deliver('checkout.session.completed', session({ metadata: { plan: 'advanced' } }));

    expect((await readUser())?.subscription_interval).toBe('annual');
  });
});

describe('Stripe being unreachable cannot break the webhook', () => {
  it('still acks, and still records the plan', async () => {
    // An unacked webhook is retried, and the retry is swallowed by the idempotency ledger — so a
    // throw here would lose the event outright. A missing date is worth far less than that.
    listReply = () => new Response('boom', { status: 500 });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver('checkout.session.completed', session());

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({
      plan: 'basic',
      subscription_status: 'active',
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: 'sub_bought',
      plan_renews_at: null,
    });
    logged.mockRestore();
  });

  it('skips the lookup entirely when billing has no key configured', async () => {
    // A self-hosted install with billing switched off must not make outbound calls.
    delete env.STRIPE_SECRET_KEY;

    const res = await deliver('checkout.session.completed', session());

    expect(res.status).toBe(200);
    expect(lookups).toBe(0);
    expect((await readUser())?.plan).toBe('basic');
  });
});
