/**
 * End-to-end balance-integrity tests for the transactions Worker, run against the REAL worker
 * (src/index.ts) in workerd via Miniflare, backed by a local D1 built from worker/migrations/.
 *
 * This is the regression net for the atomic-balance fix (fix/worker-atomic-balance): every
 * money-mutating handler now applies its row change + balance side effects as one
 * `c.env.DB.batch([...])` instead of a sequence of independent `db.run()` calls. These tests
 * exercise the handlers through genuine authenticated HTTP requests (a real minted session
 * cookie) and assert account balances read straight from D1.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// ── seeding / helpers ─────────────────────────────────────────────────────────
async function reset(): Promise<void> {
  // singleWorker + isolatedStorage:false means one shared D1; wipe app data before each test.
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
  // One user, two profiles they own, two accounts + a category on profile 1.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (1, 'tester@example.com', 'password', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id) VALUES (1, 'Primary', 1), (2, 'Second', 1)"
    ),
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
  // Mint a genuine session cookie (reads token_version from D1, signs with env.JWT_SECRET) —
  // the same path the OAuth/login flow uses, so requireAuth accepts it end-to-end.
  const setCookie = await issueSessionCookie(1, 'password', env);
  cookie = setCookie.split(';')[0]; // "fm_session=<jwt>"
});

function api(
  path: string,
  init: RequestInit = {},
  opts: { profileIds?: number[] } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-Profile-Id': '1',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (opts.profileIds) headers['X-Profile-Ids'] = JSON.stringify(opts.profileIds);
  return SELF.fetch(`https://example.com${path}`, { ...init, headers });
}

const post = (body: unknown, opts?: { profileIds?: number[] }) =>
  api('/api/transactions', { method: 'POST', body: JSON.stringify(body) }, opts);

async function balanceOf(id: number): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ balance: number }>();
  return row!.balance;
}
async function txCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM transactions').first<{ c: number }>();
  return row!.c;
}
const createdId = async (res: Response): Promise<number> =>
  ((await res.json()) as { id: number }).id;

// ── tests ─────────────────────────────────────────────────────────────────────
describe('worker transactions — account balance integrity (D1 batch)', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await SELF.fetch('https://example.com/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
      body: JSON.stringify({ description: 'x', amount: 1, type: 'expense', account_id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('expense decrements the linked account', async () => {
    const res = await post({
      description: 'Lunch',
      amount: 100,
      type: 'expense',
      account_id: 1,
      category_id: 1,
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(900);
  });

  it('income increments the linked account', async () => {
    const res = await post({ description: 'Paycheck', amount: 200, type: 'income', account_id: 1 });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(1200);
  });

  it('transfer moves money between the two accounts', async () => {
    const res = await post({
      description: 'Move',
      amount: 300,
      type: 'transfer',
      account_id: 1,
      transfer_account_id: 2,
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(700);
    expect(await balanceOf(2)).toBe(800);
  });

  it('rejects a transfer with only a destination account', async () => {
    const res = await post({
      description: 'Incoming',
      amount: 250,
      type: 'transfer',
      transfer_account_id: 2,
    });
    expect(res.status).toBe(400);
    expect(await balanceOf(2)).toBe(500);
  });

  it('create succeeds with multiple selected profiles (X-Profile-Ids)', async () => {
    const res = await post(
      { description: 'Multi', amount: 150, type: 'expense', account_id: 1, category_id: 1 },
      { profileIds: [1, 2] }
    );
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(850);
  });

  it('updating the amount reverses the old effect and applies the new one', async () => {
    const id = await createdId(
      await post({ description: 'Groceries', amount: 100, type: 'expense', account_id: 1 })
    );
    expect(await balanceOf(1)).toBe(900);
    const res = await api(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ amount: 30 }),
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(970); // +100 reversal, -30 re-apply
  });

  it('changing an expense to income flips the balance effect', async () => {
    const id = await createdId(
      await post({ description: 'Refundable', amount: 100, type: 'expense', account_id: 1 })
    );
    const res = await api(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'income' }),
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(1100); // +100 reversal, +100 income re-apply
  });

  it('PUT on a foreign/nonexistent id is a 404 and leaves balances untouched', async () => {
    const res = await api('/api/transactions/99999', {
      method: 'PUT',
      body: JSON.stringify({ amount: 10 }),
    });
    expect(res.status).toBe(404);
    expect(await balanceOf(1)).toBe(1000);
    expect(await balanceOf(2)).toBe(500);
  });

  it('deleting a transaction reverses its balance effect', async () => {
    const id = await createdId(
      await post({ description: 'Toaster', amount: 100, type: 'expense', account_id: 1 })
    );
    expect(await balanceOf(1)).toBe(900);
    const res = await api(`/api/transactions/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(1000);
    expect(await txCount()).toBe(0);
  });

  it('deleting a legacy destination-only transfer reverses its historical credit', async () => {
    const inserted = await env.DB.prepare(
      `INSERT INTO transactions
         (profile_id, description, amount, type, transfer_account_id, date)
       VALUES (1, 'Legacy incoming', 250, 'transfer', 2, '2026-01-01')`
    ).run();
    const id = Number(inserted.meta.last_row_id);
    await env.DB.prepare('UPDATE accounts SET balance = 750 WHERE id = 2').run();
    expect(await balanceOf(2)).toBe(750);
    const res = await api(`/api/transactions/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await balanceOf(2)).toBe(500);
  });

  it('bulk delete reverses every row and removes them', async () => {
    const a = await createdId(
      await post({ description: 'a', amount: 100, type: 'expense', account_id: 1 })
    );
    const b = await createdId(
      await post({ description: 'b', amount: 50, type: 'income', account_id: 1 })
    );
    expect(await balanceOf(1)).toBe(950); // 1000 - 100 + 50
    const res = await api('/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [a, b], action: 'delete' }),
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(1000);
    expect(await txCount()).toBe(0);
  });

  it('delete-all resets every account balance to its starting balance', async () => {
    await post({ description: 'x', amount: 400, type: 'expense', account_id: 1 });
    await post({ description: 'y', amount: 100, type: 'income', account_id: 2 });
    expect(await balanceOf(1)).toBe(600);
    expect(await balanceOf(2)).toBe(600);
    const res = await api('/api/transactions', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await balanceOf(1)).toBe(1000);
    expect(await balanceOf(2)).toBe(500);
    expect(await txCount()).toBe(0);
  });

  // The fix's core assumption: a D1 batch is all-or-nothing. If a later statement fails, earlier
  // ones must NOT persist — which is what makes row + balance changes safe together.
  it('D1 batch is atomic: a failing statement rolls back the whole batch', async () => {
    const before = await txCount();
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO transactions (description, amount, date, type, profile_id) VALUES ('ok', 5, '2026-01-01', 'expense', 1)"
        ),
        // amount is NOT NULL — this second statement fails, so the first must roll back.
        env.DB.prepare(
          "INSERT INTO transactions (description, amount, date, type, profile_id) VALUES ('bad', ?, '2026-01-01', 'expense', 1)"
        ).bind(null),
      ])
    ).rejects.toThrow();
    expect(await txCount()).toBe(before);
  });
});
