import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { addCalendarMonths, calculateLoan, loanStatus, todayUtc } from '../../shared/loanSchedule';
import type { LoanInput } from '../../shared/loanSchedule';
import { PARITY_LOAN } from '../../shared/fixtures/loanParity';

// The loan routes end to end in workerd against a real D1.
//
// The arithmetic is tested where it lives: frontend/src/core/__tests__/loanSchedule.test.ts checks
// shared/loanSchedule.ts against closed forms. What this checks is what the Worker adds around it:
// that the route hands the engine the loan as stored (base rate, rate periods, every extra
// payment) and returns the engine's answer unchanged, in the shape API clients already read. The
// local-first handler's test runs the same fixture loan, so the two runtimes give the same answer.

const USER = 91;
const ME = 910;
const PARTNER = 911;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (910, 911))'
    ),
    env.DB.prepare(
      'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (910, 911))'
    ),
    env.DB.prepare('DELETE FROM loans WHERE profile_id IN (910, 911)'),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = 91'),
    env.DB.prepare('DELETE FROM users WHERE id = 91'),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (91, 'loans@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (910, 91, 'Me')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (911, 91, 'Partner')"),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function api(method: string, path: string, body?: unknown, profile = ME): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(profile),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Store a loan the way the app does: the loan with its rate periods, then each extra payment. */
async function storeLoan(loan: LoanInput, profile = ME): Promise<number> {
  const { prepayments, ...rest } = loan;
  const res = await api('POST', '/api/loans', { name: 'Fixture loan', ...rest }, profile);
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: number };
  for (const p of prepayments ?? []) {
    expect((await api('POST', `/api/loans/${id}/prepayments`, p, profile)).status).toBe(200);
  }
  return id;
}

async function calculate(id: number, profile = ME): Promise<Response> {
  return api('POST', `/api/loans/${id}/calculate`, {}, profile);
}

