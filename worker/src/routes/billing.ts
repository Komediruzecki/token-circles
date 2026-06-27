import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { HttpError } from '../http';
import * as db from '../db';

// Stripe billing — implemented with raw fetch to the Stripe REST API (no SDK, so the Worker
// bundle stays lean and there's no SDK/Workers version drift). Webhook signatures are verified
// with WebCrypto (the same HMAC-SHA256 the auth module uses). The plan is ALWAYS set from
// webhooks, never trusted from the client; src/plan.ts stays the single enforcement point.
//
// Until STRIPE_SECRET_KEY + STRIPE_PRICE_ID are set, checkout/portal return 501 (safe no-op).
export const billingRoutes = new Hono<AppEnv>();

const encoder = new TextEncoder();

// Pin the Stripe API version for our outbound calls so response shapes are deterministic. Set the
// webhook endpoint to the SAME version in the Stripe dashboard so event payloads match (the webhook
// reads current_period_end off the subscription item, which is where recent versions put it).
const STRIPE_API_VERSION = '2024-06-20';

// Form-encoded POST to the Stripe REST API.
async function stripePost(
  env: AppEnv['Bindings'],
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION,
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data.error as { message?: string } | undefined)?.message ?? 'Stripe request failed';
    throw new HttpError(502, msg);
  }
  return data;
}

// ── Per-tier price mapping ───────────────────────────────────────────────────
type Interval = 'monthly' | 'annual';
type PaidPlan = 'basic' | 'advanced' | 'ultimate';
const PAID: PaidPlan[] = ['basic', 'advanced', 'ultimate'];

function paidPlan(v: unknown): PaidPlan | null {
  return v === 'basic' || v === 'advanced' || v === 'ultimate' ? v : null;
}
// The Stripe Price id for a tier×interval. The legacy single STRIPE_PRICE_ID is treated as
// Advanced monthly so existing setups keep working ('premium' still maps to 'advanced' in plans.ts).
function priceId(env: AppEnv['Bindings'], plan: string, interval: Interval): string | undefined {
  const m: Record<string, { monthly?: string; annual?: string }> = {
    basic: { monthly: env.STRIPE_PRICE_BASIC_MONTHLY, annual: env.STRIPE_PRICE_BASIC_ANNUAL },
    advanced: {
      monthly: env.STRIPE_PRICE_ADVANCED_MONTHLY ?? env.STRIPE_PRICE_ID,
      annual: env.STRIPE_PRICE_ADVANCED_ANNUAL,
    },
    ultimate: {
      monthly: env.STRIPE_PRICE_ULTIMATE_MONTHLY,
      annual: env.STRIPE_PRICE_ULTIMATE_ANNUAL,
    },
  };
  return m[plan]?.[interval];
}
function planForPrice(env: AppEnv['Bindings'], id: string): PaidPlan | null {
  for (const p of PAID)
    if (priceId(env, p, 'monthly') === id || priceId(env, p, 'annual') === id) return p;
  return null;
}
function availablePlans(env: AppEnv['Bindings']): PaidPlan[] {
  return PAID.filter((p) => priceId(env, p, 'monthly') || priceId(env, p, 'annual'));
}

// POST /api/billing/checkout — start a subscription checkout for { plan, interval }; returns { url }.
billingRoutes.post('/api/billing/checkout', requireAuth, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) throw new HttpError(501, 'Billing is not configured');
  const b = (await c.req.json().catch(() => ({}))) as { plan?: string; interval?: string };
  const plan = paidPlan(b.plan) ?? 'advanced'; // default to Advanced (the legacy single price)
  const interval: Interval = b.interval === 'annual' ? 'annual' : 'monthly';
  const price = priceId(c.env, plan, interval);
  if (!price) throw new HttpError(501, `The ${plan} (${interval}) plan isn't available yet`);

  const userId = c.get('userId');
  const u = await db.first<{ email: string | null; stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT email, stripe_customer_id FROM users WHERE id = ?',
    userId
  );
  const origin = c.env.CORS_ORIGIN ?? new URL(c.req.url).origin;
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    client_reference_id: String(userId),
    'metadata[plan]': plan,
    'subscription_data[metadata][plan]': plan, // so subscription.updated/deleted know the tier
    success_url: `${origin}/?billing=success#settings`,
    cancel_url: `${origin}/?billing=cancel#settings`,
  };
  if (u?.stripe_customer_id) params.customer = u.stripe_customer_id;
  else if (u?.email) params.customer_email = u.email;
  const session = await stripePost(c.env, 'checkout/sessions', params);
  return c.json({ url: session.url });
});

// POST /api/billing/portal — Stripe-hosted manage/cancel portal; returns { url }.
billingRoutes.post('/api/billing/portal', requireAuth, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) throw new HttpError(501, 'Billing is not configured');
  const userId = c.get('userId');
  const u = await db.first<{ stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT stripe_customer_id FROM users WHERE id = ?',
    userId
  );
  if (!u?.stripe_customer_id) throw new HttpError(400, 'No billing account yet');
  const origin = c.env.CORS_ORIGIN ?? new URL(c.req.url).origin;
  const portal = await stripePost(c.env, 'billing_portal/sessions', {
    customer: u.stripe_customer_id,
    return_url: `${origin}/#settings`,
  });
  return c.json({ url: portal.url });
});

