/**
 * What the retirement goal routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/retirementGoalSchema.ts, which local-first and the goal dialog run too. Before, the
 * Worker checked only that a name and a target were sent:
 *
 * - `expected_return_rate || 7` saved a 0 % return as 7 %, on a create and on an edit.
 * - A goal sent without ages was saved as a 30-year-old retiring at 65, and anything else was
 *   stored as sent: text for a target, an age of 400.
 * - An edit wrote every column, so one that sent only a name bound `undefined` and answered 500,
 *   and one that sent an older row back reset its blanks to the guesses.
 * - A goal the profile does not have answered 404 "Not found".
 *
 * The local-first twin: frontend/src/core/storage/__tests__/retirementGoalRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { RETIREMENT_GOAL_MESSAGES as M } from '../../shared/retirementGoalSchema';

const USER = 6340;
const PROFILE = 63400;
const OTHER = 63401;
const OLD = 634001; // stored under no rules at all
const THEIRS = 634002; // the other profile's

/** What the Retirement page sends for a goal. */
const PAGE = {
  name: 'Retire at 60',
  target_amount: 750000,
  current_amount: 42000.5,
  target_date: '2050-01-01',
  monthly_contribution: 1200,
  expected_return_rate: 6.5,
  current_age: 38,
  retirement_age: 60,
};

const LONG_NAME = 'Retire by the sea, '.repeat(7).trim();

/** The old row as stored, and as the page sends it back. */
const OLD_ROW = {
  name: LONG_NAME,
  target_amount: 0,
  current_amount: 15000.555,
  deadline: null,
  notes: '',
  current_age: 0,
  retirement_age: 400,
  monthly_contribution: 0,
  expected_return_rate: 35,
};
const OLD_SENT_BACK = {
  name: LONG_NAME,
  target_amount: 0,
  current_amount: 15000.555,
  target_date: '',
  monthly_contribution: 0,
  expected_return_rate: 35,
  current_age: 0,
  retirement_age: 400,
};

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM retirement_goals WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(USER),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const columns = Object.keys(OLD_ROW);
  const insert = (id: number, profile: number) =>
    env.DB.prepare(
      `INSERT INTO retirement_goals (id, profile_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})`
    ).bind(id, profile, ...Object.values(OLD_ROW));
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'retirement-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Me')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Partner')").bind(
      OTHER,
      USER
    ),
    insert(OLD, PROFILE),
    insert(THEIRS, OTHER),
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

async function stored(id: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    `SELECT name, target_amount, current_amount, deadline, notes, current_age, retirement_age,
       monthly_contribution, expected_return_rate, profile_id
     FROM retirement_goals WHERE id = ?`
  )
    .bind(id)
    .first();
}

async function count(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM retirement_goals WHERE profile_id = ?'
  )
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function refusal(res: Response, fields: Record<string, string>): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; fields: Record<string, string> };
  expect(body.fields).toEqual(fields);
  expect(body.error).toBe(Object.values(fields).join(' '));
}

describe('POST /api/retirement-goals', () => {
  it('stores the goal the page sends, and answers what it stored', async () => {
    const res = await api('POST', '/api/retirement-goals', { ...PAGE, name: ' Retire at 60 ' });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { id: number };
    expect(answer).toEqual({
      id: expect.any(Number),
      name: 'Retire at 60',
      target_amount: 750000,
      current_amount: 42000.5,
      deadline: '2050-01-01',
      notes: '',
      profile_id: PROFILE,
    });
    expect(await stored(answer.id)).toEqual({
      name: 'Retire at 60',
      target_amount: 750000,
      current_amount: 42000.5,
      deadline: '2050-01-01',
      notes: '',
      current_age: 38,
      retirement_age: 60,
      monthly_contribution: 1200,
      expected_return_rate: 6.5,
      profile_id: PROFILE,
    });
  });

  it('keeps a 0 % return at 0 %', async () => {
    const res = await api('POST', '/api/retirement-goals', { ...PAGE, expected_return_rate: 0 });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect((await stored(id))?.expected_return_rate).toBe(0);
  });

  it('refuses a goal without the ages and the return, where it used to store guesses', async () => {
    const before = await count();
    await refusal(
      await api('POST', '/api/retirement-goals', {
        ...PAGE,
        current_age: null,
        retirement_age: null,
        expected_return_rate: null,
      }),
      {
        current_age: M.currentAge,
        retirement_age: M.retirementAge,
        expected_return_rate: M.returnRate,
      }
    );
    expect(await count()).toBe(before);
  });

  it('says what is wrong at each field, and stores nothing', async () => {
    const before = await count();
    await refusal(
      await api('POST', '/api/retirement-goals', {
        ...PAGE,
        name: '',
        target_amount: 'lots',
        current_amount: -1,
        target_date: '2050-02-30',
        current_age: 400,
        expected_return_rate: 25,
      }),
      {
        name: M.name,
        target_amount: M.targetNumber,
        current_amount: M.current,
        deadline: M.deadline,
        current_age: M.currentAge,
        expected_return_rate: M.returnRange,
      }
    );
    expect(await count()).toBe(before);
  });

  it('files the goal under the profile asking, whatever the body says', async () => {
    const res = await api('POST', '/api/retirement-goals', { ...PAGE, profile_id: OTHER, id: 9 });
    const { id } = (await res.json()) as { id: number };
    expect(id).not.toBe(9);
    expect((await stored(id))?.profile_id).toBe(PROFILE);
  });
});

describe('PUT /api/retirement-goals/:id', () => {
  it('renames a goal stored under no rules, and changes nothing it sends back as it was', async () => {
    const res = await api('PUT', `/api/retirement-goals/${OLD}`, {
      ...OLD_SENT_BACK,
      name: 'By the sea',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await stored(OLD)).toEqual({ ...OLD_ROW, name: 'By the sea', profile_id: PROFILE });
  });

  it('changes only what it is sent, where it used to answer 500 for a body without every field', async () => {
    const res = await api('PUT', `/api/retirement-goals/${OLD}`, { name: 'By the sea' });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toEqual({ ...OLD_ROW, name: 'By the sea', profile_id: PROFILE });
  });

  it('saves a change to 0 % as 0 %', async () => {
    const res = await api('PUT', `/api/retirement-goals/${OLD}`, {
      ...OLD_SENT_BACK,
      expected_return_rate: 0,
    });
    expect(res.status).toBe(200);
    expect((await stored(OLD))?.expected_return_rate).toBe(0);
  });

  it('refuses what a change gets wrong, at its field, and writes nothing', async () => {
    await refusal(
      await api('PUT', `/api/retirement-goals/${OLD}`, {
        ...OLD_SENT_BACK,
        name: 'By the sea',
        retirement_age: 140,
        monthly_contribution: 'some',
      }),
      { retirement_age: M.retirementAge, monthly_contribution: M.monthly }
    );
    expect(await stored(OLD)).toEqual({ ...OLD_ROW, profile_id: PROFILE });
  });

  it("answers 404 for a goal the profile does not have, another profile's included", async () => {
    for (const id of [THEIRS, 999999]) {
      const res = await api('PUT', `/api/retirement-goals/${id}`, PAGE);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Retirement goal not found' });
    }
    expect((await stored(THEIRS))?.name).toBe(LONG_NAME);
  });
});

describe('DELETE /api/retirement-goals/:id', () => {
  it("answers 404 for a goal the profile does not have, another profile's included", async () => {
    for (const id of [THEIRS, 999999]) {
      const res = await api('DELETE', `/api/retirement-goals/${id}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Retirement goal not found' });
    }
    expect(await stored(THEIRS)).not.toBeNull();
  });
});
