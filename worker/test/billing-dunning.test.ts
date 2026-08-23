/**
 * The billing mails Stripe's webhooks trigger — a declined card, a bank asking for confirmation,
 * and a subscription that has ended.
 *
 * Before this there was silence: the webhook handled four events, none of them an `invoice.*`, so
 * a card could fail, retry, run out and drop the account to Free without a word from us. The app
 * showed a red line in Settings, which only helps someone already looking at it.
 *
 * The cases worth guarding are the ones where a mail would be WRONG — the first invoice of a
 * checkout the user is still standing in front of, an account with no address, an event Stripe
 * re-delivers, and one that arrives late and is refused by the ordering guard. Each must stay
 * quiet, and `null` is the assertion that carries the feature.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mailForBillingEvent } from '../src/billingMail';

const CUSTOMER = 'cus_dunning';
const UID = 8300;
const APP = 'https://app.example.com';
const ACCOUNT = { email: 'payer@example.com', plan: 'advanced' };

const mailFor = (
  type: string,
  obj: Record<string, unknown> = {},
  account: { email: string | null; plan: string | null } | null = ACCOUNT
) => mailForBillingEvent(type, obj, account, APP);

// ── The decision ───────────────────────────────────────────────────────────────────────────────

describe('a declined card', () => {
  const FAILED = {
    billing_reason: 'subscription_cycle',
    amount_due: 500,
    currency: 'eur',
    next_payment_attempt: 1_790_000_000,
    hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
  };

  it('says the plan is still active, and points at the page that can fix it', () => {
    const out = mailFor('invoice.payment_failed', FAILED);

    expect(out?.to).toBe('payer@example.com');
    expect(out?.mail.subject).toMatch(/didn't go through/i);
    expect(out?.mail.text).toMatch(/still active/i);
    // Stripe's hosted page is the only place the card can actually be replaced.
    expect(out?.mail.html).toContain('https://invoice.stripe.com/i/abc');
    // The plan's name, not its internal id.
    expect(out?.mail.html).toContain('Advanced');
  });

  it('says when the next attempt is, so the deadline is not a mystery', () => {
    const out = mailFor('invoice.payment_failed', FAILED);

    // 1790000000 → 2026-09-21 UTC.
    expect(out?.mail.html).toContain('21 September 2026');
  });

  it('reports the amount in major units, as a person would write it', () => {
    const out = mailFor('invoice.payment_failed', FAILED);

    // 500 minor units is five euros, not five hundred.
    expect(out?.mail.html).toMatch(/5(\.00)?/);
    expect(out?.mail.html).not.toContain('500.00');
  });

  it('manages without the parts Stripe may not send', () => {
    const out = mailFor('invoice.payment_failed', { billing_reason: 'subscription_cycle' });

    expect(out).not.toBeNull();
    // No amount, no retry date, and no hosted page — it still has to be a sendable message that
    // falls back to the app's own billing screen.
    expect(out?.mail.html).toContain(`${APP}/#settings`);
  });

  it('stays quiet about the first invoice of a checkout', () => {
    // The user is looking at Stripe's own error at that moment; a mail arrives after they have
    // already tried again.
    expect(
      mailFor('invoice.payment_failed', { ...FAILED, billing_reason: 'subscription_create' })
    ).toBeNull();
  });
});

describe('a bank asking for confirmation', () => {
  it('reads as a step to take, not as a failure', () => {
    const out = mailFor('invoice.payment_action_required', {
      hosted_invoice_url: 'https://invoice.stripe.com/i/3ds',
    });

    expect(out?.mail.subject).toMatch(/confirm/i);
    // The distinction is the whole point: "your payment failed" makes people less likely to open
    // the page that is the only thing which fixes it.
    expect(out?.mail.subject).not.toMatch(/didn't go through|failed|declined/i);
    expect(out?.mail.html).toContain('https://invoice.stripe.com/i/3ds');
  });
});

describe('a subscription that ended', () => {
  it('names the plan and says the data is still there', () => {
    const out = mailFor('customer.subscription.deleted');

    expect(out?.mail.subject).toContain('Advanced');
    expect(out?.mail.text).toMatch(/nothing has been deleted/i);
  });
});

describe('when there is nothing to say', () => {
  it('has no mail for an account with no address', () => {
    // Reachable: a Google account whose address Google did not verify is stored without one.
    expect(mailFor('invoice.payment_failed', {}, { email: null, plan: 'advanced' })).toBeNull();
  });

  it('has no mail for a customer we do not know', () => {
    expect(mailFor('invoice.payment_failed', {}, null)).toBeNull();
  });

  it('has no mail for the events it does not own', () => {
    expect(mailFor('customer.subscription.updated')).toBeNull();
    expect(mailFor('checkout.session.completed')).toBeNull();
    expect(mailFor('invoice.payment_succeeded')).toBeNull();
  });
});

// ── The route around it ────────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

async function sign(payload: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

let eventSeq = 0;

/** Deliver one Stripe event, signed the way the real thing signs it. */
async function deliver(
  type: string,
  object: Record<string, unknown>,
  opts: { id?: string } = {}
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: opts.id ?? `evt_${++eventSeq}`,
    type,
    created: now,
    data: { object },
  });
  return SELF.fetch('https://api.example.com/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': await sign(body, env.STRIPE_WEBHOOK_SECRET as string, now),
    },
    body,
  });
}

