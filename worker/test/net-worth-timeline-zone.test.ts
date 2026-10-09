/**
 * The net-worth timeline (/api/accounts/history/timeline) groups balance snapshots by the day
 * they were taken on the caller's calendar.
 *
 * A snapshot recorded through the app holds an instant, and the timeline grouped by SQLite's
 * date(recorded_at), the UTC date: a balance noted at 08:30 on the 8th in Tokyo was filed under
 * the 7th. A snapshot an import made holds a bare date, which is already the day. Without
 * X-Time-Zone the days are UTC ones, as before.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER = 6051;
const PROFILE = 60510;
const GIRO = 605100;
const SAVINGS = 605101;

let cookie = '';

beforeEach(async () => {
  for (const t of ['account_balance_history', 'accounts', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'timeline@example.com', 'password', 1, 'advanced')"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 0, 0), (?, ?, 'Savings', 'savings', 'EUR', 0, 0)"
    ).bind(GIRO, PROFILE, SAVINGS, PROFILE),
    // 23:30 UTC on the 7th is 08:30 on the 8th in Tokyo.
    env.DB.prepare(
      "INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, 100, '2026-10-07T23:30:00.000Z'), (?, 50, '2026-10-07')"
    ).bind(GIRO, SAVINGS),
  ]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

afterEach(() => {
  vi.useRealTimers();
});

async function timeline(zone?: string): Promise<{ date: string; net_worth: number }[]> {
  const res = await SELF.fetch('https://example.com/api/accounts/history/timeline', {
    headers: {
      Cookie: cookie,
      'X-Profile-Id': String(PROFILE),
      ...(zone ? { 'X-Time-Zone': zone } : {}),
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { date: string; net_worth: number }[];
}

it('files a snapshot under the caller’s day, and a dated one under its date', async () => {
  expect(await timeline('Asia/Tokyo')).toEqual([
    { date: '2026-10-07', net_worth: 50 },
    { date: '2026-10-08', net_worth: 100 },
  ]);
});

it('without a zone, under the UTC day', async () => {
  expect(await timeline()).toEqual([{ date: '2026-10-07', net_worth: 150 }]);
});
