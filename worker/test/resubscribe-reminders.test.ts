/**
 * An account that unsubscribed by the link in a reminder mail gets reminders again only when it
 * asks for them: "Send me reminders again" in Settings, Email reminders, which posts to
 * /api/notifications/resubscribe. Before, nothing ever cleared users.notifications_unsubscribed:
 * the scheduler skipped the account for good while Settings still showed every switch on.
 *
 * Saving the Email reminders form does not lift it. The switches still read on after an
 * unsubscribe, and the form sends all of them on every save, so a save that only changed the
 * address would have turned reminders back on without anyone asking.
 *
 * The button lifts it only when the saved switches would send something (the master switch and at
 * least one kind) and the plan includes email reminders. Otherwise it answers an error the card
 * shows.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScheduledReminders } from '../src/reminders';
import { sessionCookie } from './helpers/session';

/** The daily cron, which sends the bills reminder (wrangler.jsonc). */
const BILLS_CRON = '0 8 * * *';

const ME = 9960;
const OTHER = 9961;
const FREE = 9962;
const IDS = [ME, OTHER, FREE].join(', ');
const ADDRESS = 'resub-me@example.com';

const ALL_ON = {
  email: ADDRESS,
  emailNotifications: true,
  budgetAlerts: true,
  spendingReport: true,
  billsReminders: true,
};
const ALL_OFF = {
  email: ADDRESS,
  emailNotifications: false,
  budgetAlerts: false,
  spendingReport: false,
  billsReminders: false,
};

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

async function unsubscribed(id: number): Promise<number> {
  const row = await env.DB.prepare('SELECT notifications_unsubscribed FROM users WHERE id = ?')
    .bind(id)
    .first<{ notifications_unsubscribed: number | null }>();
  return row?.notifications_unsubscribed ?? 0;
}

