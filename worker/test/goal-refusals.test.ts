/**
 * What the savings goal routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/goalSchema.ts, which local-first and the Goals dialog run too. Before:
 *
 * - A goal without a name or a target answered "Name and target amount are required" and no
 *   field; a target of zero, or of text, was stored.
 * - Another profile's category was a 403 with no field.
 * - A contribution that was not a number added nothing and answered that it had.
 *
 * An edit checks and writes only what it changes, so a goal an older version stored with a target
 * of zero or a name over 100 characters stays editable. The local-first twin:
 * frontend/src/core/storage/__tests__/goalRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookie } from './helpers/session';
import { GOAL_MESSAGES as M } from '../../shared/goalSchema';

const USER = 6304;
const PROFILE = 63040;
const OTHER_USER = 6305;
const OTHER_PROFILE = 63050;
const SAVINGS = 630401;
const ELSEWHERE = 630501; // another user's category
const PLAIN = 630410;
const OLD = 630411; // a target of zero and a name over 100 characters

const LONG_NAME = 'Round the world, '.repeat(7).trim();

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM savings_goals WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const goal = (id: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: PROFILE,
      name: 'Car',
      target_amount: 5000,
      current_amount: 1000,
      deadline: '2030-06-30',
      notes: '',
      monthly_contribution: 0,
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO savings_goals (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => row[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'goal-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'goal-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Else')").bind(
      OTHER_PROFILE,
      OTHER_USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Savings', 'expense', '#22C55E')"
    ).bind(SAVINGS, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Elsewhere', 'expense', '#22C55E')"
    ).bind(ELSEWHERE, OTHER_PROFILE),
    goal(PLAIN, {}),
    goal(OLD, { name: LONG_NAME, target_amount: 0, deadline: null }),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

afterEach(() => {
  vi.useRealTimers();
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
  return env.DB.prepare('SELECT * FROM savings_goals WHERE id = ?').bind(id).first();
}

describe('POST /api/savings-goals', () => {
  it('refuses a goal without a name or a target, at each field', async () => {
    expect(await refusal(await call('POST', '/api/savings-goals', { name: ' ' }))).toEqual({
      status: 400,
      body: { error: `${M.name} ${M.target}`, fields: { name: M.name, target_amount: M.target } },
    });
  });

  it('refuses a target of zero, of text, or past the cent', async () => {
    for (const [target_amount, message] of [
      [0, M.targetPositive],
      ['lots', M.targetNumber],
      [99.999, M.cents],
    ] as const) {
      const res = await call('POST', '/api/savings-goals', { name: 'Car', target_amount });
      expect(await refusal(res)).toEqual({
        status: 400,
        body: { error: message, fields: { target_amount: message } },
      });
    }
  });

  it("refuses another profile's category at its field, as a 400", async () => {
    const res = await call('POST', '/api/savings-goals', {
      name: 'Car',
      target_amount: 100,
      category_id: ELSEWHERE,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    });
  });

  it('stores what the Goals form sends, with the defaults for what it leaves out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
    const res = await call('POST', '/api/savings-goals', {
      name: 'Holiday',
      target_amount: 1200.5,
      target_date: '2027-06-30',
      monthly_contribution: null,
      category_id: null,
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toMatchObject({
      name: 'Holiday',
      target_amount: 1200.5,
      current_amount: 0,
      deadline: '2027-06-30',
      notes: '',
      category_id: null,
      monthly_contribution: 0,
      tracking_start_date: '2026-10-08',
    });
  });
});

describe('PUT /api/savings-goals/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/savings-goals/${PLAIN}`, { name: 'New car' })).status).toBe(
      200
    );
    expect(await stored(PLAIN)).toMatchObject({
      name: 'New car',
      target_amount: 5000,
      current_amount: 1000,
      deadline: '2030-06-30',
    });
  });

  it('saves a goal an older version stored, when its values come back unchanged', async () => {
    const res = await call('PUT', `/api/savings-goals/${OLD}`, {
      name: LONG_NAME,
      target_amount: 0,
      target_date: '2031-01-01',
      monthly_contribution: null,
      category_id: null,
    });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toMatchObject({
      name: LONG_NAME,
      target_amount: 0,
      deadline: '2031-01-01',
    });
  });

  it('refuses what an edit changes to a value the rules do not take', async () => {
    const res = await call('PUT', `/api/savings-goals/${OLD}`, { target_amount: -1, name: '' });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.targetPositive}`,
        fields: { name: M.name, target_amount: M.targetPositive },
      },
    });
    expect(await stored(OLD)).toMatchObject({ name: LONG_NAME, target_amount: 0 });
  });

  it("refuses another profile's category at its field, as a 400", async () => {
    const res = await call('PUT', `/api/savings-goals/${PLAIN}`, { category_id: ELSEWHERE });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    });
  });

  it('answers 404 for a goal the profile does not have', async () => {
    expect((await call('PUT', '/api/savings-goals/999999', { name: 'x' })).status).toBe(404);
  });
});

describe('POST /api/savings-goals/:id/contribute', () => {
  it('refuses an amount that is not more than zero, at its field, and adds nothing', async () => {
    for (const [amount, message] of [
      [undefined, M.contribution],
      ['fifty', M.contributionNumber],
      [0, M.contributionPositive],
      [-5, M.contributionPositive],
      [1.005, M.cents],
    ] as const) {
      const res = await call('POST', `/api/savings-goals/${PLAIN}/contribute`, { amount });
      expect(await refusal(res)).toEqual({
        status: 400,
        body: { error: message, fields: { amount: message } },
      });
    }
    expect(await stored(PLAIN)).toMatchObject({ current_amount: 1000 });
  });

  it('adds to what is saved, to the cent, and says the new amount', async () => {
    await env.DB.prepare('UPDATE savings_goals SET current_amount = 0.1 WHERE id = ?')
      .bind(PLAIN)
      .run();
    const res = await call('POST', `/api/savings-goals/${PLAIN}/contribute`, { amount: '0.2' });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; current_amount: number };
    expect(String(answer.current_amount)).toBe('0.3');
    expect(String((await stored(PLAIN))?.current_amount)).toBe('0.3');
  });

  it('answers 404 for a goal the profile does not have', async () => {
    const res = await call('POST', '/api/savings-goals/999999/contribute', { amount: 5 });
    expect(res.status).toBe(404);
  });
});
