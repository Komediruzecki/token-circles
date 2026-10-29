/**
 * The week-one stop link: the unsubscribe route with `&list=week-one` (routes/notifications.ts).
 *
 * GET shows a page that words it as first-week mails and changes nothing. POST, from its button or
 * a mail app's one-click request, turns users.week_one_mails off and leaves
 * notifications_unsubscribed alone, so the reminders a paid plan has keep coming. The link without
 * a list is the general unsubscribe, as before, and it stops the week-one mails too.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScheduledReminders } from '../src/reminders';
import { runWeekOneMails, WEEK_ONE_CRON } from '../src/weekOne';
import { sessionCookie } from './helpers/session';

/** The 08:00 cron, which sends the bills reminder (wrangler.jsonc). */
const BILLS_CRON = '0 8 * * *';

const ID = 97400;
const OTHER = 97401;
const TOKEN = 'tok-week-one-97400';
const BASE = 'https://example.com/api/notifications/unsubscribe';
const WEEK_ONE_URL = `${BASE}?token=${TOKEN}&list=week-one`;
const GENERAL_URL = `${BASE}?token=${TOKEN}`;

/** A mail provider's one-click request: form-encoded body, no cookie, from its own origin. */
const ONE_CLICK: RequestInit = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://mail.example.net',
  },
  body: 'List-Unsubscribe=One-Click',
};
/** The page's own button: an empty form post. */
const BUTTON: RequestInit = {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: '',
};

const realFetch = globalThis.fetch;
let mailed: { to: string; subject: string; headers?: Record<string, string> }[] = [];

async function flags(id = ID): Promise<{ weekOne: number; unsubscribed: number }> {
  const row = await env.DB.prepare(
    'SELECT week_one_mails, notifications_unsubscribed FROM users WHERE id = ?'
  )
    .bind(id)
    .first<{ week_one_mails: number; notifications_unsubscribed: number }>();
  return { weekOne: row!.week_one_mails, unsubscribed: row!.notifications_unsubscribed };
}

async function remove(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bills WHERE profile_id IN (?, ?)').bind(ID, OTHER),
    env.DB.prepare('DELETE FROM settings WHERE profile_id IN (?, ?)').bind(ID, OTHER),
    env.DB.prepare('DELETE FROM reminder_dedup WHERE user_id IN (?, ?)').bind(ID, OTHER),
    env.DB.prepare('DELETE FROM reminder_sends WHERE user_id IN (?, ?)').bind(ID, OTHER),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(ID, OTHER),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(ID, OTHER),
  ]);
}

beforeEach(async () => {
  await remove();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await env.DB.batch([
    // A confirmed account on a plan with reminders, two days into its first week, with nothing
    // imported and a bill due: due a week-one mail and a bills reminder.
    env.DB.prepare(
      `INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan, unsubscribe_token)
       VALUES (?, 'week-one-stop@example.com', 'password', 1, 1, 'advanced', ?)`
    ).bind(ID, TOKEN),
    env.DB.prepare(
      `INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan, unsubscribe_token)
       VALUES (?, 'week-one-stays@example.com', 'password', 1, 1, 'free', 'tok-week-one-97401')`
    ).bind(OTHER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Week one stop')").bind(
      ID,
      ID
    ),
    env.DB.prepare(
      "INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (?, 'welcome', datetime('now', '-2 days', '-1 hour'))"
    ).bind(ID),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('email_notifications', 'true', ?), ('email_bills_reminders', 'true', ?)"
    ).bind(ID, ID),
    env.DB.prepare(
      "INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, due_date, is_active, type) VALUES (?, 'Sample rent', 500, 'monthly', ?, ?, 1, 'bill')"
    ).bind(ID, Number(due.slice(8, 10)), due),
  ]);
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as (typeof mailed)[number];
      if (body.to.startsWith('week-one-')) mailed.push(body);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await remove();
});

const weekOneMails = () => mailed.filter((m) => m.subject.startsWith('How to get a year'));
const billsReminders = () => mailed.filter((m) => /bills? due|overdue/.test(m.subject));

