import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { LOAN_MESSAGES as M } from '../../shared/loanSchema';

// A loan's extra payments, added and changed through the Worker against a real D1. Both routes put
// the body through shared/loanSchema.ts, as the local-first handlers do
// (frontend/src/core/storage/__tests__/localHandlers.loans.test.ts), so the two runtimes accept
// and refuse the same bodies. The rules themselves: frontend/src/core/__tests__/loanSchema.test.ts;
// what a refusal says at each field: loan-refusals.test.ts.

const USER = 93;
const ME = 930;
const PARTNER = 931;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (930, 931))'
    ),
    env.DB.prepare('DELETE FROM loans WHERE profile_id IN (930, 931)'),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = 93'),
    env.DB.prepare('DELETE FROM users WHERE id = 93'),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (93, 'extras@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (930, 93, 'Me')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (931, 93, 'Partner')"),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
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

/** A 20,000 loan over 60 months, with one extra payment of 500 with payment 3. */
async function loanWithExtra(profile = ME): Promise<{ loan: number; extra: number }> {
  const created = await api(
    'POST',
    '/api/loans',
    {
      name: 'Car',
      principal: 20000,
      interest_rate: 5,
      term_months: 60,
      start_date: '2026-01-01',
    },
    profile
  );
  expect(created.status).toBe(200);
  const loan = ((await created.json()) as { id: number }).id;
  const added = await api(
    'POST',
    `/api/loans/${loan}/prepayments`,
    { month: 3, amount: 500, note: 'Gift' },
    profile
  );
  expect(added.status).toBe(200);
  return { loan, extra: ((await added.json()) as { id: number }).id };
}

async function stored(extra: number) {
  return env.DB.prepare('SELECT month, amount, note FROM loan_prepayments WHERE id = ?')
    .bind(extra)
    .first();
}

describe('PUT /api/loans/:id/prepayments/:prepayId', () => {
  it('changes the month, the amount and the note of the extra payment', async () => {
    const { loan, extra } = await loanWithExtra();
    const res = await api('PUT', `/api/loans/${loan}/prepayments/${extra}`, {
      month: 12,
      amount: 2500.45,
      note: '  Bonus ',
    });
    expect(res.status).toBe(200);
    expect(await stored(extra)).toEqual({ month: 12, amount: 2500.45, note: 'Bonus' });
  });

  it('refuses a change it would refuse in a new extra payment, and changes nothing', async () => {
    const { loan, extra } = await loanWithExtra();
    const zero = await api('PUT', `/api/loans/${loan}/prepayments/${extra}`, {
      month: 3,
      amount: 0,
    });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toEqual({
      error: M.amountPositive,
      fields: { amount: M.amountPositive },
    });
    // The loan has 60 payments.
    const late = await api('PUT', `/api/loans/${loan}/prepayments/${extra}`, {
      month: 61,
      amount: 10,
    });
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual({ error: M.extraMonth, fields: { month: M.extraMonth } });
    expect(await stored(extra)).toEqual({ month: 3, amount: 500, note: 'Gift' });
  });

  it('answers 404 for an extra payment that is not on the loan', async () => {
    const { loan, extra } = await loanWithExtra();
    const other = await loanWithExtra();
    const res = await api('PUT', `/api/loans/${loan}/prepayments/${other.extra}`, {
      month: 4,
      amount: 10,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Extra payment not found' });
    expect(await stored(other.extra)).toEqual({ month: 3, amount: 500, note: 'Gift' });
    expect(await stored(extra)).toEqual({ month: 3, amount: 500, note: 'Gift' });
  });

  it("answers 404 for another profile's loan, and leaves its extra payment alone", async () => {
    const partners = await loanWithExtra(PARTNER);
    const res = await api('PUT', `/api/loans/${partners.loan}/prepayments/${partners.extra}`, {
      month: 4,
      amount: 10,
    });
    expect(res.status).toBe(404);
    expect(await stored(partners.extra)).toEqual({ month: 3, amount: 500, note: 'Gift' });
  });
});

describe('POST /api/loans/:id/prepayments', () => {
  it('stores the extra payment as checked: numbers read, the note trimmed, no other fields', async () => {
    const { loan } = await loanWithExtra();
    const res = await api('POST', `/api/loans/${loan}/prepayments`, {
      month: '2',
      amount: '99.99',
      note: ' x ',
      loan_id: 1,
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toEqual({ month: 2, amount: 99.99, note: 'x' });
    const row = await env.DB.prepare('SELECT loan_id FROM loan_prepayments WHERE id = ?')
      .bind(id)
      .first<{ loan_id: number }>();
    expect(row?.loan_id).toBe(loan);
  });

  it('refuses an amount at or below zero, and a month outside the term', async () => {
    const { loan } = await loanWithExtra();
    for (const body of [
      { month: 2, amount: -1 },
      { month: 2, amount: 'lots' },
      { month: 0, amount: 10 },
      { month: 61, amount: 10 },
    ]) {
      const res = await api('POST', `/api/loans/${loan}/prepayments`, body);
      expect(res.status).toBe(400);
    }
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM loan_prepayments WHERE loan_id = ?'
    )
      .bind(loan)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe('GET /api/loans', () => {
  // The list summed a loan's extra payments in SQL: null for a loan without any, where local-first
  // answered 0 (the contract's loan-total-prepaid-none). Both runtimes now total them to the cent
  // (shared/loanSchema.ts, extraPaymentTotals).
  it("totals a loan's extra payments to the cent, and 0 for a loan without any", async () => {
    const bike = { name: 'Bike', principal: 1000, interest_rate: 0, term_months: 10 };
    const ids: number[] = [];
    for (const name of ['Bike', 'Boat']) {
      const res = await api('POST', '/api/loans', { ...bike, name, start_date: '2026-01-01' });
      ids.push(((await res.json()) as { id: number }).id);
    }
    const [some, none] = ids;
    for (const amount of [0.1, 0.2]) {
      const res = await api('POST', `/api/loans/${some}/prepayments`, { month: 4, amount });
      expect(res.status).toBe(200);
    }
    const listed = (await (await api('GET', '/api/loans')).json()) as Record<string, unknown>[];
    expect(listed.find((l) => l.id === some)).toMatchObject({
      total_prepaid: 0.3,
      prepayment_count: 2,
    });
    expect(listed.find((l) => l.id === none)).toMatchObject({
      total_prepaid: 0,
      prepayment_count: 0,
    });
  });
});
