/**
 * The week-one switch in Settings, through /api/notifications/settings: the account's own
 * users.week_one_mails, with no plan gate (Free gets these mails), whether a mail can still come
 * (Settings hides the switch once none can), and the general unsubscribe, which stops them too.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEK_ONE } from '../src/weekOne';
import { sessionCookie } from './helpers/session';

const UID = 97300;
const OTHER = 97301;
let cookie = '';

function send(method: 'GET' | 'PUT', body?: unknown, withCookie = true) {
  return SELF.fetch('https://example.com/api/notifications/settings', {
    method,
    headers: {
      ...(withCookie ? { Cookie: cookie } : {}),
      'X-Profile-Id': String(UID),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function read(): Promise<Record<string, unknown>> {
  const res = await send('GET');
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const column = async (id: number) =>
  (
    await env.DB.prepare('SELECT week_one_mails FROM users WHERE id = ?')
      .bind(id)
      .first<{ week_one_mails: number }>()
  )?.week_one_mails;

/** The Welcome claim, which dates the day the address was confirmed, `days` ago. */
const confirmedDaysAgo = (id: number, days: number) =>
  env.DB.prepare(
    "INSERT OR REPLACE INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (?, 'welcome', datetime('now', ?))"
  )
    .bind(id, `-${days} days`)
    .run();

async function remove(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminder_dedup WHERE user_id IN (?, ?)').bind(UID, OTHER),
    env.DB.prepare('DELETE FROM settings WHERE profile_id IN (?, ?)').bind(UID, OTHER),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(UID, OTHER),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(UID, OTHER),
  ]);
}

beforeEach(async () => {
  await remove();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'week-one-settings@example.com', 'password', 1, 'free')"
    ).bind(UID),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'week-one-other@example.com', 'password', 1, 'free')"
    ).bind(OTHER),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Week one settings')"
    ).bind(UID, UID),
  ]);
  cookie = (await sessionCookie(UID, 'password', env)).split(';')[0]!;
});

afterEach(remove);

describe('the week-one switch', () => {
  it('reads on for a new Free account, with a mail still to come', async () => {
    await confirmedDaysAgo(UID, 1);
    expect(await read()).toMatchObject({
      weekOneMails: true,
      weekOneAhead: true,
      unsubscribed: false,
    });
  });

  it('turns off and on for a Free account, and only for the signed-in one', async () => {
    const off = await send('PUT', { weekOneMails: false });
    expect(off.status).toBe(200);
    expect(await column(UID)).toBe(0);
    expect(await read()).toMatchObject({ weekOneMails: false });
    expect(await column(OTHER)).toBe(1);

    expect((await send('PUT', { weekOneMails: true })).status).toBe(200);
    expect(await column(UID)).toBe(1);
  });

  it('is left as it is by a save without it, or with something other than true or false', async () => {
    await send('PUT', { weekOneMails: false });
    await send('PUT', { budgetAlerts: true });
    await send('PUT', { weekOneMails: 'yes' });
    await send('PUT', { weekOneMails: 1 });
    expect(await column(UID)).toBe(0);
  });

  it('needs a session', async () => {
    expect((await send('PUT', { weekOneMails: false }, false)).status).toBe(401);
    expect(await column(UID)).toBe(1);
  });

  it('says no mail can come once the last window has closed, or day 7 has gone', async () => {
    await confirmedDaysAgo(UID, WEEK_ONE.day7.toDays + 1);
    expect(await read()).toMatchObject({ weekOneAhead: false });

    await confirmedDaysAgo(UID, 3);
    const mark = (key: string) =>
      env.DB.prepare('INSERT INTO reminder_dedup (user_id, dedup_key) VALUES (?, ?)')
        .bind(UID, key)
        .run();
    const unmark = (key: string) =>
      env.DB.prepare('DELETE FROM reminder_dedup WHERE user_id = ? AND dedup_key = ?')
        .bind(UID, key)
        .run();
    // Day 2 gone: day 7 can still come, once something is imported.
    await mark(WEEK_ONE.day2.key);
    expect(await read()).toMatchObject({ weekOneAhead: true });
    // Day 7 gone, with or without day 2 before it: nothing more can come.
    await mark(WEEK_ONE.day7.key);
    expect(await read()).toMatchObject({ weekOneAhead: false });
    await unmark(WEEK_ONE.day2.key);
    expect(await read()).toMatchObject({ weekOneAhead: false });
  });

  it('says no mail can come to an account with no confirmed day', async () => {
    expect(await read()).toMatchObject({ weekOneAhead: false });
  });

  it('reports the general unsubscribe, which stops these mails whatever the switch says', async () => {
    await env.DB.prepare('UPDATE users SET notifications_unsubscribed = 1 WHERE id = ?')
      .bind(UID)
      .run();
    expect(await read()).toMatchObject({ weekOneMails: true, unsubscribed: true });
  });
});
