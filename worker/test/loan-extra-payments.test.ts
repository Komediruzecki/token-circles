import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// A loan's extra payments, added and changed through the Worker against a real D1. Both routes put
// the body through shared/loanExtraPayment.ts, as the local-first handlers do
// (frontend/src/core/storage/__tests__/localHandlers.loans.test.ts), so the two runtimes accept
// and refuse the same bodies. The rules themselves: frontend/src/core/__tests__/loanExtraPayment.test.ts.

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
      amount: 2500.456,
      note: '  Bonus ',
    });
    expect(res.status).toBe(200);
    expect(await stored(extra)).toEqual({ month: 12, amount: 2500.46, note: 'Bonus' });
  });

  it('refuses a body it would refuse as a new extra payment, and changes nothing', async () => {
    const { loan, extra } = await loanWithExtra();
    const zero = await api('PUT', `/api/loans/${loan}/prepayments/${extra}`, {
      month: 3,
      amount: 0,
    });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toEqual({ error: 'Enter an amount above zero.' });
    // The loan has 60 payments.
    const late = await api('PUT', `/api/loans/${loan}/prepayments/${extra}`, {
      month: 61,
      amount: 10,
    });
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual({
      error: 'Choose which payment the extra payment goes with.',
    });
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
  it('stores the extra payment as checked: to the cent, the note trimmed, no other fields', async () => {
    const { loan } = await loanWithExtra();
    const res = await api('POST', `/api/loans/${loan}/prepayments`, {
      month: 2,
      amount: 99.999,
      note: ' x ',
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toEqual({ month: 2, amount: 100, note: 'x' });
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
