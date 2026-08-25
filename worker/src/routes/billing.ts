import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { HttpError } from '../http';
import * as db from '../db';
import { sendMail } from '../email';
import type { BillingAccount } from '../billingMail';
import { mailForBillingEvent } from '../billingMail';

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
    const err = (data.error ?? {}) as {
      message?: string;
      type?: string;
      code?: string;
      param?: string;
    };
    // Stripe's own words go to the logs, never to the page. A rejected Session create is almost
    // always OUR misconfiguration (a missing param, a feature not enabled on the account), and
    // relaying it — "tax ID collection requires a customer name" — puts a sentence in front of the
    // one person who cannot act on it. Observability is enabled in wrangler.jsonc, so this line is
    // queryable, and Stripe's request id makes it findable in their dashboard too.
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'stripe',
        path,
        status: res.status,
        type: err.type,
        code: err.code,
        param: err.param,
        message: err.message,
        requestId: res.headers.get('request-id'),
      })
    );
    // A card_error is written for the cardholder and is the one kind worth showing them.
    if (err.type === 'card_error' && err.message) throw new HttpError(402, err.message);
    // 502 either way — an upstream call we could not complete is a server error, and only 5xx
    // reaches logWorkerError/error_logs. The WORDING has to differ, though: a Stripe 4xx means we
    // sent something wrong and will keep sending it, so "try again shortly" is a retry loop against
    // a permanent failure. Stripe's own 5xx and network faults are the case where waiting works.
    throw new HttpError(
      502,
      res.status >= 500
        ? 'Billing is temporarily unavailable. Please try again shortly.'
        : 'Could not start checkout — something is wrong on our side, and it has been logged.'
    );
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
// Monthly or annual, from the Price the subscription is actually on. The interval also travels in
// the subscription metadata, but reading it back off the Price is what lets subscriptions created
// before we started sending it fill in `users.subscription_interval` on their next event.
function intervalForPrice(env: AppEnv['Bindings'], id: string): Interval | null {
  for (const p of PAID) {
    if (priceId(env, p, 'monthly') === id) return 'monthly';
    if (priceId(env, p, 'annual') === id) return 'annual';
  }
  return null;
}
function availablePlans(env: AppEnv['Bindings']): PaidPlan[] {
  return PAID.filter((p) => priceId(env, p, 'monthly') || priceId(env, p, 'annual'));
}

