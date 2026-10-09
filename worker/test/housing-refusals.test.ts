/**
 * What the housing routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/housingSchema.ts, which local-first and the Housing dialog run too. Before:
 *
 * - A body without a name or a positive amount was "Property name and a valid monthly amount are
 *   required", at no field; any type, due month, due day, amount past the cent or name of any
 *   length was stored.
 * - A body without a due month fell due in January (the contract's `housing-due-month-default`).
 * - An edit wrote every field whether it was sent or not: one without a name answered 500 (the
 *   row's NOT NULL rule), one without a due date moved it to 01-01, and the type never changed.
 * - A create answered 200 and the list answered autopay as 0 or 1 (`housing-answer-shape`).
 *
 * An edit checks and writes only what it changes, so a row an older version stored stays
 * editable. The local-first twin: frontend/src/core/storage/__tests__/housingRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { calendarDateIn } from '../../shared/calendarDate';
import { HOUSING_MESSAGES as M } from '../../shared/housingSchema';

const USER = 6573;
const PROFILE = 65730;
const OTHER_USER = 6574;
const OTHER_PROFILE = 65740;
const FLAT = 657301;
const OLD = 657302; // a name over 100 characters and an amount past the cent, stored before the rules
const ELSEWHERE = 657401;
const LONG = 'The flat above the bakery on the corner of the square '.repeat(3).trim();

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM housings WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const housing = (id: number, profile: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: profile,
      name: 'Flat',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: 1,
      notes: 'To the landlord',
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO housings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((column) => row[column]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'housing-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'housing-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Else')").bind(
      OTHER_PROFILE,
      OTHER_USER
    ),
    housing(FLAT, PROFILE, {}),
    housing(OLD, PROFILE, { name: LONG, monthly_amount: 10.555, autopay: 0, notes: '' }),
    housing(ELSEWHERE, OTHER_PROFILE, { name: 'Theirs' }),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function refusal(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

async function stored(id: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    'SELECT name, type, monthly_amount, due_date, autopay, notes FROM housings WHERE id = ?'
  )
    .bind(id)
    .first();
}

async function count(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM housings WHERE profile_id = ?')
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** What the Housing form posts. */
const FORM = {
  type: 'mortgage',
  property_name: 'House by the river',
  monthly_amount: 1200.5,
  due_day: 20,
  due_month: 11,
  autopay: true,
  notes: 'Bank transfer',
};

describe('POST /api/housing', () => {
  it('refuses a body without a name or an amount, at each field', async () => {
    expect(await refusal(await call('POST', '/api/housing', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amount}`,
        fields: { property_name: M.name, monthly_amount: M.amount },
      },
    });
    expect(await count()).toBe(2);
  });

  it('refuses a type, an amount, a due month and a due day it cannot store', async () => {
    const res = await call('POST', '/api/housing', {
      ...FORM,
      type: 'castle',
      monthly_amount: 9.999,
      due_month: 13,
      due_day: 0,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.type} ${M.amountCents} ${M.dueMonth} ${M.dueDay}`,
        fields: {
          type: M.type,
          monthly_amount: M.amountCents,
          due_month: M.dueMonth,
          due_day: M.dueDay,
        },
      },
    });
    expect(await count()).toBe(2);
  });

  it('refuses a due day its month does not have, and stores 29 February', async () => {
    const april31 = 'April has no 31st. Enter a day from 1 to 30.';
    expect(
      await refusal(await call('POST', '/api/housing', { ...FORM, due_month: 4, due_day: 31 }))
    ).toEqual({ status: 400, body: { error: april31, fields: { due_day: april31 } } });
    expect(await count()).toBe(2);

    const res = await call('POST', '/api/housing', { ...FORM, due_month: 2, due_day: 29 });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect((await stored(id))?.due_date).toBe('02-29');
  });

  it('stores what the Housing form sends and answers 201 with its id', async () => {
    const res = await call('POST', '/api/housing', FORM);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toEqual({
      name: 'House by the river',
      type: 'mortgage',
      monthly_amount: 1200.5,
      due_date: '11-20',
      autopay: 1,
      notes: 'Bank transfer',
    });
  });

  it("falls due in the person's current month when sent without a due month", async () => {
    // Fourteen hours ahead of UTC, the person's month starts before the Worker's.
    const zone = 'Pacific/Kiritimati';
    const res = await call(
      'POST',
      '/api/housing',
      { ...FORM, due_month: undefined, due_day: 15 },
      { 'X-Time-Zone': zone }
    );
    const { id } = (await res.json()) as { id: number };
    const month = calendarDateIn(zone).slice(5, 7);
    expect((await stored(id))?.due_date).toBe(`${month}-15`);
  });
});

describe('GET /api/housing', () => {
  it('answers the columns, with autopay as true or false', async () => {
    const res = await call('GET', '/api/housing');
    const body = (await res.json()) as { housings: Record<string, unknown>[] };
    expect(body.housings.find((h) => h.id === FLAT)).toEqual({
      id: FLAT,
      profile_id: PROFILE,
      name: 'Flat',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: true,
      notes: 'To the landlord',
      created_at: expect.any(String),
    });
    expect(body.housings.find((h) => h.id === OLD)?.autopay).toBe(false);
  });
});

describe('PUT /api/housing/:id', () => {
  it('changes only what it sends, the type too', async () => {
    expect((await call('PUT', `/api/housing/${FLAT}`, { notes: 'New lease' })).status).toBe(200);
    expect((await call('PUT', `/api/housing/${FLAT}`, { type: 'hoa' })).status).toBe(200);
    expect(await stored(FLAT)).toEqual({
      name: 'Flat',
      type: 'hoa',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: 1,
      notes: 'New lease',
    });
  });

  it('moves the due date with the day it sends, keeping the month', async () => {
    expect((await call('PUT', `/api/housing/${FLAT}`, { due_day: 28 })).status).toBe(200);
    expect((await stored(FLAT))?.due_date).toBe('04-28');
  });

  it('refuses a blank name and an amount of zero at their fields, and stores nothing', async () => {
    const res = await call('PUT', `/api/housing/${FLAT}`, {
      property_name: ' ',
      monthly_amount: 0,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amountPositive}`,
        fields: { property_name: M.name, monthly_amount: M.amountPositive },
      },
    });
    expect((await stored(FLAT))?.name).toBe('Flat');
  });

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    const res = await call('PUT', `/api/housing/${OLD}`, {
      type: 'rent',
      property_name: LONG,
      monthly_amount: 10.555,
      due_day: 5,
      due_month: 4,
      autopay: false,
      notes: 'Still here',
    });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toEqual({
      name: LONG,
      type: 'rent',
      monthly_amount: 10.555,
      due_date: '04-05',
      autopay: 0,
      notes: 'Still here',
    });
  });

  it("answers 404 for another profile's row, and changes nothing", async () => {
    const res = await call('PUT', `/api/housing/${ELSEWHERE}`, { notes: 'Mine now' });
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } });
    expect((await stored(ELSEWHERE))?.notes).toBe('To the landlord');
    expect(await refusal(await call('DELETE', `/api/housing/${ELSEWHERE}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    });
  });
});
