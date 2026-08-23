import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { projectRetirement } from '../../shared/retirement';
import { normalizeSettings, settingsToInput } from '../../shared/retirementSettings';

// The projection endpoints, end to end in workerd against a real D1.
//
// The arithmetic itself is covered where it lives (shared/retirement.ts); what these check
// is everything the Worker adds around it: that the settings row survives a round trip,
// that assumptions the user has not made get filled from their own accounts and
// transactions, and that the numbers the endpoint returns are the ones the shared model
// produces from those settings -- which is the property that makes the page's own local
// projection and the server's the same answer rather than two guesses.

let cookie = '';

const USER = 80;
const ME = 800;
const PARTNER = 801;

/** Twelve months of income and spending ending last month, so the window always covers it. */
function recentMonths(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 1; i <= count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    months.push(d.toISOString().split('T')[0]);
  }
  return months;
}

beforeEach(async () => {
  for (const t of [
    'settings',
    'transactions',
    'accounts',
    'retirement_goals',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (80, 'retire@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (800, 80, 'Me')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (801, 80, 'Partner')"),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

async function seedAccounts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (800, 'Broker', 'investment', 'EUR', 50000)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (800, 'Current', 'checking', 'EUR', 16931.42)"
    ),
  ]);
}

async function seedCashflow(months = 12): Promise<void> {
  const stmts = recentMonths(months).flatMap((date) => [
    env.DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, date) VALUES (800, 'salary', 3600, 'income', '${date}')`
    ),
    env.DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, date) VALUES (800, 'living', 2400, 'expense', '${date}')`
    ),
  ]);
  await env.DB.batch(stmts);
}

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: { Cookie: cookie, ...headers } });
}

function put(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/retirement/settings', () => {
  it('requires a session', async () => {
    const res = await SELF.fetch('https://example.com/api/retirement/settings');
    expect(res.status).toBe(401);
  });

  it('answers with defaults for a profile that has nothing yet', async () => {
    const res = await get('/api/retirement/settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.settings.mode).toBe('simple');
    expect(body.settings.netWorth).toBe(0);
    expect(body.missing).toContain('netWorth');
    expect(body.startMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it('fills the opening balance from the account total', async () => {
    await seedAccounts();
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.netWorth).toBeCloseTo(66931.42, 2);
    expect(body.filled.map((f: any) => f.field)).toContain('netWorth');
  });

  it('fills income and spending from the transaction history', async () => {
    await seedAccounts();
    await seedCashflow();
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.facts.monthsObserved).toBeGreaterThanOrEqual(11);
    expect(body.settings.monthlyIncome).toBeCloseTo(3600, 2);
    expect(body.settings.monthlyExpenses).toBeCloseTo(2400, 2);
    expect(body.settings.monthlyContribution).toBeCloseTo(1200, 2);
  });

  it('will not average a history too short to mean anything', async () => {
    await seedCashflow(2);
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.monthlyIncome).toBe(0);
    expect(body.missing).toContain('monthlyIncome');
  });

  it('ignores transactions older than the window', async () => {
    await env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date) VALUES (800, 'ancient', 99999, 'income', '2015-01-15')"
    ).run();
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.facts.monthsObserved).toBe(0);
  });

  it('turns an age on an existing goal into a birth month', async () => {
    await env.DB.prepare(
      "INSERT INTO retirement_goals (profile_id, name, target_amount, current_age, retirement_age) VALUES (800, 'FIRE', 1000000, 32, 55)"
    ).run();
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.birthMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(body.filled.map((f: any) => f.field)).toContain('birthMonth');
  });

  it('counts every profile in the household, as the rest of the app does', async () => {
    await seedAccounts();
    await env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (801, 'Partner savings', 'savings', 'EUR', 10000)"
    ).run();
    // Household selection is opt-in via X-Profile-Ids, exactly as the rest of the app does it.
    const alone = (await (await get('/api/retirement/settings')).json()) as any;
    expect(alone.settings.netWorth).toBeCloseTo(66931.42, 2);

    const both = (await (
      await get('/api/retirement/settings', { 'X-Profile-Ids': JSON.stringify([ME, PARTNER]) })
    ).json()) as any;
    expect(both.settings.netWorth).toBeCloseTo(76931.42, 2);
  });
});

