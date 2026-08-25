/**
 * What we send Stripe when we create a Checkout Session — specifically, the params that only
 * become mandatory once an EXISTING customer is attached.
 *
 * The session enables `automatic_tax` and `tax_id_collection`. With a brand-new customer that is
 * all Stripe needs: it collects the name and address during checkout and keeps them. With an
 * existing `customer` it refuses, because it has nowhere it is allowed to put either — unless we
 * say so with `customer_update[name]=auto` and `customer_update[address]=auto`.
 *
 * That made every RETURNING subscriber fail (re-subscribe after a cancel, or switch tier) while
 * first-time checkout worked, because only the returning path sets `customer`. These tests pin
 * both branches, and pin that Stripe's own error text never reaches the caller.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const UID = 8300;
const CUSTOMER = 'cus_TestExisting';
const PRICE = 'price_advanced_monthly_test';

/** Bodies POSTed to api.stripe.com, parsed back into params. GETs carry none and are not here. */
let posted: URLSearchParams[] = [];
/** Paths GETed from api.stripe.com, in order. */
let fetched: string[] = [];
/** What the stubbed Stripe answers a POST with next. */
let stripeReply: () => Response;
/** The customer's live subscriptions, as the list endpoint would answer. */
let liveSubs: unknown[] = [];

const seed = async (customer: string | null) =>
  env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, stripe_customer_id) VALUES (?, ?, ?, ?, 1, 1, ?)'
  )
    .bind(UID, 'returning@example.com', 'pbkdf2$100000$x$y', 'password', customer)
    .run();

const checkout = async () =>
  SELF.fetch('https://api.example.com/api/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: (await issueSessionCookie(UID, 'password', env)).split(';')[0],
    },
    body: JSON.stringify({ plan: 'advanced', interval: 'monthly' }),
  });

beforeEach(async () => {
  posted = [];
  stripeReply = () =>
    new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  fetched = [];
  liveSubs = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://api.stripe.com/'))
        return new Response('unexpected', { status: 500 });
      // Checkout asks what the customer already has before it creates anything -- the whole
      // point of billing-single-subscription.test.ts. Empty here: these cases are about the
      // params of a session that IS created.
      if ((init?.method ?? 'GET') === 'GET') {
        fetched.push(url);
        return new Response(JSON.stringify({ data: liveSubs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      posted.push(new URLSearchParams(String(init?.body ?? '')));
      return stripeReply();
    })
  );
  env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  env.STRIPE_PRICE_ADVANCED_MONTHLY = PRICE;
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // billing-verified-gate.test.ts reads "no key" as "billing not configured" (501), so put the
  // env back exactly as it was rather than leaving a key behind for whoever runs next.
  delete env.STRIPE_SECRET_KEY;
  delete env.STRIPE_PRICE_ADVANCED_MONTHLY;
});

describe('checkout session params', () => {
  it('lets Stripe write back the name and address when an existing customer is attached', async () => {
    await seed(CUSTOMER);

    const res = await checkout();

    expect(res.status).toBe(200);
    expect(posted).toHaveLength(1);
    // It looked before it leapt, and only then created the session.
    expect(fetched.some((u) => u.includes('subscriptions?customer='))).toBe(true);
    const p = posted[0];
    expect(p.get('customer')).toBe(CUSTOMER);
    expect(p.get('customer_update[name]')).toBe('auto');
    expect(p.get('customer_update[address]')).toBe('auto');
    // The two params that make the customer_update mandatory in the first place.
    // Settings polls for THIS tier after the redirect. A checkout return is a fresh page load
    // with no memory of the previous plan, so without the hint a tier switch confirms the tier
    // being left. frontend/src/core/billingActivation.ts is the other half.
    expect(p.get('success_url')).toContain('billing=success&plan=advanced');
    expect(p.get('automatic_tax[enabled]')).toBe('true');
    expect(p.get('tax_id_collection[enabled]')).toBe('true');
    // customer and customer_email are mutually exclusive to Stripe.
    expect(p.get('customer_email')).toBeNull();
  });

  it('sends no customer_update for a first-time checkout', async () => {
    await seed(null);

    const res = await checkout();

    expect(res.status).toBe(200);
    // No customer id means nothing could exist to duplicate -- so no lookup at all.
    expect(fetched).toEqual([]);
    const p = posted[0];
    expect(p.get('customer_email')).toBe('returning@example.com');
    expect(p.get('customer')).toBeNull();
    expect(p.get('customer_update[name]')).toBeNull();
    expect(p.get('customer_update[address]')).toBeNull();
  });

  it('keeps Stripe’s wording out of the response and puts it in the log instead', async () => {
    await seed(CUSTOMER);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    stripeReply = () =>
      new Response(
        JSON.stringify({
          error: {
            type: 'invalid_request_error',
            param: 'customer_update',
            message: 'When `tax_id_collection` is enabled… you must set `customer_update[name]`',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'request-id': 'req_abc123' } }
      );

    const res = await checkout();
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    // A Stripe 4xx is our misconfiguration and is permanent, so the message must not invite a
    // retry. Stripe's own 5xx gets the "try again shortly" wording instead.
    expect(body.error).toBe(
      'Could not start checkout — something is wrong on our side, and it has been logged.'
    );
    expect(body.error).not.toContain('customer_update');
    const line = logged.mock.calls.flat().join(' ');
    expect(line).toContain('customer_update');
    expect(line).toContain('req_abc123');
    logged.mockRestore();
  });
});
