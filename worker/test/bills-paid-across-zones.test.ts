/**
 * Marking a bill paid from two clients whose calendars are on different months.
 *
 * "Paid for the current period" is asked on the caller's calendar (X-Time-Zone). At
 * 2026-10-31T23:30Z it is already 1 November in Tokyo and still 31 October in UTC, the calendar of
 * a client that sends no zone (an API token, an app older than the header). A payment the Tokyo
 * phone stamped 2026-11-01 was not "this month" for the UTC client, so it paid again, and its
 * 2026-10-31 was not "this month" for the phone, which paid a third time. The money left three
 * times where one tap, then two 409s, was the answer before the header existed.
 *
 * A payment dated on or after the start of the caller's period settles it, whichever calendar
 * stamped it.
 *
 * Not covered, because the stored date cannot tell: when the client on the earlier calendar pays
 * first (UTC stamps 2026-10-31 while Tokyo is on 1 November), Tokyo reads an October payment and
 * November as unpaid, exactly as it would for rent really paid on 31 October.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { markPaidStatements, type BillRow } from '../src/routes/bills';
import { wallClockIn } from '../../shared/calendarDate';

const USER = 6041;
const PROFILE = 60410;
const GIRO = 604100;

const TOKYO = 'Asia/Tokyo';
const LOS_ANGELES = 'America/Los_Angeles';

let cookie = '';

beforeEach(async () => {
  for (const t of ['transactions', 'bills', 'accounts', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'zones-paid@example.com', 'password', 1, 'advanced')"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ).bind(GIRO, PROFILE),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

async function at(instant: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
}

async function rent(frequency = 'monthly', dueDate = '2026-10-31'): Promise<number> {
  const res = await env.DB.prepare(
    "INSERT INTO bills (profile_id, name, amount, frequency, due_date, day_of_month, is_active, type, account_id) VALUES (?, 'Rent', 300, ?, ?, 31, 1, 'bill', ?)"
  )
    .bind(PROFILE, frequency, dueDate, GIRO)
    .run();
  return res.meta.last_row_id as number;
}

function headers(zone: string | undefined): Record<string, string> {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-Profile-Id': String(PROFILE),
    ...(zone ? { 'X-Time-Zone': zone } : {}),
  };
}

async function tap(id: number, zone: string | undefined): Promise<number> {
  const res = await SELF.fetch(`https://example.com/api/bills/${id}/mark-paid`, {
    method: 'POST',
    headers: headers(zone),
  });
  return res.status;
}

/** The bill's `paid` flag in the list this client's Bills page reads. */
async function listedPaid(id: number, zone: string | undefined): Promise<boolean> {
  const res = await SELF.fetch('https://example.com/api/bills', { headers: headers(zone) });
  const rows = (await res.json()) as { id: number; paid: boolean }[];
  return rows.find((r) => r.id === id)!.paid;
}

async function payments(): Promise<{ count: number; balance: number }> {
  const tx = await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ?')
    .bind(PROFILE)
    .first<{ n: number }>();
  const acct = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(GIRO)
    .first<{ balance: number }>();
  return { count: tx!.n, balance: acct!.balance };
}

describe('a bill paid on a calendar already in the next month stays paid on the other', () => {
  it('Tokyo pays on 1 November; the client without a zone, still on 31 October, sees it paid', async () => {
    await at('2026-10-31T23:30:00Z');
    const id = await rent();

    expect(await tap(id, TOKYO)).toBe(200);
    expect(await listedPaid(id, undefined)).toBe(true);
    expect(await tap(id, undefined)).toBe(409);
    expect(await listedPaid(id, TOKYO)).toBe(true);
    expect(await tap(id, TOKYO)).toBe(409);

    expect(await payments()).toEqual({ count: 1, balance: 700 });
  });

  it('the client without a zone pays on 1 November; Los Angeles, still on 31 October, sees it paid', async () => {
    // 2026-11-01 03:30 UTC is 2026-10-31 20:30 in Los Angeles.
    await at('2026-11-01T03:30:00Z');
    const id = await rent();

    expect(await tap(id, undefined)).toBe(200);
    expect(await listedPaid(id, LOS_ANGELES)).toBe(true);
    expect(await tap(id, LOS_ANGELES)).toBe(409);
    expect(await listedPaid(id, undefined)).toBe(true);
    expect(await tap(id, undefined)).toBe(409);

    expect(await payments()).toEqual({ count: 1, balance: 700 });
  });

  it('a yearly bill paid on 1 January in Tokyo is paid for the client still in December', async () => {
    await at('2026-12-31T23:30:00Z');
    const id = await rent('yearly', '2026-12-31');

    expect(await tap(id, TOKYO)).toBe(200);
    expect(await listedPaid(id, undefined)).toBe(true);
    expect(await tap(id, undefined)).toBe(409);

    expect(await payments()).toEqual({ count: 1, balance: 700 });
  });

  it('two taps that both read the bill unpaid, from Tokyo and from UTC, take the money once', async () => {
    // Two requests can both pass the pre-flight read before either writes; what stops the second
    // is the guard each batch carries. Build both batches from the same read, then run them.
    await at('2026-10-31T23:30:00Z');
    const id = await rent();
    const bill = await env.DB.prepare('SELECT * FROM bills WHERE id = ?').bind(id).first<BillRow>();
    const tokyo = markPaidStatements(env.DB, bill!, PROFILE, wallClockIn(TOKYO), 'EUR');
    const utc = markPaidStatements(env.DB, bill!, PROFILE, wallClockIn('UTC'), 'EUR');

    const first = await env.DB.batch(tokyo);
    const second = await env.DB.batch(utc);

    expect(first.at(-1)?.meta.changes).toBe(1);
    expect(second.at(-1)?.meta.changes, 'the second claim found the bill settled').toBe(0);
    expect(await payments()).toEqual({ count: 1, balance: 700 });
  });
});

describe('the next period is still payable', () => {
  it('a monthly bill paid in October can be paid again once November begins', async () => {
    await at('2026-10-15T12:00:00Z');
    const id = await rent();
    expect(await tap(id, TOKYO)).toBe(200);

    await at('2026-11-02T12:00:00Z');
    expect(await listedPaid(id, TOKYO)).toBe(false);
    expect(await tap(id, TOKYO)).toBe(200);
    expect(await payments()).toEqual({ count: 2, balance: 400 });
  });

  it('a weekly bill paid eight days ago is due again', async () => {
    await at('2026-10-01T12:00:00Z');
    const id = await rent('weekly');
    expect(await tap(id, undefined)).toBe(200);

    await at('2026-10-09T12:00:00Z');
    expect(await listedPaid(id, undefined)).toBe(false);
    expect(await tap(id, undefined)).toBe(200);
  });
});
