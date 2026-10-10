/**
 * The scheduled reminder mails (runScheduledReminders) go to accounts that may use the app. A
 * password account waiting for its confirm link gets none; a confirmed password account and a
 * Google account get theirs as before, whatever the Google account's email_verified says.
 *
 * Each account here is set up the same way to get the bills reminder: a plan with reminders, the
 * reminder switched on, and a bill due in two days.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScheduledReminders } from '../src/reminders';

/** The daily cron, which sends the bills reminder (wrangler.jsonc). */
const BILLS_CRON = '0 8 * * *';

const ACCOUNTS = [
  { id: 9880, email: 'remind-waiting@example.com', provider: 'password', verified: 0 },
  { id: 9881, email: 'remind-confirmed@example.com', provider: 'password', verified: 1 },
  { id: 9882, email: 'remind-google@example.com', provider: 'google', verified: 0 },
];
const IDS = ACCOUNTS.map((a) => a.id).join(', ');

const realFetch = globalThis.fetch;
/** The addresses the Worker mailed. */
let mailed: string[] = [];

async function removeAccounts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM bills WHERE profile_id IN (${IDS})`),
    env.DB.prepare(`DELETE FROM settings WHERE profile_id IN (${IDS})`),
    env.DB.prepare(`DELETE FROM reminder_dedup WHERE user_id IN (${IDS})`),
    env.DB.prepare(`DELETE FROM reminder_sends WHERE user_id IN (${IDS})`),
    env.DB.prepare(`DELETE FROM profiles WHERE id IN (${IDS})`),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${IDS})`),
  ]);
}

beforeEach(async () => {
  await removeAccounts();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  for (const account of ACCOUNTS) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, auth_provider, provider_id, email_verified, token_version, plan) VALUES (?, ?, 'pbkdf2$100000$x$y', ?, ?, ?, 1, 'advanced')"
      ).bind(
        account.id,
        account.email,
        account.provider,
        account.provider === 'google' ? `google-sub-${account.id}` : null,
        account.verified
      ),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Reminded')").bind(
        account.id,
        account.id
      ),
      env.DB.prepare(
        "INSERT INTO settings (key, value, profile_id) VALUES ('email_notifications', 'true', ?), ('email_bills_reminders', 'true', ?)"
      ).bind(account.id, account.id),
      env.DB.prepare(
        "INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, due_date, is_active, type) VALUES (?, 'Rent', 500, 'monthly', ?, ?, 1, 'bill')"
      ).bind(account.id, Number(due.slice(8, 10)), due),
    ]);
  }
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      mailed.push((JSON.parse(String(init?.body ?? '{}')) as { to: string }).to);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await removeAccounts();
});

describe('the scheduled bills reminder', () => {
  it('goes to a confirmed password account and a Google account, and not to one waiting for its confirm link', async () => {
    await runScheduledReminders(BILLS_CRON, env);

    const ours = mailed.filter((to) => ACCOUNTS.some((a) => a.email === to)).sort();
    expect(ours).toEqual(['remind-confirmed@example.com', 'remind-google@example.com']);
  });

  it('goes to the account that was waiting once its address is confirmed', async () => {
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = 9880').run();

    await runScheduledReminders(BILLS_CRON, env);

    expect(mailed).toContain('remind-waiting@example.com');
  });
});
