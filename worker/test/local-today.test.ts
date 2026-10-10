/**
 * "Today" is the person's date, not the Worker's.
 *
 * workerd runs on UTC, so every route that read today, this month or this year off `new Date()`
 * read the UTC calendar. East of UTC that is yesterday for the first hours of every local day:
 * at 00:25 in Zagreb a transaction dated the 8th fell after a range that ended on the 7th, and
 * vanished from Monthly Income, Monthly Expense and the savings rate (release cases 2.14 and
 * 2.14b). West of UTC it is tomorrow every evening.
 *
 * The app now sends its IANA zone as X-Time-Zone (frontend/src/core/apiFetch.ts) and the routes
 * read the person's calendar through worker/src/local-date.ts. These cases pin an instant where
 * the two calendars disagree and check both directions:
 *
 *   2026-10-07 23:30 UTC  is 2026-10-08 08:30 in Tokyo and 13:30 on Kiritimati
 *   2026-10-08 03:30 UTC  is 2026-10-07 20:30 in Los Angeles
 *   2026-10-31 23:30 UTC  is 2026-11-01 in Tokyo: a new month
 *   2026-12-31 23:30 UTC  is 2027-01-01 in Tokyo: a new year
 *
 * Only Date is faked, and the session is issued after the clock is set, so the cookie is valid at
 * the pinned instant.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookie } from './helpers/session';
import { mintApiToken } from '../src/apitoken';
import { composeReminderPreview } from '../src/reminders';
import { wallClockIn } from '../../shared/calendarDate';
import { signCapability } from '../src/signed-url';
import { apiTokenRow } from './helpers/capability';

const USER = 81;
const PROFILE = 810;
const FOOD = 811;
const GIRO = 8100;

const LATE_ON_THE_7TH = '2026-10-07T23:30:00Z';
const EARLY_ON_THE_8TH = '2026-10-08T03:30:00Z';
const LAST_OF_OCTOBER = '2026-10-31T23:30:00Z';
const NEW_YEARS_EVE = '2026-12-31T23:30:00Z';

const TOKYO = 'Asia/Tokyo';
const KIRITIMATI = 'Pacific/Kiritimati';
const LOS_ANGELES = 'America/Los_Angeles';

let cookie = '';

beforeEach(async () => {
  for (const t of [
    'transactions',
    'recurring_transactions',
    'bills',
    'budgets',
    'savings_goals',
    'loans',
    'loan_rate_periods',
    'loan_prepayments',
    'retirement_goals',
    'import_logs',
    'account_balance_history',
    'accounts',
    'categories',
    'api_tokens',
    'settings',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'today@example.com', 'password', 1, 'advanced')"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Food', 'expense', '#F97316')"
    ).bind(FOOD, PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ).bind(GIRO, PROFILE),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Stop the clock at `instant` and sign in at it. */
async function at(instant: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
}

function call(
  method: string,
  path: string,
  options: { zone?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-Profile-Id': String(PROFILE),
  };
  if (options.zone !== undefined) headers['X-Time-Zone'] = options.zone;
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function json<T>(method: string, path: string, zone?: string, body?: unknown): Promise<T> {
  const res = await call(method, path, { zone, body });
  expect(res.status, `${method} ${path} (${zone ?? 'no zone'})`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function expense(date: string, amount: number, description = 'groceries'): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, ?, ?, ?, 'EUR', 'expense', ?, ?)"
  )
    .bind(PROFILE, description, amount, amount, date, FOOD)
    .run();
}