/** Press Unsubscribe on the page the mail's link opens. */
async function unsubscribeByLink(token: string): Promise<void> {
  const res = await SELF.fetch(
    `https://example.com/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    }
  );
  expect(res.status).toBe(200);
}

async function settings(
  id: number,
  method: 'GET' | 'PUT',
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const cookie = (await sessionCookie(id, 'password', env)).split(';')[0];
  const res = await SELF.fetch('https://example.com/api/notifications/settings', {
    method,
    headers: {
      Cookie: cookie,
      'X-Profile-Id': String(id),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Press "Send me reminders again"; `id` null sends no session. */
async function resubscribe(
  id: number | null
): Promise<{ status: number; json: Record<string, unknown> }> {
  const cookie = id === null ? '' : (await sessionCookie(id, 'password', env)).split(';')[0];
  const res = await SELF.fetch('https://example.com/api/notifications/resubscribe', {
    method: 'POST',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(id === null ? {} : { 'X-Profile-Id': String(id) }),
    },
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Store one switch the way a save does. */
async function saved(id: number, key: string, on: boolean): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)')
    .bind(key, on ? 'true' : 'false', id)
    .run();
}

beforeEach(async () => {
  await removeAccounts();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const accounts = [
    { id: ME, email: ADDRESS, plan: 'advanced' },
    { id: OTHER, email: 'resub-other@example.com', plan: 'advanced' },
    { id: FREE, email: 'resub-free@example.com', plan: 'free' },
  ];
  for (const a of accounts) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, plan, unsubscribe_token) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1, 1, ?, ?)"
      ).bind(a.id, a.email, a.plan, `resub-token-${a.id}`),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
        a.id,
        a.id
      ),
      env.DB.prepare(
        "INSERT INTO settings (key, value, profile_id) VALUES ('email_notifications', 'true', ?), ('email_bills_reminders', 'true', ?)"
      ).bind(a.id, a.id),
      env.DB.prepare(
        "INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, due_date, is_active, type) VALUES (?, 'Rent', 500, 'monthly', ?, ?, 1, 'bill')"
      ).bind(a.id, Number(due.slice(8, 10)), due),
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

describe('saving the Email reminders form does not lift an unsubscribe', () => {
  it('a save that only changes the address keeps it, and the old address gets no reminder', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);

    // What the form sends: the new address with all five values, every switch still reading on.
    const res = await settings(ME, 'PUT', { ...ALL_ON, email: 'resub-new@example.com' });
    expect(res.status).toBe(200);

    expect(await unsubscribed(ME)).toBe(1);
    // The change itself mails both addresses (the link, and a notice to the current one).
    mailed = [];
    await runScheduledReminders(BILLS_CRON, env);
    expect(mailed).not.toContain(ADDRESS);
  });

  it('a save that changes a switch keeps it', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);

    expect((await settings(ME, 'PUT', { ...ALL_ON, spendingReport: false })).status).toBe(200);

    expect(await unsubscribed(ME)).toBe(1);
  });

  it('a save with every switch on keeps it', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);

    await settings(ME, 'PUT', ALL_ON);

    expect(await unsubscribed(ME)).toBe(1);
  });
});

describe('POST /api/notifications/resubscribe', () => {
  it('lifts it when the saved switches would send something, and the scheduler mails again', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);
    await runScheduledReminders(BILLS_CRON, env);
    expect(mailed).not.toContain(ADDRESS);

    const res = await resubscribe(ME);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, unsubscribed: false });

    expect(await unsubscribed(ME)).toBe(0);
    await runScheduledReminders(BILLS_CRON, env);
    expect(mailed).toContain(ADDRESS);
  });

  it('refuses with the master switch off, even with every kind on', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);
    await saved(ME, 'email_notifications', false);
    await saved(ME, 'email_budget_alerts', true);
    await saved(ME, 'email_spending_report', true);

    const res = await resubscribe(ME);
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toContain('save');

    expect(await unsubscribed(ME)).toBe(1);
  });

  it('refuses with the master switch on and no kind on', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);
    await saved(ME, 'email_bills_reminders', false);

    expect((await resubscribe(ME)).status).toBe(400);

    expect(await unsubscribed(ME)).toBe(1);
  });

  it('refuses a plan without email reminders', async () => {
    await unsubscribeByLink(`resub-token-${FREE}`);

    expect((await resubscribe(FREE)).status).toBe(402);

    expect(await unsubscribed(FREE)).toBe(1);
  });

  it('refuses a request with no session', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);

    expect((await resubscribe(null)).status).toBe(401);

    expect(await unsubscribed(ME)).toBe(1);
  });

  it("does not touch another account's flag", async () => {
    await unsubscribeByLink(`resub-token-${ME}`);
    await unsubscribeByLink(`resub-token-${OTHER}`);

    await resubscribe(ME);

    expect(await unsubscribed(ME)).toBe(0);
    expect(await unsubscribed(OTHER)).toBe(1);
  });

  it('answers 200 for an account that never unsubscribed', async () => {
    const res = await resubscribe(ME);
    expect(res.status).toBe(200);
    expect(await unsubscribed(ME)).toBe(0);
  });
});

describe('GET /api/notifications/settings reports the unsubscribe', () => {
  it('says unsubscribed: false for an account that never unsubscribed', async () => {
    const { status, json } = await settings(ME, 'GET');
    expect(status).toBe(200);
    expect(json.unsubscribed).toBe(false);
  });

  it('says unsubscribed: true after the link, and false again after the button', async () => {
    await unsubscribeByLink(`resub-token-${ME}`);
    expect((await settings(ME, 'GET')).json.unsubscribed).toBe(true);

    await resubscribe(ME);

    expect((await settings(ME, 'GET')).json.unsubscribed).toBe(false);
  });
});

describe('the page after unsubscribing', () => {
  it('names the button that turns reminders back on, and where it is', async () => {
    const res = await SELF.fetch(
      `https://example.com/api/notifications/unsubscribe?token=resub-token-${ME}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const html = await res.text();
    expect(html).toContain('You are unsubscribed');
    expect(html).toContain('Send me reminders again');
    expect(html).toContain('Settings, Email reminders');
  });
});