describe('GET with list=week-one', () => {
  it('words the page as first-week mails, posts back to the same link, and changes nothing', async () => {
    const res = await SELF.fetch(WEEK_ONE_URL);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Stop first-week mails?');
    expect(html).toContain(
      `<form method="post" action="/api/notifications/unsubscribe?token=${TOKEN}&amp;list=week-one">`
    );
    expect(html).not.toContain('Stop reminder mails?');
    await SELF.fetch(WEEK_ONE_URL, { method: 'HEAD' });
    await SELF.fetch(WEEK_ONE_URL);
    expect(await flags()).toEqual({ weekOne: 1, unsubscribed: 0 });
  });

  it('says they are off, with no button, once they are', async () => {
    await env.DB.prepare('UPDATE users SET week_one_mails = 0 WHERE id = ?').bind(ID).run();
    const html = await (await SELF.fetch(WEEK_ONE_URL)).text();
    expect(html).toContain('First-week mails are off');
    expect(html).not.toContain('<form');
  });

  it('rejects an unknown token with no button', async () => {
    const res = await SELF.fetch(`${BASE}?token=wrong&list=week-one`);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('<form');
  });
});

describe('POST with list=week-one', () => {
  it("stops the week-one mails only, from the page's button", async () => {
    const res = await SELF.fetch(WEEK_ONE_URL, BUTTON);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('First-week mails are off');
    expect(await flags()).toEqual({ weekOne: 0, unsubscribed: 0 });
    expect(await flags(OTHER)).toEqual({ weekOne: 1, unsubscribed: 0 });
  });

  it("does the same for a mail app's one-click request, twice over", async () => {
    expect((await SELF.fetch(WEEK_ONE_URL, ONE_CLICK)).status).toBe(200);
    expect((await SELF.fetch(WEEK_ONE_URL, ONE_CLICK)).status).toBe(200);
    expect(await flags()).toEqual({ weekOne: 0, unsubscribed: 0 });
  });

  it('rejects an unknown token and changes nothing', async () => {
    const res = await SELF.fetch(`${BASE}?token=wrong&list=week-one`, ONE_CLICK);
    expect(res.status).toBe(400);
    expect(await flags()).toEqual({ weekOne: 1, unsubscribed: 0 });
  });

  it('stops the week-one mail and leaves the reminders coming', async () => {
    await SELF.fetch(WEEK_ONE_URL, ONE_CLICK);
    await runScheduledReminders(BILLS_CRON, env);
    await runWeekOneMails(WEEK_ONE_CRON, env);
    expect(weekOneMails()).toHaveLength(0);
    expect(billsReminders()).toHaveLength(1);
  });

  it("is what the week-one mail's own List-Unsubscribe header does", async () => {
    await runWeekOneMails(WEEK_ONE_CRON, env);
    const [mail] = weekOneMails();
    const url = /^<(.+)>$/.exec(mail!.headers!['List-Unsubscribe']!)![1]!;
    expect(url).toContain(`token=${TOKEN}&list=week-one`);
    expect((await SELF.fetch(url, ONE_CLICK)).status).toBe(200);
    expect(await flags()).toEqual({ weekOne: 0, unsubscribed: 0 });
  });
});

describe('the link without a list', () => {
  it('stops every reminder mail as before, the week-one mails included', async () => {
    expect((await SELF.fetch(GENERAL_URL, ONE_CLICK)).status).toBe(200);
    expect(await flags()).toEqual({ weekOne: 1, unsubscribed: 1 });
    await runScheduledReminders(BILLS_CRON, env);
    await runWeekOneMails(WEEK_ONE_CRON, env);
    expect(mailed).toHaveLength(0);
  });

  it('words its pages as reminder mails, first-week mails among them', async () => {
    const html = await (await SELF.fetch(GENERAL_URL)).text();
    expect(html).toContain('Stop reminder mails?');
    expect(html).toContain('bill reminders and first-week mails');
    expect(html).toContain('Send me reminders again in Settings, Email reminders');
    expect(html).toContain(`action="/api/notifications/unsubscribe?token=${TOKEN}"`);
    await SELF.fetch(GENERAL_URL, ONE_CLICK);
    const done = await (await SELF.fetch(GENERAL_URL)).text();
    expect(done).toContain('bill reminders or first-week mails');
    expect(done).toContain('Send me reminders again in Settings, Email reminders');
  });
});

describe('Send me reminders again', () => {
  it('lifts the general unsubscribe only: a week-one stop stays', async () => {
    await SELF.fetch(WEEK_ONE_URL, ONE_CLICK);
    await SELF.fetch(GENERAL_URL, ONE_CLICK);
    expect(await flags()).toEqual({ weekOne: 0, unsubscribed: 1 });

    const cookie = (await sessionCookie(ID, 'password', env)).split(';')[0]!;
    const res = await SELF.fetch('https://example.com/api/notifications/resubscribe', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': String(ID) },
    });
    expect(res.status).toBe(200);
    expect(await flags()).toEqual({ weekOne: 0, unsubscribed: 0 });
    await runWeekOneMails(WEEK_ONE_CRON, env);
    expect(weekOneMails()).toHaveLength(0);
  });
});
