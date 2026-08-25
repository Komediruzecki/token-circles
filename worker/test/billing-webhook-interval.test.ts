/**
 * The webhook is the only writer of plan state, and now of the billing interval too.
 *
 * `users.subscription_interval` is what makes recurring revenue computable — plan alone cannot
 * tell €6/month from €60/year. Two things have to hold for that number to be trustworthy: the
 * interval is stored when a subscription starts, and it is RESOLVED FROM THE PRICE when the
 * metadata is absent, so subscriptions that predate the metadata correct themselves on their next
 * event instead of staying blank forever.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const UID = 8400;
const CUSTOMER = 'cus_WebhookInterval';
const SECRET = 'whsec_test_dummy';
const PRICE_ANNUAL = 'price_advanced_annual_test';

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
    id: `evt_interval_${++eventSeq}`,
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

const readUser = () =>
  env.DB.prepare('SELECT plan, subscription_status, subscription_interval FROM users WHERE id = ?')
    .bind(UID)
    .first<{
      plan: string;
      subscription_status: string | null;
      subscription_interval: string | null;
    }>();

beforeEach(async () => {
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  env.STRIPE_PRICE_ADVANCED_ANNUAL = PRICE_ANNUAL;
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM stripe_events').run();
  await env.DB.prepare(
    'INSERT INTO users (id, email, auth_provider, email_verified, token_version, stripe_customer_id) VALUES (?, ?, ?, 1, 1, ?)'
  )
    .bind(UID, 'subscriber@example.com', 'google', CUSTOMER)
    .run();
});

afterEach(() => {
  delete env.STRIPE_WEBHOOK_SECRET;
  delete env.STRIPE_PRICE_ADVANCED_ANNUAL;
});

describe('subscription interval', () => {
  it('is stored from the checkout session that started the subscription', async () => {
    const res = await deliver('checkout.session.completed', {
      client_reference_id: String(UID),
      customer: CUSTOMER,
      metadata: { plan: 'advanced', interval: 'annual' },
    });

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_status: 'active',
      subscription_interval: 'annual',
    });
  });

  it('is recovered from the Price when the subscription carries no interval metadata', async () => {
    const res = await deliver('customer.subscription.updated', {
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'advanced' }, // a subscription created before we sent the interval
      items: { data: [{ price: { id: PRICE_ANNUAL }, current_period_end: 1800000000 }] },
    });

    expect(res.status).toBe(200);
    expect((await readUser())?.subscription_interval).toBe('annual');
  });

  it('survives a checkout session that carries no interval of its own', async () => {
    // The two events race, and checkout.session.completed has no ordering guard. A session
    // created before we started stamping the interval must not wipe what subscription.updated
    // had already recovered from the Price — null there means "not stamped", not "clear it".
    await deliver('customer.subscription.updated', {
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'advanced' },
      items: { data: [{ price: { id: PRICE_ANNUAL }, current_period_end: 1800000000 }] },
    });
    expect(await readUser()).toMatchObject({ subscription_interval: 'annual' });

    const res = await deliver('checkout.session.completed', {
      client_reference_id: String(UID),
      customer: CUSTOMER,
      metadata: { plan: 'advanced' }, // no interval — a session from before this shipped
    });

    expect(res.status).toBe(200);
    expect(await readUser()).toMatchObject({
      plan: 'advanced',
      subscription_interval: 'annual',
    });
  });

  it('is cleared when the subscription ends, so a free row carries no stale interval', async () => {
    await deliver('checkout.session.completed', {
      client_reference_id: String(UID),
      customer: CUSTOMER,
      metadata: { plan: 'advanced', interval: 'annual' },
    });

    await deliver('customer.subscription.deleted', { customer: CUSTOMER, status: 'canceled' });

    expect(await readUser()).toMatchObject({
      plan: 'free',
      subscription_status: 'canceled',
      subscription_interval: null,
    });
  });
});
