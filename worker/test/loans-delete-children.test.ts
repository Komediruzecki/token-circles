import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Deleting a loan deletes its rate periods and extra payments.
//
// They live in their own tables, keyed by loan_id, with no foreign key to cascade. DELETE
// /api/loans/:id removed the loan alone, and every later sweep (a profile's deletion, the
// account's, a restore) finds a loan's rows through `loan_id IN (SELECT id FROM loans ...)`, which
// a deleted loan is no longer in: the rows stayed in D1 for good, after the account was gone too.
// No route can read them, so the contract scenarios cannot see this; the table can.

const USER = 4711;
const ME = 47110;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM loans WHERE profile_id = 47110'),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = 4711'),
    env.DB.prepare('DELETE FROM users WHERE id = 4711'),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (4711, 'loan-children@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (47110, 4711, 'Me')"),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function api(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': String(ME) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function count(table: string, loanId: number): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE loan_id = ?`)
    .bind(loanId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('DELETE /api/loans/:id', () => {
  it("removes the loan's rate periods and extra payments with it", async () => {
    const created = await api('POST', '/api/loans', {
      name: 'Car',
      principal: 15000,
      interest_rate: 4.5,
      term_months: 60,
      start_date: '2026-01-15',
      rate_periods: [{ rate: 6, start_month: 13, end_month: 24 }],
    });
    const { id } = (await created.json()) as { id: number };
    expect((await api('POST', `/api/loans/${id}/rates`, { rate: 5, start_month: 25 })).status).toBe(
      200
    );
    expect(
      (await api('POST', `/api/loans/${id}/prepayments`, { month: 12, amount: 2000 })).status
    ).toBe(200);
    expect(await count('loan_rate_periods', id)).toBe(2);
    expect(await count('loan_prepayments', id)).toBe(1);

    expect((await api('DELETE', `/api/loans/${id}`)).status).toBe(200);
    expect(await count('loan_rate_periods', id)).toBe(0);
    expect(await count('loan_prepayments', id)).toBe(0);
  });

  it("leaves another loan's rows alone", async () => {
    const make = async (name: string) => {
      const res = await api('POST', '/api/loans', {
        name,
        principal: 1000,
        interest_rate: 3,
        term_months: 12,
        start_date: '2026-01-15',
        rate_periods: [{ rate: 4, start_month: 1, end_month: 6 }],
      });
      return ((await res.json()) as { id: number }).id;
    };
    const gone = await make('Gone');
    const kept = await make('Kept');
    await api('POST', `/api/loans/${kept}/prepayments`, { month: 3, amount: 100 });
    expect((await api('DELETE', `/api/loans/${gone}`)).status).toBe(200);
    expect(await count('loan_rate_periods', kept)).toBe(1);
    expect(await count('loan_prepayments', kept)).toBe(1);
  });
});
