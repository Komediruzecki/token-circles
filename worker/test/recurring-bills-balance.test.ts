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
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (5001, 500, 'Savings', 'savings', 'EUR', 500, 500)"
    ),
  ]);
  cookie = (await issueSessionCookie(50, 'password', env)).split(';')[0];
});

async function balanceOf(id: number): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ balance: number }>();
  return row?.balance ?? NaN;
}

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

  it('a transfer recurring with no destination leaves the balance untouched', async () => {
    const id = await createRecurring('transfer', 50, 'monthly');
    const pop = await api(`/api/recurring/${id}/populate`);
    expect(pop.status).toBe(200);
    // account_id set but no transfer_account_id → no leg to credit, so no change.
    expect(await balance()).toBeCloseTo(1000, 2);
  });

  it('a transfer recurring with From + To moves money two-legged', async () => {
    const created = await api('/api/recurring', {
      description: 'Monthly savings',
      amount: 200,
      type: 'transfer',
      account_id: 5000,
      transfer_account_id: 5001,
      frequency: 'monthly',
      next_date: today,
    });
    const recId = ((await created.json()) as { id: number }).id;
    const pop = await api(`/api/recurring/${recId}/populate`);
    expect(pop.status).toBe(200);
    expect(await balanceOf(5000)).toBeCloseTo(800, 2); // From 1000 - 200
    expect(await balanceOf(5001)).toBeCloseTo(700, 2); // To 500 + 200
  });

  it('create rejects a transfer_account_id owned by another profile', async () => {
    // Seed a second profile + account the caller (profile 500) does not own.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (501, 50, 'Other')"),
      env.DB.prepare(
        "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (5099, 501, 'Foreign', 'giro', 'EUR', 0, 0)"
      ),
    ]);
    const res = await api('/api/recurring', {
      description: 'IDOR transfer',
      amount: 10,
      type: 'transfer',
      account_id: 5000,
      transfer_account_id: 5099,
      frequency: 'monthly',
      next_date: today,
    });
    expect(res.status).toBe(403);
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