describe('PUT /api/retirement/settings', () => {
  it('round-trips what it was given', async () => {
    const saved = {
      mode: 'advanced',
      netWorth: 66931.42,
      monthlyIncome: 3566.06,
      monthlyExpenses: 4229.16,
      annualReturnPct: 5.78,
      annualInflationPct: 3.5,
      annualRaisePct: 3.5,
      safeWithdrawalRatePct: 3.5,
      incomeSteps: [{ fromMonth: '2027-01', monthlyAmount: 5000 }],
      lifestyles: [{ id: 'zg', label: 'Zagreb', monthlySpendToday: 2000 }],
    };
    const put1 = await put('/api/retirement/settings', saved);
    expect(put1.status).toBe(200);

    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.mode).toBe('advanced');
    expect(body.settings.annualReturnPct).toBeCloseTo(5.78, 6);
    expect(body.settings.incomeSteps).toEqual([{ fromMonth: '2027-01', monthlyAmount: 5000 }]);
    expect(body.settings.lifestyles).toEqual([
      { id: 'zg', label: 'Zagreb', monthlySpendToday: 2000 },
    ]);
  });

  it('stores a normalised blob, so a bad value cannot reach the model later', async () => {
    await put('/api/retirement/settings', {
      annualReturnPct: 9000,
      safeWithdrawalRatePct: 0,
      lifestyles: [],
      incomeSteps: [{ fromMonth: 'whenever', monthlyAmount: 1 }],
    });
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'retirement_settings' AND profile_id = 800"
    ).first<{ value: string }>();
    const stored = JSON.parse(row!.value);
    expect(stored.annualReturnPct).toBe(50);
    expect(stored.safeWithdrawalRatePct).toBe(0.1);
    expect(stored.lifestyles.length).toBeGreaterThan(0);
    expect(stored.incomeSteps).toEqual([]);
  });

  it('overwrites rather than accumulating rows', async () => {
    await put('/api/retirement/settings', { netWorth: 1000 });
    await put('/api/retirement/settings', { netWorth: 2000 });
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM settings WHERE key = 'retirement_settings' AND profile_id = 800"
    ).first<{ n: number }>();
    expect(rows!.n).toBe(1);
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.netWorth).toBe(2000);
  });

  it('leaves a saved value alone instead of deriving over it', async () => {
    await seedAccounts();
    await put('/api/retirement/settings', { netWorth: 12345 });
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.netWorth).toBe(12345);
    expect(body.filled.map((f: any) => f.field)).not.toContain('netWorth');
  });

  it('survives a settings row that is not JSON', async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('retirement_settings', 'not json', 800)"
    ).run();
    const res = await get('/api/retirement/settings');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).settings.mode).toBe('simple');
  });

  // Derivation used to read "the user has not set this" off the value, so saving any
  // figure that matched a default was indistinguishable from never having saved. The
  // reported symptom was a contribution of exactly 500 reverting to a derived 7.29 on the
  // next load; these pin the round trip at the level the user actually experiences it.
  it('keeps a contribution saved at exactly the default value', async () => {
    await seedAccounts();
    await seedCashflow();
    await put('/api/retirement/settings', { ...normalizeSettings({}), monthlyContribution: 500 });
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.monthlyContribution).toBe(500);
    expect(body.filled.map((f: any) => f.field)).not.toContain('monthlyContribution');
  });

  it('keeps a net worth the user deliberately saved as zero', async () => {
    await seedAccounts();
    await put('/api/retirement/settings', { ...normalizeSettings({}), netWorth: 0 });
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.netWorth).toBe(0);
    expect(body.filled.map((f: any) => f.field)).not.toContain('netWorth');
  });

  it('keeps a saved plan stable across repeated loads', async () => {
    await seedAccounts();
    await seedCashflow();
    const saved = { ...normalizeSettings({}), monthlyContribution: 500, netWorth: 0 };
    await put('/api/retirement/settings', saved);
    const first = (await (await get('/api/retirement/settings')).json()) as any;
    const second = (await (await get('/api/retirement/settings')).json()) as any;
    expect(second.settings).toEqual(first.settings);
    expect(second.settings.monthlyContribution).toBe(500);
  });

  it('reports on save that nothing is derived any more', async () => {
    await seedAccounts();
    await seedCashflow();
    // Before saving, the account total and the cashflow fill several fields.
    const before = (await (await get('/api/retirement/settings')).json()) as any;
    expect(before.filled.length).toBeGreaterThan(0);

    const res = await put('/api/retirement/settings', {
      ...normalizeSettings({}),
      monthlyContribution: 500,
    });
    const body = (await res.json()) as any;
    // The client shows "filled in from your data" from this response, so it has to say
    // what is still derived rather than repeating what the last load said.
    expect(body.filled).toEqual([]);
    expect(body.settings.monthlyContribution).toBe(500);
  });

  it('still fills a field the save left out', async () => {
    await seedAccounts();
    // birthMonth is sent as null when there is none, which stays "no answer".
    await put('/api/retirement/settings', { ...normalizeSettings({}), birthMonth: null });
    await env.DB.prepare(
      "INSERT INTO retirement_goals (profile_id, name, target_amount, current_age, retirement_age) VALUES (800, 'FIRE', 1000000, 32, 55)"
    ).run();
    const body = (await (await get('/api/retirement/settings')).json()) as any;
    expect(body.settings.birthMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(body.filled.map((f: any) => f.field)).toContain('birthMonth');
  });
});