const planNow = async (): Promise<string | null> =>
  (
    await env.DB.prepare('SELECT plan FROM users WHERE id = ?')
      .bind(UID)
      .first<{ plan: string | null }>()
  )?.plan ?? null;

beforeAll(() => {
  // A wrangler secret in a real deployment; a throwaway here so the signature verifies.
  (env as unknown as Record<string, string>).STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM stripe_events').run();
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, auth_provider, email_verified, token_version, stripe_customer_id, plan, subscription_status, stripe_event_at) VALUES (?, 'payer@example.com', 'password', 1, 1, ?, 'advanced', 'active', 0)"
  )
    .bind(UID, CUSTOMER)
    .run();
});

describe('POST /api/billing/webhook', () => {
  it('acks an invoice event and leaves the plan alone — a decline is not a cancellation', async () => {
    const res = await deliver('invoice.payment_failed', {
      customer: CUSTOMER,
      billing_reason: 'subscription_cycle',
    });

    expect(res.status).toBe(200);
    // The grace window: Stripe is still retrying, so entitlement must not move.
    expect(await planNow()).toBe('advanced');
  });

  it('drops the plan when the subscription is deleted', async () => {
    await deliver('customer.subscription.deleted', { customer: CUSTOMER });

    expect(await planNow()).toBe('free');
  });

  it('changes nothing for an event that arrives after a newer one', async () => {
    // The ordering guard, and the reason the mail is sent only when the update actually applied:
    // announcing an end that did not happen is worse than saying nothing.
    await env.DB.prepare('UPDATE users SET stripe_event_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000) + 1000, UID)
      .run();

    await deliver('customer.subscription.deleted', { customer: CUSTOMER });

    expect(await planNow()).toBe('advanced');
  });

  it('does the work once, however many times Stripe delivers the same event', async () => {
    await deliver('customer.subscription.deleted', { customer: CUSTOMER }, { id: 'evt_repeat' });
    const second = await deliver(
      'customer.subscription.deleted',
      { customer: CUSTOMER },
      { id: 'evt_repeat' }
    );

    expect(await second.json()).toEqual({ received: true, duplicate: true });
  });

  it('refuses a body whose signature does not match', async () => {
    const res = await SELF.fetch('https://api.example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: JSON.stringify({
        id: 'evt_forged',
        type: 'customer.subscription.deleted',
        created: 1,
        data: { object: { customer: CUSTOMER } },
      }),
    });

    expect(res.status).toBe(400);
    expect(await planNow()).toBe('advanced');
  });
});

// ── The send ───────────────────────────────────────────────────────────────────────────────────

/**
 * The route decides *whether* to send from the outcome of the write it just did, and that link is
 * only visible end to end: `mailForBillingEvent` cannot see a stale event, and the plan column
 * cannot show a mail. Both halves are asserted here against the outbound call itself.
 */
describe('what actually leaves the worker', () => {
  const realFetch = globalThis.fetch;
  let sent: Array<Record<string, unknown>>;

  beforeEach(() => {
    (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
    sent = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('api.resend.com')) {
        sent.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  });

  it('mails the account behind the Stripe customer when the subscription ends', async () => {
    await deliver('customer.subscription.deleted', { customer: CUSTOMER });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('payer@example.com');
    // The plan is read before the update, so the mail names Advanced and not the Free the row
    // holds by the time it is sent.
    expect(String(sent[0].subject)).toContain('Advanced');
  });

  it('says nothing when a late event did not change anything', async () => {
    await env.DB.prepare('UPDATE users SET stripe_event_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000) + 1000, UID)
      .run();

    await deliver('customer.subscription.deleted', { customer: CUSTOMER });

    // The plan is untouched, so announcing an ending would be announcing something that did not
    // happen — worse than silence, because it is unfalsifiable from the user's side.
    expect(await planNow()).toBe('advanced');
    expect(sent).toHaveLength(0);
  });

  it('sends once when Stripe delivers the same event twice', async () => {
    const evt = { id: 'evt_double' };
    await deliver('customer.subscription.deleted', { customer: CUSTOMER }, evt);
    await deliver('customer.subscription.deleted', { customer: CUSTOMER }, evt);

    expect(sent).toHaveLength(1);
  });

  it('mails on a failed renewal without touching the plan', async () => {
    await deliver('invoice.payment_failed', {
      customer: CUSTOMER,
      billing_reason: 'subscription_cycle',
      hosted_invoice_url: 'https://invoice.stripe.com/i/xyz',
    });

    expect(sent).toHaveLength(1);
    expect(String(sent[0].html)).toContain('https://invoice.stripe.com/i/xyz');
    expect(await planNow()).toBe('advanced');
  });

  it('acks the webhook even when the mail cannot be sent', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Resend is down');
    }) as typeof fetch;

    const res = await deliver('customer.subscription.deleted', { customer: CUSTOMER });

    // A 500 here would have Stripe retry, and the retry would re-apply an event we already
    // recorded — an undelivered mail must not cost us the webhook.
    expect(res.status).toBe(200);
    expect(await planNow()).toBe('free');
  });
});
