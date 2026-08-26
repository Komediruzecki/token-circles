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

// One call to the Stripe REST API. POSTs are form-encoded; GETs carry their query in `path`.
async function stripeCall(
  env: AppEnv['Bindings'],
  path: string,
  params: Record<string, string> | null
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': STRIPE_API_VERSION,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(params ? { body: new URLSearchParams(params).toString() } : {}),
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

const stripePost = (env: AppEnv['Bindings'], path: string, params: Record<string, string>) =>
  stripeCall(env, path, params);
const stripeGet = (env: AppEnv['Bindings'], path: string) => stripeCall(env, path, null);

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

// ── The customer's live subscriptions ────────────────────────────────────────

/**
 * Statuses that entitle. `past_due` is in the list because Stripe is still retrying the card --
 * it is a dunning grace window, not a lapse -- and `trialing` because a trial is the plan.
 * The webhook's isEntitled and frontend/src/core/billingActivation.ts read the same three.
 */
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** One live Stripe subscription, reduced to what a tier switch and the webhook need. */
interface LiveSub {
  id: string;
  /** The subscription ITEM id. Updating a price means replacing this item, not adding one. */
  itemId: string;
  priceId: string;
  status: string;
  /** Stripe's creation timestamp -- the only honest way to order duplicates. */
  created: number;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: number;
  metaPlan?: string;
  metaInterval?: string;
}

/**
 * The subscriptions this customer holds that still entitle them, newest first.
 *
 * `status=all` on purpose: the endpoint's default is `active` alone, which would hide `trialing`
 * and `past_due` -- and treating a trialing customer as having nothing is exactly how you sell
 * somebody a second subscription. The filter lives here so ENTITLED_STATUSES stays the one
 * definition.
 *
 * Throws like any other Stripe call. Callers on the checkout path WANT that: not knowing whether
 * a subscription exists is not a reason to create one. Callers in the webhook catch it, because
 * an unacked webhook is retried and the retry is swallowed by the idempotency ledger.
 */
async function liveSubscriptions(env: AppEnv['Bindings'], customerId: string): Promise<LiveSub[]> {
  if (!env.STRIPE_SECRET_KEY) return [];
  const data = await stripeGet(
    env,
    `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`
  );
  const rows = (Array.isArray(data.data) ? data.data : []) as Array<Record<string, unknown>>;
  return (
    rows
      .filter((r) => ENTITLED_STATUSES.has(String(r.status)))
      .map((r): LiveSub | null => {
        const item = (
          r.items as
            | {
                data?: Array<{ id?: string; price?: { id?: string }; current_period_end?: number }>;
              }
            | undefined
        )?.data?.[0];
        const meta = r.metadata as { plan?: string; interval?: string } | undefined;
        if (typeof r.id !== 'string' || !item?.id || !item.price?.id) return null;
        return {
          id: r.id,
          itemId: item.id,
          priceId: item.price.id,
          status: String(r.status),
          created: typeof r.created === 'number' ? r.created : 0,
          // current_period_end moved onto the item in recent API versions; the top-level field is
          // the older shape. Same fallback the webhook uses.
          currentPeriodEnd: item.current_period_end ?? (r.current_period_end as number) ?? null,
          cancelAtPeriodEnd: r.cancel_at_period_end ? 1 : 0,
          metaPlan: meta?.plan,
          metaInterval: meta?.interval,
        };
      })
      .filter((s): s is LiveSub => s !== null)
      // Newest first. Stripe already returns the list this way, but "newest" decides which
      // subscription a duplicated account gets moved onto, so it is worth stating rather than
      // inheriting from the response order.
      .sort((a, b) => b.created - a.created)
  );
}

/** The tier a live subscription represents: what we stamped on it, else what its Price says. */
function planForSub(env: AppEnv['Bindings'], s: LiveSub): PaidPlan | null {
  return paidPlan(s.metaPlan) ?? planForPrice(env, s.priceId);
}
/** Monthly or annual, resolved the same way and for the same reason. */
function intervalForSub(env: AppEnv['Bindings'], s: LiveSub): Interval | null {
  return s.metaInterval === 'monthly' || s.metaInterval === 'annual'
    ? s.metaInterval
    : intervalForPrice(env, s.priceId);
}

// POST /api/billing/checkout — put the account on { plan, interval }.
//
// Two outcomes, and the caller has to handle both: { url } when there is a Checkout Session to
// send them to (a first subscription), and { url: null, changed } when the subscription they
// already have was moved onto the new price and nothing needs to redirect.
billingRoutes.post('/api/billing/checkout', requireAuth, async (c) => {
  const userId = c.get('userId');
  const u = await db.first<{
    email: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    auth_provider: string | null;
    email_verified: number | null;
  }>(
    c.env.DB,
    'SELECT email, stripe_customer_id, stripe_subscription_id, auth_provider, email_verified FROM users WHERE id = ?',
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

  // ── Already subscribed? Then this is a CHANGE, not a purchase. ─────────────
  //
  // `mode: subscription` creates a new subscription every single time, and Stripe is happy to
  // let one customer hold several at once -- that is a real feature, for products that sell more
  // than one thing. We sell one plan, so for us it was a bug with a bill attached: every tier
  // switch stacked another subscription, the portal filled up with "active" rows, the card was
  // charged for all of them, and `users` showed whichever webhook landed last.
  //
  // Moving the existing subscription onto the new Price is the correct operation and the only
  // one that cannot duplicate. Note this asks STRIPE what exists rather than trusting our own
  // column: accounts that predate migration 0026 have no subscription id recorded, and they are
  // precisely the accounts already carrying strays.
  const live = u?.stripe_customer_id ? await liveSubscriptions(c.env, u.stripe_customer_id) : [];
  if (live.length > 1) {
    // Not fatal -- we still switch exactly one and create none -- but it means an account is
    // paying more than once, which nothing else on this path would ever say out loud.
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'billing',
        message: 'customer holds more than one live subscription',
        customer: u?.stripe_customer_id,
        subscriptions: live.map((s) => s.id),
      })
    );
  }
  // Prefer the one the account's plan is actually on; fall back to the newest.
  const current = live.find((s) => s.id === u?.stripe_subscription_id) ?? live[0];
  if (current) {
    // Choosing a paid plan is asking to be billed for it, so it also takes back a cancellation.
    //
    // Someone who cancelled, thought better of it, and picked a tier has stated their intent as
    // plainly as this UI allows. Leaving the subscription set to end would charge them for one
    // more period on the NEW tier and then cut them off anyway -- and the billing card would sit
    // there saying "your Advanced plan is canceled" directly underneath the upgrade they just
    // chose. Stripe's own portal keeps the cancellation through a price change, but the portal
    // has a separate Renew button to undo it and this grid does not.
    const resuming = current.cancelAtPeriodEnd === 1;
    // Asked for what they already have, and not ending. Nothing to send, nothing to wait for.
    if (current.priceId === price && !resuming)
      return c.json({ url: null, changed: false, plan, interval });
    await stripePost(c.env, `subscriptions/${current.id}`, {
      // Replacing the item's price, NOT adding a second item -- omit the id and Stripe appends,
      // which bills both tiers on one subscription.
      'items[0][id]': current.itemId,
      'items[0][price]': price,
      // Put the difference on the next invoice instead of charging now. An immediate invoice can
      // require SCA, and a POST from a settings page has nowhere to send someone to complete it;
      // the tier itself changes straight away either way.
      proration_behavior: 'create_prorations',
      // Only sent when there is a cancellation to lift. Sending it unconditionally would work,
      // but it would also be a write nobody asked for on every ordinary tier change.
      ...(resuming ? { cancel_at_period_end: 'false' } : {}),
      // Keep the subscription's own metadata truthful -- customer.subscription.updated reads the
      // tier back off it, and a stale value here would re-apply the tier they just left.
      'metadata[plan]': plan,
      'metadata[interval]': interval,
    });
    // No url: nothing to redirect to. The plan is still written by the webhook, never from here.
    return c.json({ url: null, changed: true, plan, interval, resumed: resuming });
  }

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
    // The tier travels back with the redirect so Settings knows what to wait for. A fresh page
    // load has no memory of what the plan was before checkout, so without this it can only
    // compare against whatever it reads first — which on a tier switch is the OLD paid tier,
    // and it would announce that one as activated.
    // `interval` rides along with `plan` so the return can tell an annual checkout landed and not
    // merely that the tier is entitled. Links made before this shipped carry no interval, which
    // billingActivated treats as "no hint" rather than a mismatch.
    success_url: `${origin}/?billing=success&plan=${encodeURIComponent(plan)}&interval=${encodeURIComponent(interval)}#settings`,
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
    subscription_interval: string | null;
    auth_provider: string | null;
    email_verified: number | null;
  }>(
    c.env.DB,
    'SELECT plan, subscription_status, plan_renews_at, cancel_at_period_end, subscription_interval, auth_provider, email_verified FROM users WHERE id = ?',
    userId
  );
  return c.json({
    plan: u?.plan ?? 'free',
    status: u?.subscription_status ?? null,
    renews_at: u?.plan_renews_at ?? null,
    // Monthly vs annual. The column has been maintained since 0025 and nothing read it back, so
    // the app could not say which one you were on -- and could not tell a monthly -> annual
    // switch from a no-op, because the tier either side of it is the same. Null for a plan that
    // predates the column, and for comped plans, which have no Price behind them.
    interval: u?.subscription_interval ?? null,
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
  const isEntitled = (status: string) => ENTITLED_STATUSES.has(status);

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
    interval: Interval | null,
    // Which subscription the row now reflects. Recorded so a later `deleted` can tell "the
    // subscription this account is on ended" from "one of the strays ended" -- see
    // isStraySubscription. Null alongside a free plan: nothing is tracked once nothing is live.
    subscriptionId: string | null
  ) =>
    db.run(
      c.env.DB,
      `UPDATE users SET plan = ?, subscription_status = ?, plan_renews_at = ?, cancel_at_period_end = ?, subscription_interval = ?, stripe_subscription_id = ?, stripe_event_at = ?
         WHERE stripe_customer_id = ? AND ? >= stripe_event_at`,
      plan,
      status,
      renews ? new Date(renews * 1000).toISOString() : null,
      cancelAtPeriodEnd,
      interval,
      subscriptionId,
      eventCreated,
      customerId,
      eventCreated
    );

  /**
   * Is this event about a subscription the account is NOT on?
   *
   * Asked only before events that would REMOVE entitlement. A customer can hold more than one
   * subscription -- our own checkout used to create them on every tier switch, and one added
   * from the Stripe dashboard looks identical -- and a stray ending says nothing about the plan
   * the account is actually on. Deciding that from the customer id alone is what used to set
   * people to free while a second subscription carried on charging their card.
   *
   * A row with no tracked id (anything predating migration 0026) has no opinion, so it is NOT a
   * stray: those accounts keep behaving exactly as they did, and fill the column in on their
   * next subscription event.
   */
  const isStraySubscription = async (customerId: unknown, subId: unknown): Promise<boolean> => {
    if (typeof subId !== 'string' || !subId) return false;
    const row = await db.first<{ stripe_subscription_id: string | null }>(
      c.env.DB,
      'SELECT stripe_subscription_id FROM users WHERE stripe_customer_id = ?',
      String(customerId)
    );
    const tracked = row?.stripe_subscription_id ?? null;
    return !!tracked && tracked !== subId;
  };

  /**
   * A subscription stopped entitling. Move the account onto whatever else is still live, or off
   * the plan entirely.
   *
   * The lookup is the point. An account can be holding more than one subscription -- checkout
   * used to create them on every tier switch, and the Stripe dashboard still can -- and dropping
   * to free while another one keeps charging the card is the most expensive wrong answer
   * available here. Both routes into this (a `deleted`, and an `updated` that lands on a status
   * that no longer entitles) get the same answer, because the account's position is the same
   * either way.
   *
   * A failed lookup drops the plan. That is what this did before the lookup existed, it fails in
   * the safe direction -- inferring "still entitled" from an error would hand out the product --
   * and it must not throw: an unacked webhook is retried, and the retry is swallowed by the
   * idempotency ledger above, so the event would be lost outright.
   */
  const endSubscription = async (customerId: unknown, deadSubId: unknown, status: string) => {
    const remaining = (await liveSubscriptions(c.env, String(customerId)).catch(() => [])).filter(
      (sub) => sub.id !== deadSubId
    );
    const keep = remaining[0];
    // Interval and subscription id clear with the plan: a free row must not keep saying it is
    // billed annually, nor point at a subscription that no longer exists.
    const applied = keep
      ? await applySubscription(
          String(customerId),
          planForSub(c.env, keep) ?? 'premium',
          keep.status,
          keep.currentPeriodEnd,
          keep.cancelAtPeriodEnd,
          intervalForSub(c.env, keep),
          keep.id
        )
      : await applySubscription(String(customerId), 'free', status, null, 0, null, null);
    return { applied, keep: keep ?? null };
  };

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
          // COALESCE on the subscription id for the same reason as the interval: a session for
          // something other than a subscription carries none, and blanking it would untrack a
          // subscription that is very much still running.
          'UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = COALESCE(?, stripe_subscription_id), plan = ?, subscription_status = ?, cancel_at_period_end = 0, subscription_interval = COALESCE(?, subscription_interval), stripe_event_at = MAX(stripe_event_at, ?) WHERE id = ?',
          String(obj.customer),
          typeof obj.subscription === 'string' ? obj.subscription : null,
          plan,
          'active',
          interval,
          eventCreated,
          Number(userId)
        );
        // The session says WHICH tier was bought. It cannot say when it renews -- a Checkout
        // Session carries no period end -- and for a FIRST-TIME subscriber the event that does
        // carry one is routinely lost. customer.subscription.created/updated match on
        // stripe_customer_id, which the UPDATE above has only just written, so an event that
        // arrives first matches nothing; and one that arrives second can still be rejected,
        // because its `created` is often a second EARLIER than the session's and the ordering
        // guard refuses anything older than the watermark. Either way plan_renews_at stayed NULL
        // and the billing card showed no renewal date until the first renewal, a month later.
        // Observed on prod: one subscriber, one missing date, no error anywhere.
        //
        // So ask Stripe, now that the link exists. Best effort on purpose: an unacked webhook is
        // retried and the retry is swallowed by the idempotency ledger above, which would lose
        // the event outright -- this must never throw.
        const live = await liveSubscriptions(c.env, String(obj.customer)).catch(() => []);
        const bought =
          live.find((sub) => sub.id === obj.subscription) ?? (live.length === 1 ? live[0] : null);
        if (bought) {
          await db.run(
            c.env.DB,
            // COALESCE with the COLUMN FIRST, which is the whole contract of this statement: it
            // fills gaps and never overwrites. Argument order is the entire difference --
            // COALESCE(?, col) writes whenever the reply is non-null and would stamp on a value
            // some other event already got right, while COALESCE(col, ?) only writes into a
            // hole. This write carries no ordering guard, unlike applySubscription, so being
            // unable to clobber is what makes it safe to run at any point in the sequence.
            'UPDATE users SET plan_renews_at = COALESCE(plan_renews_at, ?), subscription_interval = COALESCE(subscription_interval, ?), stripe_subscription_id = COALESCE(stripe_subscription_id, ?) WHERE id = ?',
            bought.currentPeriodEnd ? new Date(bought.currentPeriodEnd * 1000).toISOString() : null,
            intervalForSub(c.env, bought),
            bought.id,
            Number(userId)
          );
        }
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
          { data?: Array<{ price?: { id?: string }; current_period_end?: number }> } | undefined
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
      if (!entitled) {
        // A stray losing entitlement says nothing about the plan the account is on.
        if (await isStraySubscription(obj.customer, obj.id)) break;
        await endSubscription(obj.customer, obj.id, status);
        break;
      }
      // An entitled event is always ours to apply: money is changing hands and the account
      // should be on what it is paying for. This is also where a stray that outlives the tracked
      // subscription gets adopted.
      const interval =
        (meta?.interval === 'monthly' || meta?.interval === 'annual' ? meta.interval : null) ??
        (item?.price?.id ? intervalForPrice(c.env, item.price.id) : null);
      await applySubscription(
        String(obj.customer),
        metaPlan ?? subPlan ?? 'premium',
        status,
        renews,
        cancelAtPeriodEnd,
        interval,
        typeof obj.id === 'string' ? obj.id : null
      );
      break;
    }
    case 'customer.subscription.deleted': {
      // A stray ending is not this account losing its plan.
      if (await isStraySubscription(obj.customer, obj.id)) break;
      // Read before the update: after it the plan is 'free', and a mail that says "your Free plan
      // has ended" is nonsense.
      const acct = await accountFor(obj.customer);
      const { applied, keep } = await endSubscription(obj.customer, obj.id, 'canceled');
      // A stale event neither changes the plan nor announces that it did -- and neither does one
      // that moved the account onto a subscription it still holds. Nothing ended, for them.
      if (applied.meta.changes && !keep) await notify(acct);
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