// POST /api/billing/checkout — start a subscription checkout for { plan, interval }; returns { url }.
billingRoutes.post('/api/billing/checkout', requireAuth, async (c) => {
  const userId = c.get('userId');
  const u = await db.first<{
    email: string | null;
    stripe_customer_id: string | null;
    auth_provider: string | null;
    email_verified: number | null;
  }>(
    c.env.DB,
    'SELECT email, stripe_customer_id, auth_provider, email_verified FROM users WHERE id = ?',
    userId
  );
  // First, and before anything about Stripe: this is a fact about the account, true or false
  // whether or not billing is configured. Checked here and not only in the UI because this is
  // the route that creates the charge, and it is reachable with a session and a fetch whatever
  // the page decided to draw.
  if (mustVerifyEmail(u)) {
    throw new HttpError(403, 'Confirm your email address before subscribing');
  }
  if (!c.env.STRIPE_SECRET_KEY) throw new HttpError(501, 'Billing is not configured');
  const b = (await c.req.json().catch(() => ({}))) as { plan?: string; interval?: string };
  const plan = paidPlan(b.plan) ?? 'advanced'; // default to Advanced (the legacy single price)
  const interval: Interval = b.interval === 'annual' ? 'annual' : 'monthly';
  const price = priceId(c.env, plan, interval);
  if (!price) throw new HttpError(501, `The ${plan} (${interval}) plan isn't available yet`);

  const origin = c.env.CORS_ORIGIN ?? new URL(c.req.url).origin;
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    client_reference_id: String(userId),
    'metadata[plan]': plan,
    'metadata[interval]': interval,
    'subscription_data[metadata][plan]': plan, // so subscription.updated/deleted know the tier
    'subscription_data[metadata][interval]': interval, // …and monthly vs annual, for MRR
    success_url: `${origin}/?billing=success#settings`,
    cancel_url: `${origin}/?billing=cancel#settings`,
    // EU VAT / tax compliance — requires Stripe Tax to be enabled in the Stripe
    // dashboard. If Stripe Tax is not configured the Stripe API will reject the
    // session with a clear error rather than silently booking tax-exclusive.
    // `automatic_tax` is a nested object param — must be sent as
    // automatic_tax[enabled]=true, NOT a flat automatic_tax=enabled (which
    // Stripe ignores/rejects, leaving checkout VAT-exclusive).
    'automatic_tax[enabled]': 'true',
    billing_address_collection: 'required',
    'tax_id_collection[enabled]': 'true',
  };
  if (u?.stripe_customer_id) {
    params.customer = u.stripe_customer_id;
    // Both are REQUIRED once an existing Customer is attached, and both are about the two params
    // above: tax ID collection needs somewhere to write the legal business name it collects, and
    // automatic tax needs permission to overwrite the saved address with the one typed at
    // checkout. Without them Stripe refuses the Session outright — so this branch (every returning
    // subscriber: re-subscribing after a cancel, or switching tier) 502'd while a first-time
    // checkout, which takes the customer_email branch below, worked fine.
    params['customer_update[name]'] = 'auto';
    params['customer_update[address]'] = 'auto';
  } else if (u?.email) {
    params.customer_email = u.email;
  }
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

/**
 * A password account has to confirm its address before it can start paying.
 *
 * Everything else about verification is a soft nudge — the account works, the banner asks. This
 * one place is hard, because the address is where the receipts, the renewal notices and the
 * recovery link all go: a typo at signup sends a stranger the paper trail for someone else's
 * subscription, and the person who typed it has no way back into the account that is billing them.
 *
 * Google accounts arrive with Google's own `email_verified` claim, so they are never gated.
 * Managing an EXISTING subscription is never gated either — see the portal route.
 */
function mustVerifyEmail(
  u: {
    auth_provider?: string | null;
    email_verified?: number | null;
  } | null
): boolean {
  return u?.auth_provider === 'password' && !u.email_verified;
}

// GET /api/billing/status — current plan + subscription state (the app refreshes this on return).
billingRoutes.get('/api/billing/status', requireAuth, async (c) => {
  const userId = c.get('userId');
  const u = await db.first<{
    plan: string;
    subscription_status: string | null;
    plan_renews_at: string | null;
    cancel_at_period_end: number | null;
    auth_provider: string | null;
    email_verified: number | null;
  }>(
    c.env.DB,
    'SELECT plan, subscription_status, plan_renews_at, cancel_at_period_end, auth_provider, email_verified FROM users WHERE id = ?',
    userId
  );
  return c.json({
    plan: u?.plan ?? 'free',
    status: u?.subscription_status ?? null,
    renews_at: u?.plan_renews_at ?? null,
    // True when the user canceled but still has access until renews_at (the period end).
    cancel_at_period_end: !!u?.cancel_at_period_end,
    configured: !!c.env.STRIPE_SECRET_KEY,
    availablePlans: availablePlans(c.env), // which paid tiers have a Price configured
    // The upgrade panel reads this instead of discovering the rule by being refused: a button
    // that redirects to Stripe and fails there is a worse way to learn than not offering it.
    email_verification_required: mustVerifyEmail(u),
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
    renews: number | null,
    // Null here means CLEAR — the subscription is no longer entitled. That is why this one does
    // not COALESCE the way the checkout.session.completed branch above does.
    cancelAtPeriodEnd: number,
    interval: Interval | null
  ) =>
    db.run(
      c.env.DB,
      `UPDATE users SET plan = ?, subscription_status = ?, plan_renews_at = ?, cancel_at_period_end = ?, subscription_interval = ?, stripe_event_at = ?
         WHERE stripe_customer_id = ? AND ? >= stripe_event_at`,
      plan,
      status,
      renews ? new Date(renews * 1000).toISOString() : null,
      cancelAtPeriodEnd,
      interval,
      eventCreated,
      customerId,
      eventCreated
    );

  const appOrigin =
    c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;

  /** Everything the billing mails need about the account behind a Stripe customer id. */
  const accountFor = (customerId: unknown) =>
    db.first<BillingAccount>(
      c.env.DB,
      'SELECT email, plan FROM users WHERE stripe_customer_id = ?',
      String(customerId)
    );

  /**
   * Send, and never let it break the webhook. An unacked webhook is retried, and a retry that
   * re-sends mail is worse than a mail that never arrived — the `stripe_events` insert above
   * already makes the whole handler idempotent, so one delivery is one send.
   */
  const notify = async (account: BillingAccount | null): Promise<void> => {
    const outgoing = mailForBillingEvent(event.type ?? '', obj, account, appOrigin);
    if (!outgoing) return;
    try {
      const { to, mail } = outgoing;
      await sendMail(c.env, to, mail.subject, mail.html, { text: mail.text });
    } catch (e) {
      console.error(`Billing mail (${event.type}) failed to send:`, e);
    }
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      // Links the Stripe customer to our user and activates the chosen tier. Keyed by our user id
      // (client_reference_id) so it runs regardless of ordering — it establishes the customer link
      // every later subscription event needs. Only advances the watermark (never rolls it back).
      const userId = obj.client_reference_id;
      const sessionMeta = obj.metadata as { plan?: string; interval?: string } | undefined;
      const plan = paidPlan(sessionMeta?.plan) ?? 'premium';
      const interval =
        sessionMeta?.interval === 'monthly' || sessionMeta?.interval === 'annual'
          ? sessionMeta.interval
          : null;
      if (userId) {
        await db.run(
          c.env.DB,
          // COALESCE, unlike applySubscription below: a session with no interval metadata (created
          // before we sent it) means "unknown", and this branch has no ordering guard, so a plain
          // write would clobber what customer.subscription.created had already resolved.
          'UPDATE users SET stripe_customer_id = ?, plan = ?, subscription_status = ?, cancel_at_period_end = 0, subscription_interval = COALESCE(?, subscription_interval), stripe_event_at = MAX(stripe_event_at, ?) WHERE id = ?',
          String(obj.customer),
          plan,
          'active',
          interval,
          eventCreated,
          Number(userId)
        );
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const status = String(obj.status);
      const meta = obj.metadata as { plan?: string; interval?: string } | undefined;
      const metaPlan = paidPlan(meta?.plan);
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
      // cancel_at_period_end = the user canceled but keeps access until the period end.
      const cancelAtPeriodEnd = obj.cancel_at_period_end ? 1 : 0;
      // Prefer what we stamped on the subscription; fall back to the Price, which backfills
      // subscriptions created before the metadata existed. Cleared along with the plan when the
      // subscription stops being entitled, so a free row never carries a stale interval.
      const entitled = isEntitled(status);
      const interval =
        (meta?.interval === 'monthly' || meta?.interval === 'annual' ? meta.interval : null) ??
        (item?.price?.id ? intervalForPrice(c.env, item.price.id) : null);
      await applySubscription(
        String(obj.customer),
        entitled ? (metaPlan ?? subPlan ?? 'premium') : 'free',
        status,
        renews,
        cancelAtPeriodEnd,
        entitled ? interval : null
      );
      break;
    }
    case 'customer.subscription.deleted': {
      // Read before the update: after it the plan is 'free', and a mail that says "your Free plan
      // has ended" is nonsense.
      const acct = await accountFor(obj.customer);
      // Interval clears with the plan: a free row must not keep saying it is billed annually.
      const applied = await applySubscription(
        String(obj.customer),
        'free',
        'canceled',
        null,
        0,
        null
      );
      // A stale event neither changes the plan nor announces that it did.
      if (applied.meta.changes) await notify(acct);
      break;
    }
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required':
      // Which of the two mails, and whether either is warranted, is billingMail.ts's decision.
      await notify(await accountFor(obj.customer));
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
