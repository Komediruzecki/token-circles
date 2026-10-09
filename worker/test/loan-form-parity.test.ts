/**
 * A loan saved from the Loans dialog, in the body the dialog sends, with the extra payments the
 * Extra payments tab adds, schedules to the figures worked out in closed form: its installment,
 * the extra payments it applies, total interest and payoff date, to the cent. Its row in the list
 * counts every extra payment saved, one after the loan is paid off included.
 *
 * The local-first twin, frontend/src/core/storage/__tests__/loanFormParity.test.ts, saves the same
 * bodies through the local-first router and requires the same figures, and checks the forms send
 * exactly these bodies. Together they make the two runtimes give a loan the same schedule.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { FORM_LOANS, listedFigures, scheduleFigures } from '../../shared/fixtures/loanFormParity';
import type { FormLoan } from '../../shared/fixtures/loanFormParity';
import type { LoanCalculation } from '../../shared/loanSchedule';

const USER = 6330;
const PROFILE = 63300;

let cookie = '';

beforeEach(async () => {
  const owned = 'loan_id IN (SELECT id FROM loans WHERE profile_id = ?)';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM loan_rate_periods WHERE ${owned}`).bind(PROFILE),
    env.DB.prepare(`DELETE FROM loan_prepayments WHERE ${owned}`).bind(PROFILE),
    env.DB.prepare('DELETE FROM loans WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'loan-form-parity@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

function api(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Save the loan as the dialog sends it, then its extra payments as the Extra payments tab does. */
async function save(loan: FormLoan): Promise<number> {
  const created = await api('POST', '/api/loans', loan.body);
  expect(created.status).toBe(200);
  const { id } = (await created.json()) as { id: number };
  for (const extra of loan.extras) {
    const added = await api('POST', `/api/loans/${id}/prepayments`, extra.body);
    expect(added.status).toBe(200);
  }
  return id;
}

describe('a loan saved from the Loans dialog', () => {
  for (const loan of FORM_LOANS) {
    it(`schedules ${loan.label} to the figures worked out by hand`, async () => {
      const id = await save(loan);

      const res = await api('POST', `/api/loans/${id}/calculate`, {});
      expect(res.status).toBe(200);
      const answer = (await res.json()) as LoanCalculation;
      expect(scheduleFigures(answer, loan.expected)).toEqual(loan.expected);
    });

    it(`lists what the extra payments on ${loan.label} come to`, async () => {
      const id = await save(loan);

      const res = await api('GET', '/api/loans');
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Record<string, unknown>[];
      expect(listedFigures(rows.find((row) => row.id === id)!)).toEqual(loan.listed);
    });
  }
});
