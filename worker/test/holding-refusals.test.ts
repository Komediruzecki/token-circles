/**
 * What the portfolio holding routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/holdingSchema.ts, which local-first and the Portfolio dialog run too. Before:
 *
 * - A body without one of the four fields was "ticker, shares, purchase_price, and
 *   purchase_date are required", at no field; a price below zero, a date of "soon" or a ticker of
 *   any length was stored.
 * - An edit wrote every field whether it was sent or not: a blank ticker or date kept the stored
 *   one without a word, and shares it could not read answered 500.
 *
 * An edit checks and writes only what it changes, so a holding an older version stored stays
 * editable. The local-first twin: frontend/src/core/storage/__tests__/holdingRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { HOLDING_MESSAGES as M } from '../../shared/holdingSchema';

const USER = 6575;
const PROFILE = 65750;
const OTHER_USER = 6576;
const OTHER_PROFILE = 65760;
const PLAN = 657501;
const OLD = 657502; // a ticker over 20 characters, a price below zero and a date that is none
const ELSEWHERE = 657601;
const LONG_TICKER = 'EXAMPLE-FUND-CLASS-A.XX';

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM portfolio_holdings WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const holding = (id: number, profile: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: profile,
      ticker: 'EXMPL',
      shares: 12,
      purchase_price: 48.5,
      purchase_date: '2026-02-10',
      notes: 'Monthly plan',
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO portfolio_holdings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((column) => row[column]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'holding-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'holding-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Else')").bind(
      OTHER_PROFILE,
      OTHER_USER
    ),
    holding(PLAN, PROFILE, {}),
    holding(OLD, PROFILE, {
      ticker: LONG_TICKER,
      purchase_price: -5,
      purchase_date: 'soon',
      notes: '',
    }),
    holding(ELSEWHERE, OTHER_PROFILE, { ticker: 'THEIRS' }),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
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

async function refusal(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

async function stored(id: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    'SELECT ticker, shares, purchase_price, purchase_date, notes FROM portfolio_holdings WHERE id = ?'
  )
    .bind(id)
    .first();
}

async function count(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM portfolio_holdings WHERE profile_id = ?'
  )
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** What the Portfolio form posts. */
const FORM = {
  ticker: 'SAMPL',
  shares: 2.5,
  purchase_price: 101.25,
  purchase_date: '2026-03-02',
  notes: 'First buy',
};

const PLAN_ROW = {
  ticker: 'EXMPL',
  shares: 12,
  purchase_price: 48.5,
  purchase_date: '2026-02-10',
  notes: 'Monthly plan',
};

describe('POST /api/portfolio/holdings', () => {
  it('refuses a body without a ticker, shares, a price or a date, at each field', async () => {
    expect(await refusal(await call('POST', '/api/portfolio/holdings', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.ticker} ${M.shares} ${M.price} ${M.date}`,
        fields: {
          ticker: M.ticker,
          shares: M.shares,
          purchase_price: M.price,
          purchase_date: M.date,
        },
      },
    });
    expect(await count()).toBe(2);
  });

  it('refuses a ticker, shares, a price and a date it cannot store', async () => {
    const res = await call('POST', '/api/portfolio/holdings', {
      ...FORM,
      ticker: LONG_TICKER,
      shares: 'lots',
      purchase_price: -5,
      purchase_date: 'soon',
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.tickerLength} ${M.sharesNumber} ${M.pricePositive} ${M.dateReal}`,
        fields: {
          ticker: M.tickerLength,
          shares: M.sharesNumber,
          purchase_price: M.pricePositive,
          purchase_date: M.dateReal,
        },
      },
    });
    expect(await count()).toBe(2);
  });

  it('stores what the Portfolio form sends, the ticker trimmed and in capitals, and answers 201', async () => {
    const res = await call('POST', '/api/portfolio/holdings', { ...FORM, ticker: ' sampl ' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toEqual(FORM);
  });
});

describe('PUT /api/portfolio/holdings/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/portfolio/holdings/${PLAN}`, { notes: 'Paused' })).status).toBe(
      200
    );
    expect((await call('PUT', `/api/portfolio/holdings/${PLAN}`, { shares: 15 })).status).toBe(200);
    expect(await stored(PLAN)).toEqual({ ...PLAN_ROW, shares: 15, notes: 'Paused' });
  });

  it('refuses a blank ticker, shares it cannot read and a blank date at their fields, and stores nothing', async () => {
    const res = await call('PUT', `/api/portfolio/holdings/${PLAN}`, {
      ...PLAN_ROW,
      ticker: ' ',
      shares: 'lots',
      purchase_date: '',
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.ticker} ${M.sharesNumber} ${M.date}`,
        fields: { ticker: M.ticker, shares: M.sharesNumber, purchase_date: M.date },
      },
    });
    expect(await stored(PLAN)).toEqual(PLAN_ROW);
  });

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    const res = await call('PUT', `/api/portfolio/holdings/${OLD}`, {
      ticker: LONG_TICKER,
      shares: 12,
      purchase_price: -5,
      purchase_date: 'soon',
      notes: 'Still here',
    });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toEqual({
      ticker: LONG_TICKER,
      shares: 12,
      purchase_price: -5,
      purchase_date: 'soon',
      notes: 'Still here',
    });
  });

  it("answers 404 for another profile's holding, and changes nothing", async () => {
    const res = await call('PUT', `/api/portfolio/holdings/${ELSEWHERE}`, { notes: 'Mine now' });
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } });
    expect((await stored(ELSEWHERE))?.notes).toBe('Monthly plan');
    expect(await refusal(await call('DELETE', `/api/portfolio/holdings/${ELSEWHERE}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    });
  });
});
