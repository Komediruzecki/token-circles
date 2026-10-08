/**
 * What the loan routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/loanSchema.ts, which local-first and the Loans forms run too. Before:
 *
 * - The Worker checked nothing on a loan. One without a name answered 500, one without a rate was
 *   saved at 5 %, and a rate period's rate or months were stored as whatever was sent.
 * - An extra payment's refusal named no field, said only the first thing wrong, and an amount with
 *   three decimals was rounded instead of refused.
 * - An edit of an extra payment was checked as a new one, so one that goes with a payment a
 *   shortened term has since passed could not have its amount changed.
 *
 * An edit checks and writes only what it changes, so a loan an older version stored under other
 * rules stays editable. The local-first twin:
 * frontend/src/core/storage/__tests__/loanRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { LOAN_MESSAGES as M, periodEndMessage, periodStartMessage } from '../../shared/loanSchema';

const USER = 6320;
const PROFILE = 63200;
const PLAIN = 632001; // a loan as the form makes one, with one rate period
const OLD = 632002; // stored under no rules at all
const SHORTENED = 632003; // a 24-month loan with an extra payment at payment 50
const OLD_PERIOD = 632011;
const PLAIN_PERIOD = 632012;
const LATE_EXTRA = 632021;

const LONG_NAME = 'Family loan for the flat, '.repeat(6).trim();

/** The body the Loans form sends for a new loan. */
const FORM = {
  name: 'Car',
  principal: 15000,
  interest_rate: 4.5,
  term_months: 60,
  start_date: '2026-01-15',
  rate_periods: [],
};

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
  const loan = (id: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: PROFILE,
      name: 'Car',
      principal: 15000,
      interest_rate: 4.5,
      start_date: '2026-01-15',
      term_months: 60,
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO loans (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => row[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'loan-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    loan(PLAIN, {}),
    loan(OLD, {
      name: LONG_NAME,
      principal: 15000.555,
      interest_rate: 250,
      start_date: '2026-01-15 00:00:00',
      term_months: 0,
    }),
    loan(SHORTENED, { term_months: 24 }),
    env.DB.prepare(
      'INSERT INTO loan_rate_periods (id, loan_id, rate, start_month, end_month) VALUES (?, ?, 300, 0, 0)'
    ).bind(OLD_PERIOD, OLD),
    env.DB.prepare(
      'INSERT INTO loan_rate_periods (id, loan_id, rate, start_month, end_month) VALUES (?, ?, 6, 13, 24)'
    ).bind(PLAIN_PERIOD, PLAIN),
    env.DB.prepare(
      "INSERT INTO loan_prepayments (id, loan_id, month, amount, note) VALUES (?, ?, 50, 500, 'Bonus')"
    ).bind(LATE_EXTRA, SHORTENED),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
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

async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

async function storedLoan(id: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    'SELECT name, principal, interest_rate, start_date, term_months FROM loans WHERE id = ?'
  )
    .bind(id)
    .first();
}

async function storedPeriods(loan: number): Promise<Record<string, unknown>[]> {
  return (
    await env.DB.prepare(
      'SELECT id, rate, start_month, end_month FROM loan_rate_periods WHERE loan_id = ? ORDER BY id'
    )
      .bind(loan)
      .all()
  ).results;
}

async function storedExtras(loan: number): Promise<Record<string, unknown>[]> {
  return (
    await env.DB.prepare(
      'SELECT id, month, amount, note FROM loan_prepayments WHERE loan_id = ? ORDER BY id'
    )
      .bind(loan)
      .all()
  ).results;
}

async function loanCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM loans WHERE profile_id = ?')
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('POST /api/loans', () => {
  it('refuses a loan without a name at the name, where it answered 500', async () => {
    const { name: _name, ...nameless } = FORM;
    expect(await answer(await call('POST', '/api/loans', nameless))).toEqual({
      status: 400,
      body: { error: M.name, fields: { name: M.name } },
    });
    expect(await loanCount()).toBe(3);
  });

  it('refuses a loan without a rate, where it was saved at 5 %', async () => {
    const { interest_rate: _rate, ...rateless } = FORM;
    expect(await answer(await call('POST', '/api/loans', rateless))).toEqual({
      status: 400,
      body: { error: M.rate, fields: { interest_rate: M.rate } },
    });
    expect(await loanCount()).toBe(3);
  });

  it('says every field that is wrong, each at its own field', async () => {
    const res = await call('POST', '/api/loans', {
      name: '',
      principal: 'lots',
      interest_rate: 120,
      term_months: 1.5,
      start_date: '2026-02-30',
    });
    expect(await answer(res)).toEqual({
      status: 400,
      body: {
        error: [M.name, M.principalNumber, M.rateRange, M.termRange, M.startDateReal].join(' '),
        fields: {
          name: M.name,
          principal: M.principalNumber,
          interest_rate: M.rateRange,
          term_months: M.termRange,
          start_date: M.startDateReal,
        },
      },
    });
  });

  it('refuses a rate period at the field of its row, and stores nothing', async () => {
    const res = await call('POST', '/api/loans', {
      ...FORM,
      rate_periods: [
        { rate: 6, start_month: 13, end_month: 24 },
        { rate: 5, start_month: 61, end_month: 70 },
      ],
    });
    expect(await answer(res)).toEqual({
      status: 400,
      body: {
        error: `${periodStartMessage(60)} ${periodEndMessage(1, 60)}`,
        fields: {
          'rate_periods.1.start_month': periodStartMessage(60),
          'rate_periods.1.end_month': periodEndMessage(1, 60),
        },
      },
    });
    expect(await loanCount()).toBe(3);
  });

  it('stores the loan as checked: trimmed, a 0 % rate kept, its periods read', async () => {
    const res = await call('POST', '/api/loans', {
      ...FORM,
      name: ' Family loan ',
      principal: '12000.50',
      interest_rate: 0,
      rate_periods: [{ rate: '2.5', start_month: '13', end_month: '' }],
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(await storedLoan(id)).toEqual({
      name: 'Family loan',
      principal: 12000.5,
      interest_rate: 0,
      start_date: '2026-01-15',
      term_months: 60,
    });
    expect((await storedPeriods(id)).map(({ id: _id, ...p }) => p)).toEqual([
      { rate: 2.5, start_month: 13, end_month: null },
    ]);
  });
});

describe('PUT /api/loans/:id', () => {
  it('saves a loan stored under older rules with its own values sent back', async () => {
    const res = await call('PUT', `/api/loans/${OLD}`, {
      name: LONG_NAME,
      principal: 15000.555,
      interest_rate: 250,
      term_months: 0,
      start_date: '2026-01-15 00:00:00',
      rate_periods: [{ rate: 300, start_month: 0, end_month: null }],
    });
    expect(res.status).toBe(200);
    expect(await storedLoan(OLD)).toEqual({
      name: LONG_NAME,
      principal: 15000.555,
      interest_rate: 250,
      start_date: '2026-01-15 00:00:00',
      term_months: 0,
    });
    expect(await storedPeriods(OLD)).toEqual([
      { id: OLD_PERIOD, rate: 300, start_month: 0, end_month: 0 },
    ]);
  });

  it('renames a loan stored under older rules, and writes only the name', async () => {
    const res = await call('PUT', `/api/loans/${OLD}`, {
      name: 'Flat',
      principal: 15000.555,
      interest_rate: 250,
      term_months: 0,
      start_date: '2026-01-15',
      rate_periods: [{ rate: 300, start_month: 0, end_month: null }],
    });
    expect(res.status).toBe(200);
    expect(await storedLoan(OLD)).toEqual({
      name: 'Flat',
      principal: 15000.555,
      interest_rate: 250,
      start_date: '2026-01-15',
      term_months: 0,
    });
  });

  it('refuses what it changes, and writes nothing', async () => {
    const res = await call('PUT', `/api/loans/${PLAIN}`, {
      ...FORM,
      name: 'Car loan',
      principal: 0,
      interest_rate: null,
    });
    expect(await answer(res)).toEqual({
      status: 400,
      body: {
        error: `${M.amountPositive} ${M.rate}`,
        fields: { principal: M.amountPositive, interest_rate: M.rate },
      },
    });
    expect(await storedLoan(PLAIN)).toMatchObject({ name: 'Car', principal: 15000 });
  });

  it('keeps the rate when the edit leaves it out', async () => {
    const { interest_rate: _rate, ...rateless } = FORM;
    const res = await call('PUT', `/api/loans/${PLAIN}`, { ...rateless, name: 'Car loan' });
    expect(res.status).toBe(200);
    expect(await storedLoan(PLAIN)).toMatchObject({ name: 'Car loan', interest_rate: 4.5 });
  });

  it('keeps the rate periods it is sent back, ids and all', async () => {
    const res = await call('PUT', `/api/loans/${PLAIN}`, {
      ...FORM,
      name: 'Car loan',
      rate_periods: [{ rate: 6, start_month: 13, end_month: 24 }],
    });
    expect(res.status).toBe(200);
    expect(await storedPeriods(PLAIN)).toEqual([
      { id: PLAIN_PERIOD, rate: 6, start_month: 13, end_month: 24 },
    ]);
  });

  it('refuses a changed rate period at its row, and keeps the stored ones', async () => {
    const res = await call('PUT', `/api/loans/${PLAIN}`, {
      ...FORM,
      rate_periods: [
        { rate: 6, start_month: 13, end_month: 24 },
        { rate: 'x', start_month: 25, end_month: null },
      ],
    });
    expect(await answer(res)).toEqual({
      status: 400,
      body: { error: M.rateNumber, fields: { 'rate_periods.1.rate': M.rateNumber } },
    });
    expect(await storedPeriods(PLAIN)).toEqual([
      { id: PLAIN_PERIOD, rate: 6, start_month: 13, end_month: 24 },
    ]);
  });

  it('answers 404 for a loan the profile does not have', async () => {
    expect((await call('PUT', '/api/loans/999999', FORM)).status).toBe(404);
  });
});

describe('the rate period routes', () => {
  it('refuse a period that is not one of the loan, at its fields', async () => {
    expect(
      await answer(await call('POST', `/api/loans/${PLAIN}/rates`, { rate: 101, start_month: 0 }))
    ).toEqual({
      status: 400,
      body: {
        error: `${M.rateRange} ${periodStartMessage(60)}`,
        fields: { rate: M.rateRange, start_month: periodStartMessage(60) },
      },
    });
    expect(await storedPeriods(PLAIN)).toHaveLength(1);
  });

  it('change only what an edit changes, and keep a period stored under older rules editable', async () => {
    const res = await call('PUT', `/api/loans/${OLD}/rates/${OLD_PERIOD}`, {
      rate: 9,
      start_month: 0,
      end_month: 0,
    });
    expect(res.status).toBe(200);
    expect(await storedPeriods(OLD)).toEqual([
      { id: OLD_PERIOD, rate: 9, start_month: 0, end_month: 0 },
    ]);
  });

  it('answer 404 for a change to a period the loan does not have, which answered 200', async () => {
    expect(
      await answer(
        await call('PUT', `/api/loans/${PLAIN}/rates/${OLD_PERIOD}`, {
          rate: 5,
          start_month: 1,
          end_month: null,
        })
      )
    ).toEqual({ status: 404, body: { error: 'Rate period not found' } });
    expect(await storedPeriods(OLD)).toEqual([
      { id: OLD_PERIOD, rate: 300, start_month: 0, end_month: 0 },
    ]);
  });
});

describe('removing a rate period or an extra payment', () => {
  it('answers 404 for a period the loan does not have, which answered 200', async () => {
    expect(await answer(await call('DELETE', `/api/loans/${PLAIN}/rates/${OLD_PERIOD}`))).toEqual({
      status: 404,
      body: { error: 'Rate period not found' },
    });
    expect(await storedPeriods(OLD)).toHaveLength(1);
  });

  it('answers 404 for an extra payment the loan does not have, which answered 200', async () => {
    expect(
      await answer(await call('DELETE', `/api/loans/${PLAIN}/prepayments/${LATE_EXTRA}`))
    ).toEqual({ status: 404, body: { error: 'Extra payment not found' } });
    expect(await storedExtras(SHORTENED)).toHaveLength(1);
  });

  it('removes the one asked for, and answers 404 the second time', async () => {
    expect((await call('DELETE', `/api/loans/${PLAIN}/rates/${PLAIN_PERIOD}`)).status).toBe(200);
    expect(await storedPeriods(PLAIN)).toEqual([]);
    expect((await call('DELETE', `/api/loans/${PLAIN}/rates/${PLAIN_PERIOD}`)).status).toBe(404);
    const extra = `/api/loans/${SHORTENED}/prepayments/${LATE_EXTRA}`;
    expect((await call('DELETE', extra)).status).toBe(200);
    expect(await storedExtras(SHORTENED)).toEqual([]);
    expect((await call('DELETE', extra)).status).toBe(404);
  });
});

describe('the extra payment routes', () => {
  it('refuse every field that is wrong at once, at each field', async () => {
    expect(
      await answer(
        await call('POST', `/api/loans/${PLAIN}/prepayments`, { month: 61, amount: 0, note: 3 })
      )
    ).toEqual({
      status: 400,
      body: {
        error: `${M.extraMonth} ${M.amountPositive} ${M.note}`,
        fields: { month: M.extraMonth, amount: M.amountPositive, note: M.note },
      },
    });
  });

  it('refuse an amount with three decimals, which was rounded', async () => {
    expect(
      await answer(
        await call('POST', `/api/loans/${PLAIN}/prepayments`, { month: 2, amount: 99.999 })
      )
    ).toEqual({
      status: 400,
      body: { error: M.extraAmountCents, fields: { amount: M.extraAmountCents } },
    });
    expect(await storedExtras(PLAIN)).toEqual([]);
  });

  it('change the amount of a payment a shortened term has passed, which was refused', async () => {
    const res = await call('PUT', `/api/loans/${SHORTENED}/prepayments/${LATE_EXTRA}`, {
      month: 50,
      amount: 750.25,
      note: 'Bonus',
    });
    expect(res.status).toBe(200);
    expect(await storedExtras(SHORTENED)).toEqual([
      { id: LATE_EXTRA, month: 50, amount: 750.25, note: 'Bonus' },
    ]);
  });

  it('refuse a change of month past the term, at the month', async () => {
    expect(
      await answer(
        await call('PUT', `/api/loans/${SHORTENED}/prepayments/${LATE_EXTRA}`, {
          month: 51,
          amount: 500,
          note: 'Bonus',
        })
      )
    ).toEqual({ status: 400, body: { error: M.extraMonth, fields: { month: M.extraMonth } } });
  });

  it('answer 200 to an edit that changes nothing, and write nothing', async () => {
    const res = await call('PUT', `/api/loans/${SHORTENED}/prepayments/${LATE_EXTRA}`, {
      month: 50,
      amount: 500,
      note: ' Bonus ',
    });
    expect(res.status).toBe(200);
    expect(await storedExtras(SHORTENED)).toEqual([
      { id: LATE_EXTRA, month: 50, amount: 500, note: 'Bonus' },
    ]);
  });
});
