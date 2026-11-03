/**
 * Every mail the Worker sends links to the deployment it was sent from: the app (CORS_ORIGIN), the
 * about site (ABOUT_ORIGIN) and the API (API_PUBLIC_ORIGIN), never production's unless that is
 * where it runs (A20). The renderers are held to this in mail-origins.test.ts; here each sender is,
 * through the route or the run that sends its mail, on a deployment of made-up origins.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  sendBillsRemindersForUser,
  sendBudgetAlertsForUser,
  sendSpendingReportForUser,
  type UserRow,
} from '../src/reminders';
import { mailWelcome } from '../src/welcome';
import { offOrigins } from './helpers/mail-links';
import { sessionCookie } from './helpers/session';

const APP = 'https://app.example.test';
const ABOUT = 'https://about.example.test';
const API = 'https://api.example.test';
const ORIGINS = [APP, ABOUT, API];

/** A deployment on made-up origins, with mail and the support relay switched on. */
const RUN = {
  ...(env as unknown as Env),
  CORS_ORIGIN: APP,
  APP_ORIGINS: APP,
  API_PUBLIC_ORIGIN: API,
  ABOUT_ORIGIN: ABOUT,
  RESEND_API_KEY: 'rk_test',
  SUPPORT_EMAIL: 'support-inbox@example.test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
} as Env;

const UID = 7720;
const ADDRESS = 'origins@example.test';
const TOKEN = 'tok-origins-7720';

interface Sent {
  to: string;
  subject: string;
  html: string;
  text: string;
}
const realFetch = globalThis.fetch;
let sent: Sent[] = [];

const today = new Date().toISOString().slice(0, 10);
const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

async function clear(): Promise<void> {
  for (const t of [
    'transactions',
    'budgets',
    'categories',
    'bills',
    'settings',
    'reminder_dedup',
    'reminder_sends',
    'login_codes',
    'password_resets',
    'email_verifications',
    'stripe_events',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

const user = (): UserRow => ({
  id: UID,
  email: ADDRESS,
  plan: 'advanced',
  notifications_unsubscribed: 0,
  unsubscribe_token: TOKEN,
});

beforeEach(async () => {
  await clear();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, plan, unsubscribe_token, stripe_customer_id, subscription_status, stripe_event_at) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1, 1, 'advanced', ?, 'cus_origins', 'active', 0)"
    ).bind(UID, ADDRESS, TOKEN),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(UID, UID),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('email_notifications', 'true', ?), ('email_budget_alerts', 'true', ?), ('email_spending_report', 'true', ?), ('email_bills_reminders', 'true', ?)"
    ).bind(UID, UID, UID, UID),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (78, ?, 'Food', 'expense', '#F97316')"
    ).bind(UID),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (?, 'Groceries', 120, 'expense', ?, 78)"
    ).bind(UID, today),
    env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, 78, 100, 'monthly', ?)"
    ).bind(UID, `${today.slice(0, 8)}01`),
    env.DB.prepare(
      "INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, due_date, is_active, type) VALUES (?, 'Rent', 500, 'monthly', ?, ?, 1, 'bill')"
    ).bind(UID, Number(inTwoDays.slice(8, 10)), inTwoDays),
  ]);
  sent = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Sent);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await clear();
});

/** A request to this deployment's API from its app, back once the work after its answer is done. */
async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${API}${path}`, {
      method,
      headers: {
        Origin: APP,
        'CF-Connecting-IP': '203.0.113.77',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    RUN,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const cookieOf = async () => (await sessionCookie(UID, 'password', RUN)).split(';')[0]!;

/** The one mail sent to `to`, every link of which is on this deployment's origins. */
function expectOnTheRun(to: string): Sent {
  const ours = sent.filter((m) => m.to === to);
  expect(ours, JSON.stringify(sent.map((m) => [m.to, m.subject]))).toHaveLength(1);
  const mail = ours[0]!;
  expect(offOrigins(mail, ORIGINS)).toEqual([]);
  // The footer's About, and with it Terms and Privacy, are the run's about site.
  expect(mail.html).toContain(`href="${ABOUT}/privacy"`);
  return mail;
}

describe("the mails link to the deployment's own origins", () => {
  it('the budget alert, the spending report and the bills reminder', async () => {
    expect(await sendBudgetAlertsForUser(RUN, user())).toBe(true);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#budgets`);
    sent = [];
    expect(await sendSpendingReportForUser(RUN, user())).toBe(true);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#analytics`);
    sent = [];
    expect(await sendBillsRemindersForUser(RUN, user())).toBe(true);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#bills`);
  });

  it.each(['basic', 'spending', 'budget', 'bills'])(
    'the %s test mail sent from Settings',
    async (type) => {
      const res = await call(
        'POST',
        '/api/notifications/test-email',
        { type },
        { Cookie: await cookieOf() }
      );
      expect(res.status).toBe(200);
      expectOnTheRun(ADDRESS);
    }
  );

  it('the sign-in code', async () => {
    expect((await call('POST', '/api/auth/email-code/request', { email: ADDRESS })).status).toBe(
      200
    );
    expect(expectOnTheRun(ADDRESS).text).toContain(`Open the app: ${APP}`);
  });

  it('the password reset', async () => {
    expect((await call('POST', '/api/auth/forgot-password', { email: ADDRESS })).status).toBe(200);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#reset-password?token=`);
  });

  it('the confirm mail, its fresh link, and the notice for an address that has an account', async () => {
    const fresh = 'origins-fresh@example.test';
    const register = (email: string) =>
      call('POST', '/api/auth/register', { email, password: 'correct horse battery staple' });
    expect((await register(fresh)).status).toBe(200);
    expect(expectOnTheRun(fresh).text).toContain(`${API}/api/auth/verify-email`);
    sent = [];
    // Signing up again while the first link waits mails a fresh one.
    expect((await register(fresh)).status).toBe(200);
    expectOnTheRun(fresh);
    sent = [];
    expect((await register(ADDRESS)).status).toBe(200);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#forgot-password`);
  });

  it('the welcome', async () => {
    await mailWelcome(RUN, UID, APP);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#import`);
  });

  it('the email change link, and the notice to the address in use', async () => {
    const next = 'origins-next@example.test';
    const res = await call(
      'PUT',
      '/api/notifications/settings',
      { email: next },
      { Cookie: await cookieOf() }
    );
    expect(res.status).toBe(200);
    expectOnTheRun(next);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#settings`);
  });

  it('the support acknowledgement', async () => {
    const asker = 'origins-asker@example.test';
    const res = await call('POST', '/api/support/contact', {
      email: asker,
      message: 'A question about importing a file.',
    });
    expect(res.status).toBe(200);
    expectOnTheRun(asker);
  });

  it('the billing mail', async () => {
    const enc = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: 'evt_origins',
      type: 'customer.subscription.deleted',
      created: now,
      data: { object: { customer: 'cus_origins' } },
    });
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('whsec_test'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${now}.${body}`));
    const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${API}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${now},v1=${hex}` },
        body,
      }),
      RUN,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(expectOnTheRun(ADDRESS).text).toContain(`${APP}/#settings`);
  });
});