// GET /api/billing/status — current plan + subscription state (the app refreshes this on return).
billingRoutes.get('/api/billing/status', requireAuth, async (c) => {
  const userId = c.get('userId');
  const u = await db.first<{
    plan: string;
    subscription_status: string | null;
    plan_renews_at: string | null;
  }>(c.env.DB, 'SELECT plan, subscription_status, plan_renews_at FROM users WHERE id = ?', userId);
  return c.json({
    plan: u?.plan ?? 'free',
    status: u?.subscription_status ?? null,
    renews_at: u?.plan_renews_at ?? null,
    configured: !!c.env.STRIPE_SECRET_KEY,
    availablePlans: availablePlans(c.env), // which paid tiers have a Price configured
  });
});

// POST /api/billing/webhook — PUBLIC, signature-verified. Reads the RAW body (required for the
// signature) and updates the user's plan. Never trust the client for plan state.
billingRoutes.post('/api/billing/webhook', async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  const sig = c.req.header('stripe-signature');
  if (!secret || !sig) return c.json({ error: 'bad webhook' }, 400);
  const body = await c.req.text();
  if (!(await verifyStripeSignature(body, sig, secret))) {
    return c.json({ error: 'signature verification failed' }, 400);
  }

  let event: {
    id?: string;
    type?: string;
    created?: number;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: 'bad json' }, 400);
  }
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const eventId = typeof event.id === 'string' ? event.id : null;
  const eventCreated = typeof event.created === 'number' ? event.created : 0;

  // Idempotency: record the event id once. If it's already there, Stripe re-delivered an event we
  // already applied — ack with 200 and do nothing, so a retry can't double-apply.
  if (eventId) {
    const ins = await db.run(
      c.env.DB,
      'INSERT INTO stripe_events (id, type, created) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
      eventId,
      event.type ?? '',
      eventCreated
    );
    if (!ins.meta.changes) return c.json({ received: true, duplicate: true });
  }

  // Entitlement: keep the paid plan while active/trialing, and through `past_due` (Stripe is still
  // retrying payment — a dunning grace window). Anything else (canceled, unpaid, incomplete_expired)
  // drops to free. The displayed subscription_status still reflects the real Stripe status.
  const isEntitled = (status: string) =>
    status === 'active' || status === 'trialing' || status === 'past_due';

  // Apply subscription state by customer, but ONLY if this event isn't older than the last one we
  // applied for that customer (ordering guard: `created >= stripe_event_at`), which also advances
  // the watermark — so a late/stale subscription.updated can't resurrect a canceled plan.
  const applySubscription = (
    customerId: string,
    plan: string,
    status: string,
    renews: number | null
  ) =>
    db.run(
      c.env.DB,
      `UPDATE users SET plan = ?, subscription_status = ?, plan_renews_at = ?, stripe_event_at = ?
         WHERE stripe_customer_id = ? AND ? >= stripe_event_at`,
      plan,
      status,
      renews ? new Date(renews * 1000).toISOString() : null,
      eventCreated,
      customerId,
      eventCreated
    );

  switch (event.type) {
    case 'checkout.session.completed': {
      // Links the Stripe customer to our user and activates the chosen tier. Keyed by our user id
      // (client_reference_id) so it runs regardless of ordering — it establishes the customer link
      // every later subscription event needs. Only advances the watermark (never rolls it back).
      const userId = obj.client_reference_id;
      const plan = paidPlan((obj.metadata as { plan?: string } | undefined)?.plan) ?? 'premium';
      if (userId) {
        await db.run(
          c.env.DB,
          'UPDATE users SET stripe_customer_id = ?, plan = ?, subscription_status = ?, stripe_event_at = MAX(stripe_event_at, ?) WHERE id = ?',
          String(obj.customer),
          plan,
          'active',
          eventCreated,
          Number(userId)
        );
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const status = String(obj.status);
      const metaPlan = paidPlan((obj.metadata as { plan?: string } | undefined)?.plan);
      const item = (
        obj.items as
          | { data?: Array<{ price?: { id?: string }; current_period_end?: number }> }
          | undefined
      )?.data?.[0];
      const subPlan = item?.price?.id ? planForPrice(c.env, item.price.id) : null;
      // current_period_end moved onto the subscription item in recent API versions; fall back to the
      // legacy top-level field for older webhook versions.
      const renews =
        item?.current_period_end ?? (obj.current_period_end as number | undefined) ?? null;
      await applySubscription(
        String(obj.customer),
        isEntitled(status) ? (metaPlan ?? subPlan ?? 'premium') : 'free',
        status,
        renews
      );
      break;
    }
    case 'customer.subscription.deleted':
      await applySubscription(String(obj.customer), 'free', 'canceled', null);
      break;
  }
  return c.json({ received: true });
});

// Verify Stripe-Signature: HMAC-SHA256(secret, `${t}.${payload}`) hex must equal the v1 sig,
// and the timestamp must be recent (replay guard).
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const seg of header.split(',')) {
    const idx = seg.indexOf('=');
    if (idx > 0) parts[seg.slice(0, idx)] = seg.slice(idx + 1);
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