describe('POST /api/loans/:id/calculate', () => {
  it('answers exactly what the shared engine computes from the stored loan', async () => {
    const id = await storeLoan(PARITY_LOAN);
    const res = await calculate(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(calculateLoan(PARITY_LOAN));
  });

  it('keeps the response shape API clients read', async () => {
    const id = await storeLoan(PARITY_LOAN);
    const body = (await (await calculate(id)).json()) as Record<string, any>;
    expect(Object.keys(body)).toEqual(['schedule', 'summary', 'comparison']);
    expect(Object.keys(body.schedule[0])).toEqual([
      'month',
      'date',
      'payment',
      'principal',
      'interest',
      'balance',
      'prepayment',
      'rate',
      'note',
    ]);
    const summaryKeys = [
      'totalPaid',
      'totalInterest',
      'interestSaved',
      'monthsSaved',
      'payoffDate',
      'totalPayments',
      'avgMonthlyPayment',
      'maxBalance',
      'originalTotalInterest',
      'originalTotalPayments',
    ];
    expect(Object.keys(body.summary)).toEqual(summaryKeys);
    expect(Object.keys(body.comparison)).toEqual(['withPrepayments', 'withoutPrepayments']);
    expect(Object.keys(body.comparison.withoutPrepayments)).toEqual(summaryKeys);
  });

  it('charges the base rate outside the rate period, adds up same-month extras, dates by calendar month', async () => {
    const id = await storeLoan(PARITY_LOAN);
    const { schedule } = (await (await calculate(id)).json()) as ReturnType<typeof calculateLoan>;
    // 4.5 % until month 12, the 6.25 % period for months 13-30, 4.5 % again from month 31.
    expect(schedule[11].rate).toBe(4.5);
    expect(schedule[12].rate).toBe(6.25);
    expect(schedule[29].rate).toBe(6.25);
    expect(schedule[30].rate).toBe(4.5);
    // 1,500 + 500 in month 6, with both notes.
    expect(schedule[5].prepayment).toBe(2000);
    expect(schedule[5].note).toBe('bonus; gift');
    // Started on 31 January 2025.
    expect(schedule.slice(0, 3).map((r) => r.date)).toEqual([
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
    ]);
  });

  it('pays what is owed in the last month, so totalPaid is principal plus interest', async () => {
    // 100,000 at 5 % over 120 months with 10,000 extra in month 12: 106 months, the last one
    // 673.51, totalPaid 122,042.30 (the old route charged a full 1,060.66 there: 122,429.45).
    const id = await storeLoan({
      principal: 100000,
      interest_rate: 5,
      start_date: '2026-01-01',
      term_months: 120,
      rate_periods: [],
      prepayments: [{ month: 12, amount: 10000 }],
    });
    const { schedule, summary } = (await (await calculate(id)).json()) as ReturnType<
      typeof calculateLoan
    >;
    expect(schedule).toHaveLength(106);
    expect(schedule[105].payment).toBeCloseTo(673.51, 2);
    expect(summary.totalPaid).toBeCloseTo(summary.totalInterest + 100000, 6);
    expect(summary.totalPaid).toBeCloseTo(122042.3, 2);
    expect(summary.monthsSaved).toBe(14);
  });

  it('recomputes the installment at a rate change, and nothing is owed at the end', async () => {
    // 5 % to 8 % from month 13: 1,198.93 from then on, ending at month 120. The old route kept
    // 1,060.66 and stopped at month 120 with 21,768.04 still owed.
    const id = await storeLoan({
      principal: 100000,
      interest_rate: 5,
      start_date: '2026-01-01',
      term_months: 120,
      rate_periods: [{ rate: 8, start_month: 13 }],
    });
    const { schedule, summary } = (await (await calculate(id)).json()) as ReturnType<
      typeof calculateLoan
    >;
    expect(schedule).toHaveLength(120);
    expect(schedule[12].payment).toBeCloseTo(1198.93, 2);
    expect(schedule[119].balance).toBe(0);
    expect(summary.payoffDate).toBe('2035-12-01');
  });

  it("does not calculate another profile's loan", async () => {
    const id = await storeLoan(PARITY_LOAN, PARTNER);
    expect((await calculate(id, ME)).status).toBe(404);
    expect((await calculate(id, PARTNER)).status).toBe(200);
  });
});

describe('GET /api/loans', () => {
  type Listed = Record<string, unknown> & {
    id: number;
    remaining_balance: number;
    monthly_payment: number;
    next_payment_date: string | null;
    payoff_date: string | null;
  };

  async function list(profile = ME): Promise<Listed[]> {
    const res = await api('GET', '/api/loans', undefined, profile);
    expect(res.status).toBe(200);
    return (await res.json()) as Listed[];
  }

  it('adds where each loan stands today, from the shared engine', async () => {
    // 100,000 at 5 % over 120 months whose 60th payment fell due today: owed is the balance after
    // 60 installments, B_60 = P (1+r)^60 - A ((1+r)^60 - 1) / r = 56,204.87. The Loans page used to
    // subtract 60 whole installments from the principal instead, and showed 36,360.69.
    const today = todayUtc();
    const start = addCalendarMonths(today, -59);
    const r = 0.05 / 12;
    const A = (100000 * r * (1 + r) ** 120) / ((1 + r) ** 120 - 1);
    const B60 = 100000 * (1 + r) ** 60 - (A * ((1 + r) ** 60 - 1)) / r;
    const plain = await storeLoan({
      principal: 100000,
      interest_rate: 5,
      start_date: start,
      term_months: 120,
      rate_periods: [],
    });
    const busy = await storeLoan({ ...PARITY_LOAN, start_date: addCalendarMonths(today, -20) });

    const rows = await list();
    const row = rows.find((l) => l.id === plain)!;
    expect(row.remaining_balance).toBeCloseTo(B60, 6);
    expect(row.remaining_balance).toBeCloseTo(56204.87, 2);
    expect(row.monthly_payment).toBeCloseTo(A, 6);
    expect(row.next_payment_date).toBe(addCalendarMonths(start, 60));
    expect(row.payoff_date).toBe(addCalendarMonths(start, 119));

    // The loan with a rate period and extra payments gets its own, not another loan's.
    const other = rows.find((l) => l.id === busy)!;
    const expected = loanStatus(
      { ...PARITY_LOAN, start_date: addCalendarMonths(today, -20) },
      today
    );
    expect(other.remaining_balance).toBe(expected.remaining_balance);
    expect(other.monthly_payment).toBe(expected.monthly_payment);
    expect(other.next_payment_date).toBe(expected.next_payment_date);
    expect(other.payoff_date).toBe(expected.payoff_date);
  });

  it('keeps every field the list already had, and adds four', async () => {
    await storeLoan(PARITY_LOAN);
    const [row] = await list();
    expect(Object.keys(row)).toEqual([
      'id',
      'name',
      'principal',
      'interest_rate',
      'start_date',
      'term_months',
      'created_at',
      'profile_id',
      'total_prepaid',
      'prepayment_count',
      'remaining_balance',
      'monthly_payment',
      'next_payment_date',
      'payoff_date',
    ]);
    expect(row.total_prepaid).toBe(5000);
    expect(row.prepayment_count).toBe(3);
  });

  it('owes nothing and pays nothing on a loan already paid off', async () => {
    await storeLoan({ ...PARITY_LOAN, start_date: '2010-01-31' });
    const [row] = await list();
    expect(row.remaining_balance).toBe(0);
    expect(row.monthly_payment).toBe(0);
    expect(row.next_payment_date).toBeNull();
    expect(row.payoff_date).toBe(
      calculateLoan({ ...PARITY_LOAN, start_date: '2010-01-31' }).summary.payoffDate
    );
  });

  it("lists only the active profile's loans", async () => {
    const mine = await storeLoan(PARITY_LOAN, ME);
    const theirs = await storeLoan(PARITY_LOAN, PARTNER);
    expect((await list(ME)).map((l) => l.id)).toEqual([mine]);
    expect((await list(PARTNER)).map((l) => l.id)).toEqual([theirs]);
  });
});

describe('the calculators that share the annuity formula', () => {
  // 100,000 at 5 % over 120 months: A = P r (1+r)^n / ((1+r)^n - 1) = 1,060.66, 127,278.62 in all.
  const r = 0.05 / 12;
  const A = (100000 * r * (1 + r) ** 120) / ((1 + r) ** 120 - 1);

  it('GET /api/calculators/loans', async () => {
    const res = await api('GET', '/api/calculators/loans?principal=100000&rate=5&term=120');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body.monthlyPayment).toBe(Math.round(A * 100) / 100);
    expect(body.totalPayment).toBe(Math.round(A * 120 * 100) / 100);
    expect(body.totalInterest).toBe(Math.round((A * 120 - 100000) * 100) / 100);
  });

  it('GET /api/calculators/loans/amortization', async () => {
    const res = await api(
      'GET',
      '/api/calculators/loans/amortization?principal=100000&rate=5&term=120'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { monthlyPayment: number; schedule: { balance: number }[] };
    expect(body.monthlyPayment).toBe(1060.66);
    expect(body.schedule).toHaveLength(120);
    expect(body.schedule[119].balance).toBe(0);
  });

  it('GET /api/calculators/mortgages', async () => {
    const res = await api(
      'GET',
      '/api/calculators/mortgages?principal=100000&rate=5&term=120&downPaymentPercent=20'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    // 80,000 financed: 0.8 A.
    expect(body.principalAndInterest).toBe(Math.round(0.8 * A * 100) / 100);
  });
});
