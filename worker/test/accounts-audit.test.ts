/**
 * Worker coverage for the account audit fixes, run against the REAL worker in workerd via
 * Miniflare, backed by a local D1 built from worker/migrations/.
 *   A6 — DELETE /api/accounts/:id is blocked (409) while referenced by a transaction
 *        (source or transfer destination); its own balance history cascades; unreferenced deletes work.
 *   A1/D3 — POST /api/accounts/recompute-balances repairs a corrupted balance to
 *        starting_balance + ledger.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

async function reset(): Promise<void> {
  for (const t of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (1, 'tester@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (1, 'Primary', 1)"),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (1, 'Checking', 'giro', 1000, 1000, 1)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (2, 'Savings', 'savings', 500, 500, 1)"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, name, type, profile_id) VALUES (1, 'Food', 'expense', 1)"
    ),
  ]);
}

let cookie = '';

beforeEach(async () => {
  await reset();
  await seed();
  const setCookie = await issueSessionCookie(1, 'password', env);
  cookie = setCookie.split(';')[0];
});

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '1',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

const post = (body: unknown) =>
  api('/api/transactions', { method: 'POST', body: JSON.stringify(body) });

async function balanceOf(id: number): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ balance: number }>();
  return row!.balance;
}
async function accountExists(id: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?').bind(id).first();
  return row !== null;
}

describe('worker accounts — deletion blocked while referenced (audit A6)', () => {
  it('rejects deleting an account referenced by a transaction (409) and keeps it', async () => {
    await post({
      description: 'Lunch',
      amount: 100,
      type: 'expense',
      account_id: 1,
      category_id: 1,
    });
    const res = await api('/api/accounts/1', { method: 'DELETE' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/reassign or delete/i);
    expect(await accountExists(1)).toBe(true);
  });

  it('rejects deleting an account referenced as a transfer destination', async () => {
    await post({
      description: 'Move',
      amount: 50,
      type: 'transfer',
      account_id: 1,
      transfer_account_id: 2,
    });
    const res = await api('/api/accounts/2', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await accountExists(2)).toBe(true);
  });

  it('deletes an account with only balance-history rows, cascading the snapshots', async () => {
    const rec = await api('/api/accounts/2/history', {
      method: 'POST',
      body: JSON.stringify({ balance: 600 }),
    });
    expect(rec.status).toBe(200);
    const res = await api('/api/accounts/2', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await accountExists(2)).toBe(false);
    const hist = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM account_balance_history WHERE account_id = 2'
    ).first<{ n: number }>();
    expect(hist?.n).toBe(0);
  });

  it('deletes an unreferenced account', async () => {
    const res = await api('/api/accounts/2', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await accountExists(2)).toBe(false);
  });

  it('404s a nonexistent account', async () => {
    const res = await api('/api/accounts/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('worker accounts — recompute balances repair (audit A1/D3)', () => {
  it('repairs corrupted balances to starting_balance + ledger', async () => {
    await post({ description: 'e', amount: 100, type: 'expense', account_id: 1, category_id: 1 });
    await post({ description: 'i', amount: 200, type: 'income', account_id: 2 });
    await post({
      description: 't',
      amount: 75,
      type: 'transfer',
      account_id: 1,
      transfer_account_id: 2,
    });
    // acc1 = 1000 - 100 - 75 = 825 ; acc2 = 500 + 200 + 75 = 775
    expect(await balanceOf(1)).toBe(825);
    expect(await balanceOf(2)).toBe(775);

    // Corrupt stored balances.
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET balance = 999999 WHERE id = 1'),
      env.DB.prepare('UPDATE accounts SET balance = -42 WHERE id = 2'),
    ]);

    const res = await api('/api/accounts/recompute-balances', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recomputed: number };
    expect(body.ok).toBe(true);
    expect(body.recomputed).toBe(2);

    expect(await balanceOf(1)).toBe(825);
    expect(await balanceOf(2)).toBe(775);
  });

  it('requires auth', async () => {
    const res = await SELF.fetch('https://example.com/api/accounts/recompute-balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
    });
    expect(res.status).toBe(401);
  });
});
