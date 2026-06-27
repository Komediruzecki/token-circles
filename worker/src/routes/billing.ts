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

// POST /api/billing/checkout — start a subscription checkout; returns { url } to redirect to.
billingRoutes.post('/api/billing/checkout', requireAuth, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_PRICE_ID) {
    throw new HttpError(501, 'Billing is not configured');
  }
  const userId = c.get('userId');
  const u = await db.first<{ email: string | null; stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT email, stripe_customer_id FROM users WHERE id = ?',
    userId
  );
  const origin = c.env.CORS_ORIGIN ?? new URL(c.req.url).origin;
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': c.env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    client_reference_id: String(userId),
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancel`,
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
    return_url: `${origin}/`,
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
    configured: !!(c.env.STRIPE_SECRET_KEY && c.env.STRIPE_PRICE_ID),
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

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: 'bad json' }, 400);
  }
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;

  const setPlanByCustomer = (
    customerId: string,
    plan: string,
    status: string,
    renews?: number | null
  ) =>
    db.run(
      c.env.DB,
      'UPDATE users SET plan = ?, subscription_status = ?, plan_renews_at = ? WHERE stripe_customer_id = ?',
      plan,
      status,
      renews ? new Date(renews * 1000).toISOString() : null,
      customerId
    );

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = obj.client_reference_id;
      if (userId) {
        await db.run(
          c.env.DB,
          "UPDATE users SET stripe_customer_id = ?, plan = 'premium', subscription_status = 'active' WHERE id = ?",
          String(obj.customer),
          Number(userId)
        );
      }
      break;
    }
    case 'customer.subscription.updated': {
      const status = String(obj.status);
      const active = status === 'active' || status === 'trialing';
      await setPlanByCustomer(
        String(obj.customer),
        active ? 'premium' : 'free',
        status,
        (obj.current_period_end as number | undefined) ?? null
      );
      break;
    }
    case 'customer.subscription.deleted':
      await setPlanByCustomer(String(obj.customer), 'free', 'canceled', null);
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
