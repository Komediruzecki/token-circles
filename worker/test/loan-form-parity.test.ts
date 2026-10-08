/**
 * A loan saved from the Loans dialog, in the body the dialog sends, schedules to the figures worked
 * out in closed form: its installment, total interest and payoff date, to the cent.
 *
 * The local-first twin, frontend/src/core/storage/__tests__/loanFormParity.test.ts, saves the same
 * bodies through the local-first router and requires the same figures, and checks the dialog sends
 * exactly these bodies. Together they make the two runtimes give a loan the same schedule.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { FORM_LOANS, scheduleFigures } from '../../shared/fixtures/loanFormParity';
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
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
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

describe('a loan saved from the Loans dialog', () => {
  for (const loan of FORM_LOANS) {
    it(`schedules ${loan.label} to the figures worked out by hand`, async () => {
      const created = await api('POST', '/api/loans', loan.body);
      expect(created.status).toBe(200);
      const { id } = (await created.json()) as { id: number };

      const res = await api('POST', `/api/loans/${id}/calculate`, {});
      expect(res.status).toBe(200);
      const answer = (await res.json()) as LoanCalculation;
      expect(scheduleFigures(answer, loan.expected)).toEqual(loan.expected);
    });
  }
});
