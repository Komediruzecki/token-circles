/**
 * The change under Net Worth counts only the accounts Net Worth sums.
 *
 * The figure is how far the month's entries moved the balances (the contract scenario "the change
 * under Net Worth is how far its balances moved that month" holds both runtimes to it). An entry
 * can still name an account that is gone: transactions.account_id has no foreign key, and accounts
 * with entries could be deleted before the delete was blocked (audit A6). Such an entry moved no
 * balance that is still summed, so it moves no change either. The change comes back in cents.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER = 86;
const PROFILE = 860;
const GIRO = 8601;
const GONE = 8699;

let cookie = '';

beforeEach(async () => {
  for (const table of ['transactions', 'accounts']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).bind(PROFILE).run();
  }
  await env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'net-worth@example.test', 'password', 1, 'advanced')"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 999.7, 1000)"
    ).bind(GIRO, PROFILE),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

async function expenseOn(account: number, amount: number, date: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, account_id) VALUES (?, 'card', ?, ?, 'EUR', 'expense', ?, ?)"
  )
    .bind(PROFILE, amount, amount, date, account)
    .run();
}

describe('the change under Net Worth', () => {
  it('leaves out an entry whose account is gone, and comes back in cents', async () => {
    // 0.1 and 0.2 add up to 0.30000000000000004 in floating point.
    await expenseOn(GIRO, 0.1, '2025-03-04');
    await expenseOn(GIRO, 0.2, '2025-03-05');
    await expenseOn(GONE, 50, '2025-03-06');
    const res = await SELF.fetch('https://example.com/api/dashboard?month=3&year=2025', {
      headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balance: number; momBalanceDelta: number | null };
    expect(body.balance).toBe(999.7);
    expect(body.momBalanceDelta).toBe(-0.3);
  });
});
