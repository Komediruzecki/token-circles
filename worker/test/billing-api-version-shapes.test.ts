/**
 * Reading a Stripe payload whose shape depends on an API version we do not control.
 *
 * `STRIPE_API_VERSION` pins our OUTBOUND calls, and now matches what the prod webhook endpoint
 * sends (`2026-06-24.dahlia`). It does NOT pin that endpoint — the endpoint's version is set
 * separately in the Stripe dashboard, nothing enforces the two agreeing, and for a long time they
 * did not: the code said `2024-06-20` while prod sent dahlia. A comment in billing.ts used to
 * assert they must be kept in step, which was both unenforced and beside the point.
 *
 * Matching them is worth doing, but it is not the invariant. The invariant is that every
 * version-sensitive field is read in BOTH shapes, because the endpoint can be repointed — or a
 * second endpoint added, or a sandbox left on an older version — without this code changing.
 *
 * `current_period_end` is the field that moved: basil put it on the subscription ITEM and removed
 * the TOP LEVEL. Both still have to work, in both directions, because either version can be the
 * one delivering an event on any given day.
 *
 * The failure mode if that tolerance breaks is nasty precisely because it is quiet: a missing
 * period end does not throw, it writes NULL, the billing card silently omits the renewal date,
 * and nobody notices for a month. So there is also a tripwire — an entitled event with no period
 * end in EITHER place logs the sending API version — and it is tested here too, because an
 * untested log line is a log line that is not there.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UID = 8800;
const CUSTOMER = 'cus_ApiShapes';
const SECRET = 'whsec_test_dummy';
const BASIC = 'price_basic_monthly_test';
/** 2026-09-23T15:38:53.000Z */
const PERIOD_END = 1790177933;
const EXPECTED_ISO = '2026-09-23T15:38:53.000Z';

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
async function deliver(
  type: string,
  object: Record<string, unknown>,
  apiVersion?: string
): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_shape_${++eventSeq}`,
    type,
    created: Math.floor(Date.now() / 1000) + eventSeq,
    ...(apiVersion ? { api_version: apiVersion } : {}),
    data: { object },
  });
  return SELF.fetch('https://api.example.com/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': await signed(payload) },
    body: payload,
  });
}

const readUser = () =>
  env.DB.prepare('SELECT plan, subscription_status, plan_renews_at FROM users WHERE id = ?')
    .bind(UID)
    .first<{ plan: string; subscription_status: string | null; plan_renews_at: string | null }>();

beforeEach(async () => {
  eventSeq += 100;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 }))
  );
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  env.STRIPE_PRICE_BASIC_MONTHLY = BASIC;
  // No STRIPE_SECRET_KEY on purpose: liveSubscriptions short-circuits, so these tests are about
  // the payload READER alone and never reach out.
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM stripe_events').run();
  await env.DB.prepare(
    'INSERT INTO users (id, email, auth_provider, email_verified, token_version, stripe_customer_id) VALUES (?, ?, ?, 1, 1, ?)'
  )
    .bind(UID, 'shapes@example.com', 'google', CUSTOMER)
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.STRIPE_WEBHOOK_SECRET;
  delete env.STRIPE_PRICE_BASIC_MONTHLY;
});

describe('current_period_end, wherever the sending version puts it', () => {
  it('reads it off the subscription item — the 2026-era shape prod actually sends', async () => {
    await deliver(
      'customer.subscription.updated',
      {
        id: 'sub_new_shape',
        customer: CUSTOMER,
        status: 'active',
        metadata: { plan: 'basic', interval: 'monthly' },
        items: { data: [{ price: { id: BASIC }, current_period_end: PERIOD_END }] },
      },
      '2026-06-24.dahlia'
    );

    expect((await readUser())?.plan_renews_at).toBe(EXPECTED_ISO);
  });

  it('reads it off the top level — the legacy shape, still valid for an older endpoint', async () => {
    // A pre-basil endpoint sends this. Drop the fallback and it becomes a silent NULL.
    await deliver(
      'customer.subscription.updated',
      {
        id: 'sub_old_shape',
        customer: CUSTOMER,
        status: 'active',
        metadata: { plan: 'basic', interval: 'monthly' },
        current_period_end: PERIOD_END,
        items: { data: [{ price: { id: BASIC } }] },
      },
      '2024-06-20'
    );

    expect((await readUser())?.plan_renews_at).toBe(EXPECTED_ISO);
  });

  it('prefers the item when a payload somehow carries both', async () => {
    // Transitional shapes exist. The item is the newer, more specific location, so it wins.
    await deliver('customer.subscription.updated', {
      id: 'sub_both',
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'basic', interval: 'monthly' },
      current_period_end: 1600000000,
      items: { data: [{ price: { id: BASIC }, current_period_end: PERIOD_END }] },
    });

    expect((await readUser())?.plan_renews_at).toBe(EXPECTED_ISO);
  });

  it('works with no items array at all, rather than throwing on the way in', async () => {
    await deliver('customer.subscription.updated', {
      id: 'sub_no_items',
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'basic', interval: 'monthly' },
      current_period_end: PERIOD_END,
    });

    expect((await readUser())?.plan_renews_at).toBe(EXPECTED_ISO);
  });
});

describe('the drift tripwire', () => {
  it('names the sending API version when the period end is in neither place', async () => {
    // The whole point: this is the shape that would otherwise write NULL in silence. If Stripe
    // moves the field again, this line is what turns a month of missing renewal dates into
    // something queryable on the day it starts.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deliver(
      'customer.subscription.updated',
      {
        id: 'sub_no_period',
        customer: CUSTOMER,
        status: 'active',
        metadata: { plan: 'basic', interval: 'monthly' },
        items: { data: [{ price: { id: BASIC } }] },
      },
      '2027-99-99.someday'
    );

    const line = logged.mock.calls.flat().join(' ');
    expect(line).toContain('no current_period_end');
    expect(line).toContain('2027-99-99.someday');
    expect(line).toContain('sub_no_period');
    logged.mockRestore();
  });

  it('still applies the plan — a missing date is not a reason to refuse money', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deliver('customer.subscription.updated', {
      id: 'sub_no_period',
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'basic', interval: 'monthly' },
      items: { data: [{ price: { id: BASIC } }] },
    });

    expect(await readUser()).toMatchObject({
      plan: 'basic',
      subscription_status: 'active',
      plan_renews_at: null,
    });
    logged.mockRestore();
  });

  it('stays quiet when the date is present', async () => {
    // A warning that fires on the happy path is a warning everyone learns to ignore.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deliver('customer.subscription.updated', {
      id: 'sub_fine',
      customer: CUSTOMER,
      status: 'active',
      metadata: { plan: 'basic', interval: 'monthly' },
      items: { data: [{ price: { id: BASIC }, current_period_end: PERIOD_END }] },
    });

    expect(logged.mock.calls.flat().join(' ')).not.toContain('no current_period_end');
    logged.mockRestore();
  });

  it('stays quiet for a subscription that is not entitled, which has no period to report', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deliver('customer.subscription.updated', {
      id: 'sub_dead',
      customer: CUSTOMER,
      status: 'incomplete_expired',
      items: { data: [{ price: { id: BASIC } }] },
    });

    expect(logged.mock.calls.flat().join(' ')).not.toContain('no current_period_end');
    logged.mockRestore();
  });
});
