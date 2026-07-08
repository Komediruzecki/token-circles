/**
 * Balance-integrity tests for recurring populate + bill mark-paid, run against the
 * real worker in workerd via Miniflare (D1 built from worker/migrations/, so it
 * includes 0017_add_account_id).
 *
 * Regression net for the two money-corruption bugs fixed with the atomic
 * balance-update work:
 *  - a transfer-type recurring must NOT one-legged-debit its account (money vanish);
 *  - a daily recurring must advance next_date on populate, so a second same-day
 *    populate hits the idempotency guard (409) instead of debiting again.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';
const today = new Date().toISOString().split('T')[0];

beforeEach(async () => {
  for (const t of ['transactions', 'recurring_transactions', 'bills', 'accounts', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (50, 'rec@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (500, 50, 'Main')"),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (5000, 500, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ),
  ]);
  cookie = (await issueSessionCookie(50, 'password', env)).split(';')[0];
});

function api(path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '500' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function balance(): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = 5000').first<{
    balance: number;
  }>();
  return row?.balance ?? NaN;
}

async function createRecurring(type: string, amount: number, frequency: string): Promise<number> {
  const res = await api('/api/recurring', {
    description: `${type} ${frequency}`,
    amount,
    type,
    account_id: 5000,
    frequency,
    next_date: today,
  });
  return ((await res.json()) as { id: number }).id;
}

describe('recurring populate + bill mark-paid balance integrity', () => {
  it('populating an expense recurring debits the linked account', async () => {
    const id = await createRecurring('expense', 50, 'monthly');
    const pop = await api(`/api/recurring/${id}/populate`);
    expect(pop.status).toBe(200);
    expect(await balance()).toBeCloseTo(950, 2);
  });

  it('a transfer recurring does not corrupt the balance (no one-legged debit)', async () => {
    const id = await createRecurring('transfer', 50, 'monthly');
    const pop = await api(`/api/recurring/${id}/populate`);
    expect(pop.status).toBe(200);
    // No destination account in the recurring model → balance must be untouched.
    expect(await balance()).toBeCloseTo(1000, 2);
  });

  it('a daily recurring advances next_date so a second same-day populate is a 409', async () => {
    const id = await createRecurring('expense', 10, 'daily');
    const first = await api(`/api/recurring/${id}/populate`);
    expect(first.status).toBe(200);
    expect(await balance()).toBeCloseTo(990, 2);

    // Pre-fix, next_date stalled at today and this re-populated (balance 980).
    const second = await api(`/api/recurring/${id}/populate`);
    expect(second.status).toBe(409);
    expect(await balance()).toBeCloseTo(990, 2);
  });

  it('marking a bill paid debits the account once; a second mark-paid is a 409', async () => {
    const created = await api('/api/bills', {
      name: 'Electric',
      amount: 100,
      account_id: 5000,
      frequency: 'monthly',
      dueDate: today,
    });
    const { id } = (await created.json()) as { id: number };

    const first = await api(`/api/bills/${id}/mark-paid`);
    expect(first.status).toBe(200);
    expect(await balance()).toBeCloseTo(900, 2);

    const second = await api(`/api/bills/${id}/mark-paid`);
    expect(second.status).toBe(409);
    expect(await balance()).toBeCloseTo(900, 2);
  });
});