async function bill(name: string, dueDate: string, extra: Record<string, unknown> = {}) {
  const fields = { name, amount: 40, frequency: 'monthly', due_date: dueDate, ...extra };
  const cols = Object.keys(fields);
  const res = await env.DB.prepare(
    `INSERT INTO bills (profile_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
  )
    .bind(PROFILE, ...Object.values(fields))
    .run();
  return res.meta.last_row_id as number;
}

async function storedDates(): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT date FROM transactions WHERE profile_id = ? ORDER BY id'
  )
    .bind(PROFILE)
    .all<{ date: string }>();
  return rows.results.map((r) => r.date);
}

describe('the X-Time-Zone header', () => {
  it('is allowed by the CORS preflight from the app origin', async () => {
    const res = await SELF.fetch('https://example.com/api/stats/monthly', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3800',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-profile-id, x-time-zone',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3800');
    const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((h) => h.trim());
    expect(allowed).toContain('x-time-zone');
  });

  it('costs one preflight per two hours, not one per request', async () => {
    // A GET that sent only a cookie was a simple request; with X-Time-Zone the browser asks first.
    // 7200 seconds is the most Chromium will cache an answer for.
    const res = await SELF.fetch('https://example.com/api/billing/status', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3800',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-time-zone',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Max-Age')).toBe('7200');
  });

  it('sets the calendar a request is answered on', async () => {
    await at(LATE_ON_THE_7TH);
    for (const zone of [TOKYO, KIRITIMATI, undefined]) {
      await json('POST', '/api/transactions', zone, {
        description: `undated ${zone ?? 'no zone'}`,
        amount: 5,
        type: 'expense',
      });
    }
    expect(await storedDates()).toEqual(['2026-10-08', '2026-10-08', '2026-10-07']);
  });

  it('is ignored, leaving the UTC calendar, when it is not a zone this runtime knows', async () => {
    await at(LATE_ON_THE_7TH);
    // '+09:00' is a valid Intl time zone in newer engines, but an offset has no daylight-saving
    // rules: it would be right for half the year in a zone that has them, so it is refused.
    for (const zone of ['Mars/Olympus_Mons', '+09:00', 'GMT+9', 'Asia/Tokyo; x', '', ' ']) {
      await json('POST', '/api/transactions', zone, {
        description: `undated ${zone}`,
        amount: 5,
        type: 'expense',
      });
    }
    expect(new Set(await storedDates())).toEqual(new Set(['2026-10-07']));
  });
});

describe('Monthly Income and Expense count what was entered today (/api/stats/monthly)', () => {
  type Month = { month: string; income: number; expense: number };
  const october = (rows: Month[]) => rows.find((r) => r.month === '2026-10')?.expense ?? 0;

  it('east of UTC, after local midnight: today is already the 8th', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2026-10-01', 100);
    await expense('2026-10-08', 75, 'entered at 08:30 on the 8th');
    for (const zone of [TOKYO, KIRITIMATI]) {
      expect(october(await json<Month[]>('GET', '/api/stats/monthly?months=24', zone))).toBe(175);
    }
  });

  it('west of UTC, in the evening: the 8th is still tomorrow', async () => {
    await at(EARLY_ON_THE_8TH);
    await expense('2026-10-07', 100, 'entered at 20:00 on the 7th');
    await expense('2026-10-08', 75, 'dated tomorrow');
    expect(october(await json<Month[]>('GET', '/api/stats/monthly', LOS_ANGELES))).toBe(100);
  });

  it('without a zone, the range ends on the UTC date, as it did before the header', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2026-10-08', 75);
    await expense('2026-10-07', 100);
    expect(october(await json<Month[]>('GET', '/api/stats/monthly'))).toBe(100);
  });

  it('a new month starts at local midnight on the 1st', async () => {
    await at(LAST_OF_OCTOBER);
    await expense('2026-11-01', 30);
    const rows = await json<Month[]>('GET', '/api/stats/monthly?months=2', TOKYO);
    expect(rows.find((r) => r.month === '2026-11')?.expense).toBe(30);
  });
});

describe('writes that stamp today stamp the person’s date', () => {
  it('marks a bill paid on the local date', async () => {
    await at(LATE_ON_THE_7TH);
    const id = await bill('Water', '2026-10-08', { account_id: GIRO });
    await json('POST', `/api/bills/${id}/mark-paid`, TOKYO);
    expect(await storedDates()).toEqual(['2026-10-08']);
    const stored = await env.DB.prepare('SELECT last_paid_date FROM bills WHERE id = ?')
      .bind(id)
      .first<{ last_paid_date: string }>();
    expect(stored?.last_paid_date).toBe('2026-10-08');
  });

  it('adds a recurring payment that falls due today, rather than calling it done', async () => {
    await at(LATE_ON_THE_7TH);
    const res = await env.DB.prepare(
      "INSERT INTO recurring_transactions (profile_id, description, amount, type, frequency, next_date, account_id) VALUES (?, 'Rent', 500, 'expense', 'monthly', '2026-10-08', ?)"
    )
      .bind(PROFILE, GIRO)
      .run();
    const populated = await call('POST', `/api/recurring/${res.meta.last_row_id}/populate`, {
      zone: TOKYO,
    });
    expect(populated.status).toBe(200);
    expect(await storedDates()).toEqual(['2026-10-08']);
  });

  it('starts a goal’s category tracking today', async () => {
    await at(LATE_ON_THE_7TH);
    const { id } = await json<{ id: number }>('POST', '/api/savings-goals', TOKYO, {
      name: 'Car',
      target_amount: 1000,
      category_id: FOOD,
    });
    const goal = await env.DB.prepare('SELECT tracking_start_date FROM savings_goals WHERE id = ?')
      .bind(id)
      .first<{ tracking_start_date: string }>();
    expect(goal?.tracking_start_date).toBe('2026-10-08');
  });

  it('dates an imported row that has no date with today', async () => {
    await at(LATE_ON_THE_7TH);
    await json('POST', '/api/import/execute', TOKYO, {
      rows: [{ date: '', description: 'Konzum', amount: '-12.50', category: 'Food' }],
      mapping: { date: 'date', description: 'description', amount: 'amount', category: 'category' },
      dry_run: false,
    });
    expect(await storedDates()).toEqual(['2026-10-08']);
  });
});

describe('this month and this year are the person’s', () => {
  it('the Dashboard shows the month it is locally (/api/dashboard)', async () => {
    await at(LAST_OF_OCTOBER);
    await expense('2026-10-31', 100);
    await expense('2026-11-01', 40);
    const dash = await json<{ totalExpenses: number }>('GET', '/api/dashboard', TOKYO);
    expect(dash.totalExpenses).toBe(40);
  });

  it('the year summary is the local year (/api/dashboard/summary)', async () => {
    await at(NEW_YEARS_EVE);
    const summary = await json<{ month: number }>('GET', '/api/dashboard/summary', TOKYO);
    expect(summary.month).toBe(2027);
  });

  it('the cash-flow chart ends today (/api/dashboard/charts)', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2026-10-08', 75);
    const charts = await json<{ monthly: { month: string; expense: number }[] }>(
      'GET',
      '/api/dashboard/charts',
      TOKYO
    );
    expect(charts.monthly.find((m) => m.month === '2026-10')?.expense).toBe(75);
  });

  it('the year list starts at the local year (/api/analytics/distinct-years)', async () => {
    await at(NEW_YEARS_EVE);
    await expense('2026-12-31', 10);
    const { years } = await json<{ years: number[] }>(
      'GET',
      '/api/analytics/distinct-years',
      TOKYO
    );
    expect(years[0]).toBe(2027);
  });

  it('category trends default to the local year (/api/analytics/category-trends)', async () => {
    await at(NEW_YEARS_EVE);
    const { labels } = await json<{ labels: string[] }>(
      'GET',
      '/api/analytics/category-trends',
      TOKYO
    );
    expect(labels[0]).toBe('Jan 2027');
  });

  it('budget alerts default to the local month (/api/budgets/alerts)', async () => {
    await at(LAST_OF_OCTOBER);
    const alerts = await json<{ startDate: string; endDate: string }>(
      'GET',
      '/api/budgets/alerts',
      TOKYO
    );
    expect([alerts.startDate, alerts.endDate]).toEqual(['2026-11-01', '2026-12-01']);
  });

  it('a budget allocated without a month lands in the local one (/api/budgets/allocate)', async () => {
    await at(LAST_OF_OCTOBER);
    const made = await json<{ start_date: string }>('POST', '/api/budgets/allocate', TOKYO, {
      category_id: FOOD,
      amount: 300,
    });
    expect(made.start_date).toBe('2026-11-01');
  });

  it('the forecast starts the month after the local one (/api/budgets/forecast)', async () => {
    await at(LAST_OF_OCTOBER);
    // October's budget: the route keeps budgets whose start_date <= the month, as strings, and
    // '2026-11-01' sorts after '2026-11'.
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2026-10-01')"
    )
      .bind(PROFILE, FOOD)
      .run();
    const forecast = await json<{ period: string; forecast: { month: string }[] }>(
      'GET',
      '/api/budgets/forecast',
      TOKYO
    );
    expect(forecast.period).toBe('2026-11');
    expect(forecast.forecast[0]?.month).toBe('2026-12');

    // The history runs up to the local month, so November's budget is in it.
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2026-11-01')"
    )
      .bind(PROFILE, FOOD)
      .run();
    const ahead = await json<{ history: { month: string }[] }>(
      'GET',
      '/api/budgets/forecast?month=2026-12',
      TOKYO
    );
    expect(ahead.history.map((h) => h.month)).toEqual(['2026-11', '2026-10']);
  });

  it('the monthly PDF defaults to the local month (/api/reports/monthly-pdf)', async () => {
    await at(LAST_OF_OCTOBER);
    const res = await call('GET', '/api/reports/monthly-pdf', { zone: TOKYO });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('monthly-2026-11.pdf');
  });

  it('the retirement projection starts in the local month (/api/retirement/settings)', async () => {
    await at(LAST_OF_OCTOBER);
    const settings = await json<{ startMonth: string }>('GET', '/api/retirement/settings', TOKYO);
    expect(settings.startMonth).toBe('2026-11');
  });
});

describe('due, overdue and upcoming are measured from the person’s today', () => {
  it('a bill due on the 7th is overdue once the 8th has begun (/api/bills/calendar)', async () => {
    await at(LATE_ON_THE_7TH);
    await bill('Water', '2026-10-07');
    type Calendar = { days: Record<string, { is_overdue: boolean }[]> };
    const local = await json<Calendar>('GET', '/api/bills/calendar?year=2026&month=10', TOKYO);
    expect(local.days['7']?.[0]?.is_overdue).toBe(true);
    const utc = await json<Calendar>('GET', '/api/bills/calendar?year=2026&month=10');
    expect(utc.days['7']?.[0]?.is_overdue).toBe(false);
  });

  it('the calendar opens on the local month (/api/bills/calendar)', async () => {
    await at(LAST_OF_OCTOBER);
    const cal = await json<{ year: number; month: number }>('GET', '/api/bills/calendar', TOKYO);
    expect([cal.year, cal.month]).toEqual([2026, 11]);
  });

  it('the Dashboard’s upcoming bills start today (/api/dashboard)', async () => {
    await at(LATE_ON_THE_7TH);
    await bill('Water', '2026-10-07');
    await bill('Phone', '2026-10-08');
    const dash = await json<{ upcomingBills: { name: string }[] }>('GET', '/api/dashboard', TOKYO);
    expect(dash.upcomingBills.map((b) => b.name)).toEqual(['Phone']);
  });

  it('upcoming recurring payments start today (/api/recurring/upcoming)', async () => {
    await at(LATE_ON_THE_7TH);
    await env.DB.prepare(
      "INSERT INTO recurring_transactions (profile_id, description, amount, type, frequency, next_date) VALUES (?, 'Gym', 30, 'expense', 'weekly', '2026-10-07')"
    )
      .bind(PROFILE)
      .run();
    const upcoming = await json<{ transactions: { next_date: string }[] }>(
      'GET',
      '/api/recurring/upcoming',
      TOKYO
    );
    expect(upcoming.transactions[0]?.next_date).toBe('2026-10-08');
  });

  it('a loan payment due today counts as made (/api/loans)', async () => {
    await at(LATE_ON_THE_7TH);
    await env.DB.prepare(
      "INSERT INTO loans (profile_id, name, principal, interest_rate, start_date, term_months) VALUES (?, 'Car', 12000, 0, '2026-10-08', 12)"
    )
      .bind(PROFILE)
      .run();
    type Loan = { remaining_balance: number; next_payment_date: string };
    const [local] = await json<Loan[]>('GET', '/api/loans', TOKYO);
    expect([local?.remaining_balance, local?.next_payment_date]).toEqual([11000, '2026-11-08']);
    const [utc] = await json<Loan[]>('GET', '/api/loans');
    expect([utc?.remaining_balance, utc?.next_payment_date]).toEqual([12000, '2026-10-08']);
  });

  it('the emergency fund averages the twelve months up to today (/api/calculator/emergency-fund)', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2025-10-07', 100, 'a year and a day ago in Tokyo');
    await expense('2026-10-01', 300);
    const local = await json<{ avgMonthlyExpenses: number }>(
      'GET',
      '/api/calculator/emergency-fund',
      TOKYO
    );
    expect(local.avgMonthlyExpenses).toBe(300);
  });

  it('the retirement facts cover the twelve months up to today (/api/retirement/settings)', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2025-10-07', 100, 'a year and a day ago in Tokyo');
    await expense('2026-10-01', 300);
    const { facts } = await json<{ facts: { monthsObserved: number } }>(
      'GET',
      '/api/retirement/settings',
      TOKYO
    );
    expect(facts.monthsObserved).toBe(1);
  });
});

describe('the MCP tools answer on the caller’s calendar, and on UTC without one', () => {
  async function overview(zone?: string) {
    const { secret } = await mintApiToken(env.DB, USER, {
      name: 'today',
      scopes: ['read'],
      defaultProfileId: PROFILE,
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    };
    if (zone) headers['X-Time-Zone'] = zone;
    const res = await SELF.fetch('https://api.example.com/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_overview', arguments: {} },
      }),
    });
    const body = (await res.json()) as {
      result: {
        structuredContent: {
          monthKey: string;
          upcomingBills: { name: string; next_due_date: string }[];
        };
      };
    };
    return body.result.structuredContent;
  }

  it('get_overview: this month and the bills still to come', async () => {
    await at(LAST_OF_OCTOBER);
    await bill('Water', '2026-10-31');
    await bill('Phone', '2026-11-01');
    // On the Dashboard's rule (shared/billSchedule.ts). In Tokyo it is 1 November: Phone falls due
    // today, and Water, whose October date went unpaid, next on 30 November, the month's last day.
    const local = await overview(TOKYO);
    expect(local.monthKey).toBe('2026-11');
    expect(local.upcomingBills.map((b) => [b.name, b.next_due_date])).toEqual([
      ['Phone', '2026-11-01'],
      ['Water', '2026-11-30'],
    ]);
    const utc = await overview();
    expect(utc.monthKey).toBe('2026-10');
    expect(utc.upcomingBills.map((b) => [b.name, b.next_due_date])).toEqual([
      ['Water', '2026-10-31'],
      ['Phone', '2026-11-01'],
    ]);
  });
});

describe('the reminder preview reads the person’s calendar', () => {
  it('a spending report previewed after local midnight includes today', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2026-10-08', 75, 'entered at 08:30 on the 8th');
    const preview = await composeReminderPreview(env, USER, 'spending', wallClockIn(TOKYO));
    expect(preview, 'the report ended yesterday and found nothing to send').not.toBeNull();
    expect(preview!.html).toContain('75.00');
  });
});

/** The text a pdf-lib report draws, with its content streams inflated. */
async function pdfText(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const raw = new TextDecoder('latin1').decode(bytes);
  const parts: string[] = [];
  const marker = /stream\r?\n/g;
  for (let m = marker.exec(raw); m; m = marker.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    // The stream's data ends before the newline that precedes `endstream`.
    let stop = end;
    while (stop > start && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop--;
    const body = bytes.slice(start, stop);
    try {
      const inflated = new Response(
        new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'))
      );
      parts.push(new TextDecoder('latin1').decode(await inflated.arrayBuffer()));
    } catch {
      parts.push(new TextDecoder('latin1').decode(body));
    }
    marker.lastIndex = end;
  }
  const text: string[] = [];
  for (const chunk of parts) {
    for (const [, hex] of chunk.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      text.push(hex!.replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))));
    }
    for (const [, literal] of chunk.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) text.push(literal!);
  }
  return text.join('\n');
}

// Every route below read "today", "this month" or "this year" off the Worker's UTC clock before
// X-Time-Zone, and each case fails if its route goes back to doing that.
describe('more routes that answer on the person’s calendar', () => {
  it('the bill list calls a bill paid in October unpaid once November begins (/api/bills)', async () => {
    await at(LAST_OF_OCTOBER);
    await bill('Rent', '2026-11-01', { last_paid_date: '2026-10-15', day_of_month: 1 });
    const paid = async (zone?: string) =>
      (await json<{ paid: boolean }[]>('GET', '/api/bills', zone))[0]!.paid;
    expect(await paid(TOKYO)).toBe(false);
    expect(await paid()).toBe(true);
  });

  // Never paid, a weekly bill first due on the 1st falls due every seventh day from it: on the 8th
  // it is due today, and on the 7th the 1st's is still unpaid (shared/billSchedule.ts).
  it('a weekly bill never paid falls due on its own weekday (/api/bills/upcoming)', async () => {
    await at(LATE_ON_THE_7TH);
    await bill('Cleaner', '2026-10-01', { frequency: 'weekly' });
    const next = async (zone?: string) =>
      (await json<{ next_due_date: string }[]>('GET', '/api/bills/upcoming', zone))[0]!
        .next_due_date;
    expect(await next(TOKYO)).toBe('2026-10-08');
    expect(await next()).toBe('2026-10-01');
  });

  it('the budget summary defaults to the local month (/api/budgets/summary)', async () => {
    await at(LAST_OF_OCTOBER);
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2026-11-01')"
    )
      .bind(PROFILE, FOOD)
      .run();
    expect(await json<unknown[]>('GET', '/api/budgets/summary', TOKYO)).toHaveLength(1);
    expect(await json<unknown[]>('GET', '/api/budgets/summary')).toHaveLength(0);
  });

  it('zero-based budgeting opens on the local month (/api/budgets/zero-based)', async () => {
    await at(LAST_OF_OCTOBER);
    const plan = await json<{ period: string }>('GET', '/api/budgets/zero-based', TOKYO);
    expect(plan.period).toBe('2026-11');
    const summary = await json<{ period: string }>('GET', '/api/budgets/zero-based/summary', TOKYO);
    expect(summary.period).toBe('2026-11');
  });

  it('budgets from last month’s spending land in the local month (/api/budgets/from-expenses)', async () => {
    await at(LAST_OF_OCTOBER);
    await expense('2026-10-10', 50);
    const made = await json<{ ok: boolean }>('POST', '/api/budgets/from-expenses', TOKYO, {});
    expect(made.ok).toBe(true);
    const row = await env.DB.prepare('SELECT start_date FROM budgets WHERE profile_id = ?')
      .bind(PROFILE)
      .first<{ start_date: string }>();
    expect(row?.start_date).toBe('2026-11-01');
  });

  it('last month’s budgets are copied into the local month (/api/budgets/duplicate-last)', async () => {
    await at(LAST_OF_OCTOBER);
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2026-10-01')"
    )
      .bind(PROFILE, FOOD)
      .run();
    const made = await json<{ ok: boolean }>('POST', '/api/budgets/duplicate-last', TOKYO, {});
    expect(made.ok).toBe(true);
    const rows = await env.DB.prepare(
      'SELECT start_date FROM budgets WHERE profile_id = ? ORDER BY start_date'
    )
      .bind(PROFILE)
      .all<{ start_date: string }>();
    expect(rows.results.map((r) => r.start_date)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('Budget vs Actual for January is next year’s January on 1 January (/api/analytics/sankey)', async () => {
    await at(NEW_YEARS_EVE);
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2027-01-01')"
    )
      .bind(PROFILE, FOOD)
      .run();
    const sankey = (zone?: string) =>
      json<{ hasBudgets?: boolean }>('GET', '/api/analytics/sankey?month=1', zone);
    expect((await sankey(TOKYO)).hasBudgets).toBe(true);
    expect((await sankey()).hasBudgets).not.toBe(true);
  });

  it('the annual PDF defaults to the local year (/api/reports/annual-pdf)', async () => {
    await at(NEW_YEARS_EVE);
    const res = await call('GET', '/api/reports/annual-pdf', { zone: TOKYO });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('annual-2027.pdf');
  });

  it('every PDF report is dated with the local today', async () => {
    await at(LATE_ON_THE_7TH);
    for (const path of [
      '/api/reports/monthly-pdf',
      '/api/reports/tax-summary-pdf?year=2026',
      '/api/reports/pl-summary-pdf?year=2026',
      '/api/reports/annual-pdf',
    ]) {
      const res = await call('GET', path, { zone: TOKYO });
      expect(res.status, path).toBe(200);
      expect(await pdfText(res), path).toContain('Generated 2026-10-08');
    }
  });

  it('a test email is built on the local calendar (/api/notifications/test-email)', async () => {
    await at(LATE_ON_THE_7TH);
    await expense('2026-10-08', 75, 'entered at 08:30 on the 8th');
    // The spending report ends today; on UTC's calendar the only spending is tomorrow's.
    const local = await call('POST', '/api/notifications/test-email', {
      zone: TOKYO,
      body: { type: 'spending' },
    });
    expect(local.status).toBe(200);
    const utc = await call('POST', '/api/notifications/test-email', { body: { type: 'spending' } });
    expect(utc.status).toBe(400);
  });

  it('an account an /api/v1 upload creates opens on the uploader’s today (/api/v1/import)', async () => {
    await at(LATE_ON_THE_7TH);
    // The API token the capability names: the route reads it when the capability is used.
    await apiTokenRow('tok-today', USER);
    const upload = async (zone?: string) => {
      const sig = await signCapability(
        { tokenId: 'tok-today', userId: USER, profileId: PROFILE, purpose: 'import' },
        'test-jwt-secret-not-for-prod'
      );
      const form = new FormData();
      const csv = 'Date,Description,Amount,Means of Payment\n2026-10-01,Coffee,-3.50,Wallet\n';
      form.append('file', new File([csv], 'export.csv', { type: 'text/csv' }));
      const qs = new URLSearchParams({ sig, mode: 'commit', autoCreateAccounts: 'true' });
      return SELF.fetch(`https://api.example.com/api/v1/import?${qs}`, {
        method: 'POST',
        body: form,
        headers: zone ? { 'X-Time-Zone': zone } : {},
      });
    };
    expect((await upload(TOKYO)).status).toBe(200);
    const opened = await env.DB.prepare(
      "SELECT starting_date FROM accounts WHERE profile_id = ? AND name = 'Wallet'"
    )
      .bind(PROFILE)
      .first<{ starting_date: string }>();
    expect(opened?.starting_date).toBe('2026-10-08');
  });

  it('a saved retirement plan derives the birth month from the local month (PUT /api/retirement/settings)', async () => {
    await at(LAST_OF_OCTOBER);
    await env.DB.prepare(
      "INSERT INTO retirement_goals (profile_id, name, target_amount, current_age) VALUES (?, 'FIRE', 1000000, 40)"
    )
      .bind(PROFILE)
      .run();
    const saved = (zone?: string) =>
      json<{ settings: { birthMonth: string | null } }>(
        'PUT',
        '/api/retirement/settings',
        zone,
        {}
      );
    expect((await saved(TOKYO)).settings.birthMonth).toBe('1986-11');
    expect((await saved()).settings.birthMonth).toBe('1986-10');
  });

  it('the retirement projection starts in the local month (/api/retirement/projection)', async () => {
    await at(LAST_OF_OCTOBER);
    const { projection } = await json<{ projection: { rows: { month: string }[] } }>(
      'GET',
      '/api/retirement/projection',
      TOKYO
    );
    expect(projection.rows[0]?.month).toBe('2026-11');
  });
});

describe('the MCP budget tool answers on the caller’s calendar, and on UTC without one', () => {
  it('get_budgets_and_goals: this month', async () => {
    await at(LAST_OF_OCTOBER);
    const { secret } = await mintApiToken(env.DB, USER, {
      name: 'budgets',
      scopes: ['read'],
      defaultProfileId: PROFILE,
    });
    const month = async (zone?: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      };
      if (zone) headers['X-Time-Zone'] = zone;
      const res = await SELF.fetch('https://api.example.com/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_budgets_and_goals', arguments: {} },
        }),
      });
      const body = (await res.json()) as { result: { structuredContent: { month: string } } };
      return body.result.structuredContent.month;
    };
    expect(await month(TOKYO)).toBe('2026-11');
    expect(await month()).toBe('2026-10');
  });
});
