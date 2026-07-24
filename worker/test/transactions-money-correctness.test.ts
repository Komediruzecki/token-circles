/**
 * Regression tests for the audit "money correctness" batch, run against the real worker in
 * workerd/Miniflare with a local D1 built from worker/migrations/.
 *   - D1: a bulk `type` change must correct the denormalized account balance.
 *   - D2: a transfer must have a destination account (create + update), otherwise the source
 *         debit removes money that is credited nowhere.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

async function reset(): Promise<void> {
  for (const t of [
    'transactions',
    'accounts',
    'categories',
    'savings_goals',
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
const balanceOf = async (id: number): Promise<number> =>
  (await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ balance: number }>())!.balance;
const idOf = async (res: Response): Promise<number> => ((await res.json()) as { id: number }).id;

describe('worker transactions — transfer destination required (audit D2)', () => {
  it('rejects a transfer created without a destination account', async () => {
    const res = await post({
      description: 'To nowhere',
      amount: 250,
      type: 'transfer',
      account_id: 1,
    });
    expect(res.status).toBe(400);
    // The source balance must be untouched — no silent loss.
    expect(await balanceOf(1)).toBe(1000);
  });

  it('rejects destination-only and same-account transfers', async () => {
    const destinationOnly = await post({
      description: 'From nowhere',
      amount: 250,
      type: 'transfer',
      transfer_account_id: 2,
    });
    expect(destinationOnly.status).toBe(400);
    const self = await post({
      description: 'Self transfer',
      amount: 250,
      type: 'transfer',
      account_id: 1,
      transfer_account_id: 1,
    });
    expect(self.status).toBe(400);
    expect(await balanceOf(1)).toBe(1000);
    expect(await balanceOf(2)).toBe(500);
  });

  it('rejects a negative expense before it can credit the source account', async () => {
    const res = await post({
      description: 'Wrong sign',
      amount: -25,
      type: 'expense',
      account_id: 1,
    });
    expect(res.status).toBe(400);
    expect(await balanceOf(1)).toBe(1000);
  });

  it('accepts a transfer with a destination and moves both balances', async () => {
    const res = await post({
      description: 'Move to savings',
      amount: 200,
      type: 'transfer',
      account_id: 1,
      transfer_account_id: 2,
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(800);
    expect(await balanceOf(2)).toBe(700);
  });

  it('rejects updating a transfer to drop its destination', async () => {
    const id = await idOf(
      await post({
        description: 'Move',
        amount: 100,
        type: 'transfer',
        account_id: 1,
        transfer_account_id: 2,
      })
    );
    const res = await api(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ transfer_account_id: null }),
    });
    expect(res.status).toBe(400);
    // Balances stay at the valid transfer's state (1000-100, 500+100).
    expect(await balanceOf(1)).toBe(900);
    expect(await balanceOf(2)).toBe(600);
  });

  it('rejects flipping an expense to a transfer without a destination', async () => {
    const id = await idOf(
      await post({
        description: 'Lunch',
        amount: 40,
        type: 'expense',
        account_id: 1,
        category_id: 1,
      })
    );
    const res = await api(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'transfer' }),
    });
    expect(res.status).toBe(400);
  });

  it('clears a stale destination when a transfer becomes an expense', async () => {
    const id = await idOf(
      await post({
        description: 'Move',
        amount: 100,
        type: 'transfer',
        account_id: 1,
        transfer_account_id: 2,
      })
    );
    const res = await api(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'expense' }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT type, transfer_account_id FROM transactions WHERE id = ?'
    )
      .bind(id)
      .first<{ type: string; transfer_account_id: number | null }>();
    expect(row).toEqual({ type: 'expense', transfer_account_id: null });
    expect(await balanceOf(1)).toBe(900);
    expect(await balanceOf(2)).toBe(500);
  });
});

describe('worker transactions — bulk type change corrects balances (audit D1)', () => {
  it('rejects bulk conversion to transfer because no account pair is supplied', async () => {
    const id = await idOf(
      await post({ description: 'Lunch', amount: 20, type: 'expense', account_id: 1 })
    );
    const res = await api('/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [id], action: 'update', data: { type: 'transfer' } }),
    });
    expect(res.status).toBe(400);
    expect(await balanceOf(1)).toBe(980);
  });

  it('reverses the old effect and applies the new on a bulk income→expense flip', async () => {
    const id = await idOf(
      await post({ description: 'Paycheck', amount: 100, type: 'income', account_id: 1 })
    );
    expect(await balanceOf(1)).toBe(1100); // income applied

    const res = await api('/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [id], action: 'update', data: { type: 'expense' } }),
    });
    expect(res.status).toBe(200);
    // income +100 reversed, expense -100 applied → 1100 - 200 = 900.
    expect(await balanceOf(1)).toBe(900);
  });

  it('corrects balances for several transactions at once', async () => {
    const a = await idOf(
      await post({ description: 'i1', amount: 50, type: 'income', account_id: 1 })
    );
    const b = await idOf(
      await post({ description: 'i2', amount: 30, type: 'income', account_id: 1 })
    );
    expect(await balanceOf(1)).toBe(1080);

    const res = await api('/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [a, b], action: 'update', data: { type: 'expense' } }),
    });
    expect(res.status).toBe(200);
    // (1000 +50 +30) then flip both: -2*50 -2*30 = -160 → 1080 - 160 = 920.
    expect(await balanceOf(1)).toBe(920);
  });

  it('leaves balances unchanged for a bulk update that does not touch type', async () => {
    const id = await idOf(
      await post({
        description: 'Lunch',
        amount: 40,
        type: 'expense',
        account_id: 1,
        category_id: 1,
      })
    );
    expect(await balanceOf(1)).toBe(960);
    const res = await api('/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [id], action: 'update', data: { notes: 'tagged' } }),
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(960);
  });
});
