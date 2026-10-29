/**
 * Mail apps show their own unsubscribe button when a mail carries List-Unsubscribe and
 * List-Unsubscribe-Post (RFC 2369, RFC 8058). Every mail that has an unsubscribe link in its footer
 * sends both, pointing at that same link; a mail without one (sign-in, welcome, billing) sends
 * neither, since there is nothing for a mail app to unsubscribe from.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendMail } from '../src/email';
import type { Env } from '../src/index';
import {
  sendBillsRemindersForUser,
  sendBudgetAlertsForUser,
  sendSpendingReportForUser,
  type UserRow,
} from '../src/reminders';
import { fetchSettled } from './helpers/after-answer';
import { sessionCookie } from './helpers/session';

const UID = 7710;
const ADDRESS = 'headers@example.com';
const TOKEN = 'tok-headers-7710';
/** The link in the footer, on the local Worker's public origin (wrangler.jsonc vars). */
const LINK = `http://localhost:8787/api/notifications/unsubscribe?token=${TOKEN}`;
const ONE_CLICK = 'List-Unsubscribe=One-Click';

const realFetch = globalThis.fetch;
type Sent = { to: string; subject: string; text?: string; headers?: Record<string, string> };
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

beforeAll(() => {
  (env as unknown as Record<string, string>).STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

beforeEach(async () => {
  await clear();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, plan, unsubscribe_token, stripe_customer_id, subscription_status, stripe_event_at) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1, 1, 'advanced', ?, 'cus_headers', 'active', 0)"
    ).bind(UID, ADDRESS, TOKEN),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(UID, UID),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('email_notifications', 'true', ?), ('email_budget_alerts', 'true', ?), ('email_spending_report', 'true', ?), ('email_bills_reminders', 'true', ?)"
    ).bind(UID, UID, UID, UID),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (77, ?, 'Food', 'expense', '#F97316')"
    ).bind(UID),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (?, 'Groceries', 120, 'expense', ?, 77)"
    ).bind(UID, today),
    env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, 77, 100, 'monthly', ?)"
    ).bind(UID, `${today.slice(0, 8)}01`),
    env.DB.prepare(
      "INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, due_date, is_active, type) VALUES (?, 'Rent', 500, 'monthly', ?, ?, 1, 'bill')"
    ).bind(UID, Number(inTwoDays.slice(8, 10)), inTwoDays),
  ]);
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
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
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await clear();
});

/** The one mail sent to ADDRESS. */
function theMail(): Sent {
  const ours = sent.filter((m) => m.to === ADDRESS);
  expect(ours, JSON.stringify(sent.map((m) => m.subject))).toHaveLength(1);
  return ours[0]!;
}

function expectUnsubscribeHeaders(mail: Sent): void {
  expect(mail.headers).toEqual({
    'List-Unsubscribe': `<${LINK}>`,
    'List-Unsubscribe-Post': ONE_CLICK,
  });
  // The header names the link the footer shows, not some other one.
  expect(mail.text).toContain(`Unsubscribe: ${LINK}`);
}

describe('sendMail', () => {
  it('adds both headers for a list-unsubscribe URL, in angle brackets', async () => {
    await sendMail(env as unknown as Env, ADDRESS, 'Subject', '<p>x</p>', {
      listUnsubscribe: 'https://api.example.com/api/notifications/unsubscribe?token=t&list=x',
    });
    expect(theMail().headers).toEqual({
      'List-Unsubscribe': '<https://api.example.com/api/notifications/unsubscribe?token=t&list=x>',
      'List-Unsubscribe-Post': ONE_CLICK,
    });
  });

  it('sends no headers field at all without one', async () => {
    await sendMail(env as unknown as Env, ADDRESS, 'Subject', '<p>x</p>', { text: 'x' });
    expect(theMail()).not.toHaveProperty('headers');
  });
});

describe('the reminder mails carry the headers', () => {
  it('on the budget alert', async () => {
    expect(await sendBudgetAlertsForUser(env as unknown as Env, user())).toBe(true);
    expectUnsubscribeHeaders(theMail());
  });

  it('on the spending report', async () => {
    expect(await sendSpendingReportForUser(env as unknown as Env, user())).toBe(true);
    expectUnsubscribeHeaders(theMail());
  });

  it('on the bills reminder', async () => {
    expect(await sendBillsRemindersForUser(env as unknown as Env, user())).toBe(true);
    expectUnsubscribeHeaders(theMail());
  });

  it.each(['spending', 'budget', 'bills'])(
    'on the %s preview sent from Settings, which has the same footer',
    async (type) => {
      const cookie = (await sessionCookie(UID)).split(';')[0]!;
      const res = await fetchSettled('https://api.example.com/api/notifications/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ type }),
      });
      expect(res.status).toBe(200);
      expectUnsubscribeHeaders(theMail());
    }
  );
});

describe('mails without an unsubscribe link carry neither header', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetchSettled(`https://api.example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('the sign-in code', async () => {
    expect((await post('/api/auth/email-code/request', { email: ADDRESS })).status).toBe(200);
    const mail = theMail();
    expect(mail.text).not.toContain('Unsubscribe:');
    expect(mail).not.toHaveProperty('headers');
  });

  it('the welcome mail', async () => {
    const fresh = 'fresh-headers@example.com';
    expect(
      (await post('/api/auth/register', { email: fresh, password: 'correct horse battery staple' }))
        .status
    ).toBe(200);
    const welcome = sent.filter((m) => m.to === fresh);
    expect(welcome).toHaveLength(1);
    expect(welcome[0]!.text).not.toContain('Unsubscribe:');
    expect(welcome[0]).not.toHaveProperty('headers');
  });

  it('the billing mail', async () => {
    const enc = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: 'evt_headers',
      type: 'customer.subscription.deleted',
      created: now,
      data: { object: { customer: 'cus_headers' } },
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
    const res = await fetchSettled('https://api.example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${now},v1=${hex}` },
      body,
    });
    expect(res.status).toBe(200);
    const mail = theMail();
    expect(mail.text).not.toContain('Unsubscribe:');
    expect(mail).not.toHaveProperty('headers');
  });
});