describe('GET /api/retirement/projection', () => {
  it('requires a session', async () => {
    const res = await SELF.fetch('https://example.com/api/retirement/projection');
    expect(res.status).toBe(401);
  });

  it('returns exactly what the shared model produces from the settings it reports', async () => {
    await put('/api/retirement/settings', {
      mode: 'advanced',
      netWorth: 50000,
      monthlyIncome: 4000,
      monthlyExpenses: 2500,
      annualReturnPct: 7,
      annualInflationPct: 3,
      safeWithdrawalRatePct: 4,
      lifestyles: [{ id: 'zg', label: 'Zagreb', monthlySpendToday: 1800 }],
    });
    const body = (await (await get('/api/retirement/projection')).json()) as any;

    const expected = projectRetirement(
      settingsToInput(normalizeSettings(body.settings), body.projection.rows[0].month)
    );
    expect(body.projection.rows).toHaveLength(expected.rows.length);
    expect(body.projection.finalNetWorth).toBeCloseTo(expected.finalNetWorth, 6);
    expect(body.projection.lifestyles[0].targetToday).toBeCloseTo(
      expected.lifestyles[0].targetToday,
      6
    );
    expect(body.projection.lifestyles[0].crossing?.index).toBe(
      expected.lifestyles[0].crossing?.index
    );
  });

  it('compounds, rather than accruing interest that never earns anything', async () => {
    // A lump sum and no contributions: the answer is closed-form, so this fails loudly if
    // the endpoint ever goes back to accumulating gains in a bucket outside the balance.
    await put('/api/retirement/settings', {
      mode: 'simple',
      netWorth: 100000,
      monthlyContribution: 0,
      annualReturnPct: 7,
      annualInflationPct: 0,
      lifeExpectancyAge: 90,
      birthMonth: '1996-01',
    });
    const body = (await (await get('/api/retirement/projection')).json()) as any;
    const row = body.projection.rows.find((r: any) => r.index === 360);
    expect(row.netWorth).toBeCloseTo(100000 * Math.pow(1.07, 30), 2);
  });

  it('reports a crossing once the portfolio can fund the lifestyle', async () => {
    await put('/api/retirement/settings', {
      mode: 'simple',
      netWorth: 400000,
      monthlyContribution: 2000,
      annualReturnPct: 7,
      annualInflationPct: 2,
      safeWithdrawalRatePct: 4,
      lifestyles: [
        { id: 'lean', label: 'Lean', monthlySpendToday: 1500 },
        { id: 'rich', label: 'Rich', monthlySpendToday: 3000 },
      ],
    });
    const body = (await (await get('/api/retirement/projection')).json()) as any;
    const [lean, rich] = body.projection.lifestyles;
    expect(lean.crossing).not.toBeNull();
    expect(lean.targetToday).toBeCloseTo(1500 * 12 * 25, 2);
    expect(rich.targetToday).toBeCloseTo(3000 * 12 * 25, 2);
    expect(lean.crossing.index).toBeLessThan(rich.crossing.index);
  });

  it('stops distinguishing real from nominal when inflation is switched off', async () => {
    await put('/api/retirement/settings', {
      netWorth: 100000,
      monthlyContribution: 0,
      annualReturnPct: 6,
      annualInflationPct: 3,
      adjustForInflation: false,
    });
    const body = (await (await get('/api/retirement/projection')).json()) as any;
    const row = body.projection.rows[120];
    expect(row.netWorthReal).toBeCloseTo(row.netWorth, 6);
    // The rate is still saved, so switching the toggle back on restores the assumption.
    expect(body.settings.annualInflationPct).toBe(3);
  });
});
