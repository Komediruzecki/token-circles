/**
 * A category's savings goal counts that category's transactions. Editing a transaction changes
 * what both goals involved count: the one of the category it was in, and the one of the category
 * it is in afterwards.
 *
 * The route recalculated only the category the body named, and only when it named one. So a
 * transaction moved from Car to Food left the Car goal still counting it, and an edit that changed
 * only the amount, which is all an API client has to send, left the goal at the old amount until
 * the Goals page next loaded and recalculated everything.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sessionCookie } from './helpers/session';

const USER = 9821;
const PROFILE = 98210;
const CAR = 982101;
const FOOD = 982102;
const ACCOUNT = 982103;
const CAR_GOAL = 982104;
const FOOD_GOAL = 982105;
const TX = 982106;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM savings_goals WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'edit-goals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Goals')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Car', 'expense', '#3B82F6')"
    ).bind(CAR, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Food', 'expense', '#59d2a2')"
    ).bind(FOOD, PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Everyday', 'giro', 'EUR', 900, 1000)"
    ).bind(ACCOUNT, PROFILE),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, amount, amount_local, currency, type, date, category_id, account_id) VALUES (?, ?, 'Service', 100, 100, 'EUR', 'expense', '2026-06-01', ?, ?)"
    ).bind(TX, PROFILE, CAR, ACCOUNT),
    // Both goals as the last recalculation left them: Car counting the 100, Food nothing.
    env.DB.prepare(
      "INSERT INTO savings_goals (id, profile_id, name, target_amount, current_amount, category_id, tracking_start_date) VALUES (?, ?, 'Car fund', 1000, 100, ?, '2026-01-01')"
    ).bind(CAR_GOAL, PROFILE, CAR),
    env.DB.prepare(
      "INSERT INTO savings_goals (id, profile_id, name, target_amount, current_amount, category_id, tracking_start_date) VALUES (?, ?, 'Food fund', 500, 0, ?, '2026-01-01')"
    ).bind(FOOD_GOAL, PROFILE, FOOD),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

function edit(body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com/api/transactions/${TX}`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

async function counted(goal: number): Promise<number> {
  const row = await env.DB.prepare('SELECT current_amount FROM savings_goals WHERE id = ?')
    .bind(goal)
    .first<{ current_amount: number }>();
  return row?.current_amount ?? NaN;
}

describe('editing a transaction in a category with a goal', () => {
  it('moves the goal to the new amount when only the amount changes', async () => {
    const res = await edit({ amount: 150, amount_local: 150 });
    expect(res.status).toBe(200);

    expect(await counted(CAR_GOAL)).toBe(150);
  });

  it('takes the transaction off the goal of the category it leaves, and onto the new one', async () => {
    const res = await edit({ category_id: FOOD });
    expect(res.status).toBe(200);

    expect(await counted(CAR_GOAL)).toBe(0);
    expect(await counted(FOOD_GOAL)).toBe(100);
  });

  it('takes it off the goal when the edit leaves it uncategorized', async () => {
    const res = await edit({ category_id: null });
    expect(res.status).toBe(200);

    expect(await counted(CAR_GOAL)).toBe(0);
  });
});
