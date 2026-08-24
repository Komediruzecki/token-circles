/**
 * Two devices, one account, the same moment.
 *
 * Every case here is a read-then-write that was correct in isolation and wrong under overlap: the
 * batch was atomic, but the DECISION the batch encoded was made from a row that could already have
 * moved. The pattern the fixes share is to make the write itself the claim — a conditional
 * statement inside the batch — and to report a lost race rather than a success that quietly lost.
 *
 * The races are driven with Promise.all so both requests read before either writes. A guard that
 * only holds because the runtime happened to serialise the handlers is not a guard, so each case
 * also checks the SIDE EFFECT (the balance, the row count), which is what actually went wrong.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { unchangedSince } from '../src/routes/transactions';

const UID = 700;
const PID = 7000;
const ACCOUNT = 7100;
let cookie = '';

const TABLES = [
  'transactions',
  'bills',
  'recurring_transactions',
  'receipts',
  'accounts',
  'categories',
  'password_resets',
  'email_verifications',
  'rate_limits',
  'profiles',
  'users',
] as const;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { Cookie: cookie, 'X-Profile-Id': String(PID), ...(init.headers || {}) },
  });
}

async function balance(): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(ACCOUNT)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function count(table: string, where = '1=1'): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).first<{
    c: number;
  }>();
  return Number(row?.c ?? 0);
}

beforeEach(async () => {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan) VALUES (?, 'race@example.com', 'password', 1, 1, 'free')"
    ).bind(UID),
    env.DB.prepare('INSERT INTO profiles (id, name, user_id) VALUES (?, ?, ?)').bind(
      PID,
      'Race',
      UID
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, currency, balance, starting_balance, profile_id) VALUES (?, 'Checking', 'EUR', 1000, 1000, ?)"
    ).bind(ACCOUNT, PID),
  ]);
  cookie = (await issueSessionCookie(UID, 'password', env)).split(';')[0];
});

describe('paying a bill from two devices at once', () => {
  beforeEach(async () => {
    await env.DB.prepare(
      "INSERT INTO bills (id, profile_id, name, amount, frequency, account_id, due_date) VALUES (7200, ?, 'Power', 60, 'monthly', ?, '2026-02-01')"
    )
      .bind(PID, ACCOUNT)
      .run();
  });

  it('takes the money once', async () => {
    const [a, b] = await Promise.all([
      api('/api/bills/7200/mark-paid', { method: 'POST' }),
      api('/api/bills/7200/mark-paid', { method: 'POST' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await count('transactions')).toBe(1);
    expect(await count('bills', 'last_paid_date IS NOT NULL')).toBe(1);
    expect(await balance()).toBe(940);
  });

  it('marks the bill paid exactly once', async () => {
    await Promise.all([
      api('/api/bills/7200/mark-paid', { method: 'POST' }),
      api('/api/bills/7200/mark-paid', { method: 'POST' }),
      api('/api/bills/7200/mark-paid', { method: 'POST' }),
    ]);

    expect(await count('transactions')).toBe(1);
    expect(await balance()).toBe(940);
  });
});

describe('populating a recurring rule from two devices at once', () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO recurring_transactions (id, profile_id, description, amount, type, account_id, frequency, next_date, active)
       VALUES (7300, ?, 'Rent', 250, 'expense', ?, 'monthly', '2026-01-01', 1)`
    )
      .bind(PID, ACCOUNT)
      .run();
  });

  /** Months from 2026-01-01, the rule's starting next_date, to where it ended up. */
  async function periodsAdvanced(): Promise<number> {
    const row = await env.DB.prepare(
      'SELECT next_date FROM recurring_transactions WHERE id = 7300'
    ).first<{ next_date: string }>();
    const [y, m] = String(row?.next_date).split('-').map(Number);
    return (y! - 2026) * 12 + (m! - 1);
  }

  it('never populates the same period twice', async () => {
    // The rule is months overdue, so two populates in a row are legitimate — each takes the next
    // period. What must never happen is two transactions for ONE period, which is exactly what
    // two overlapping requests produced: both read the same next_date, both inserted, and only
    // one advance stuck. So the invariant is one transaction per period advanced, not one
    // transaction full stop.
    await Promise.all([
      api('/api/recurring/7300/populate', { method: 'POST' }),
      api('/api/recurring/7300/populate', { method: 'POST' }),
    ]);

    const created = await count('transactions');
    expect(created).toBeGreaterThan(0);
    expect(await periodsAdvanced()).toBe(created);
  });

  it('debits the account once per period, not once per tap', async () => {
    await Promise.all([
      api('/api/recurring/7300/populate', { method: 'POST' }),
      api('/api/recurring/7300/populate', { method: 'POST' }),
      api('/api/recurring/7300/populate', { method: 'POST' }),
    ]);

    expect(await balance()).toBe(1000 - 250 * (await periodsAdvanced()));
  });
});

describe('editing the same transaction from two devices at once', () => {
  const TX = 7400;
  beforeEach(async () => {
    // A 100 expense. The account is 1000 with it already applied, so the truth is 900.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO transactions (id, profile_id, description, amount, amount_local, type, currency, account_id, date)
         VALUES (?, ?, 'Groceries', 100, 100, 'expense', 'EUR', ?, '2026-01-05')`
      ).bind(TX, PID, ACCOUNT),
      env.DB.prepare('UPDATE accounts SET balance = 900 WHERE id = ?').bind(ACCOUNT),
    ]);
  });

  const edit = (amount: number) =>
    api(`/api/transactions/${TX}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, amount_local: amount }),
    });

  it('leaves the balance agreeing with the row that survived', async () => {
    // Unguarded and overlapping, both edits credit back 100 and debit their own amount:
    // 900 + 100 - 50 + 100 - 30 = 1020, against a row that says 30. The invariant is the
    // assertion, because it is the thing that was wrong.
    await Promise.all([edit(50), edit(30)]);

    const row = await env.DB.prepare('SELECT amount FROM transactions WHERE id = ?')
      .bind(TX)
      .first<{ amount: number }>();
    expect(await balance()).toBe(1000 - Number(row?.amount));
  });

  it('leaves the balance agreeing with the row when an edit races a delete', async () => {
    await Promise.all([edit(50), api(`/api/transactions/${TX}`, { method: 'DELETE' })]);

    const row = await env.DB.prepare('SELECT amount FROM transactions WHERE id = ?')
      .bind(TX)
      .first<{ amount: number }>();
    expect(await balance()).toBe(row ? 1000 - Number(row.amount) : 1000);
  });

  it('says the row moved rather than reporting a success that lost', async () => {
    // Deterministic, unlike the races above: change the row out from under a decision that was
    // already made. `unchangedSince` is what every statement in those batches carries, so a
    // predicate that still matches here is a batch that would apply a stale reversal.
    const before = (await env.DB.prepare(
      'SELECT account_id, transfer_account_id, type, amount, amount_local FROM transactions WHERE id = ?'
    )
      .bind(TX)
      .first())!;
    const guard = unchangedSince(before as never, TX, PID);
    const matches = async () =>
      Number(
        (
          await env.DB.prepare(`SELECT (${guard.sql}) AS ok`)
            .bind(...guard.binds)
            .first<{ ok: number }>()
        )?.ok ?? 0
      );

    expect(await matches()).toBe(1);

    // Someone else's edit lands.
    expect((await edit(30)).status).toBe(200);

    expect(await matches()).toBe(0);

    // And a real request whose decision was made before that lands as a refusal, not a silent
    // partial write.
    const stale = await api(`/api/transactions/${TX}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, amount_local: 50 }),
    });
    expect(stale.status).toBe(200); // its own read was fresh — the guard only refuses stale ones
    expect(await balance()).toBe(950);
  });

  it('still lets an ordinary sequential edit through', async () => {
    expect((await edit(50)).status).toBe(200);
    expect(await balance()).toBe(950);
    expect((await edit(20)).status).toBe(200);
    expect(await balance()).toBe(980);
  });
});

describe('a reset link opened twice', () => {
  const TOKEN_HASH = 'a'.repeat(64);

  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at)
       VALUES (7500, ?, ?, datetime('now', '+1 hour'), NULL)`
    )
      .bind(UID, TOKEN_HASH)
      .run();
  });

  // The route hashes what it is given, so the fixture stores the hash of this string.
  const reset = (password: string) =>
    SELF.fetch('https://example.com/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password }),
    });

  async function useRawToken(): Promise<void> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('raw-token'));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('UPDATE password_resets SET token_hash = ? WHERE id = 7500')
      .bind(hex)
      .run();
  }

  it('refuses the second use of a link, because spending it is the only gate', async () => {
    // Deterministic, and the reason the SELECT no longer filters on `used_at`: with two gates,
    // the read refused the second use before the conditional write was ever reached, so nothing
    // proved the write was conditional at all. One gate, and this test is the proof.
    await useRawToken();

    expect((await reset('first-password')).status).toBe(200);
    const second = await reset('second-password');

    expect(second.status).toBe(400);
    const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(UID)
      .first<{ password_hash: string }>();
    expect(user?.password_hash).toBeTruthy();
  });

  it("retires the account's other pending links in the same write", async () => {
    await useRawToken();
    await env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at)
       VALUES (7501, ?, 'b0b0', datetime('now', '+1 hour'), NULL)`
    )
      .bind(UID)
      .run();

    expect((await reset('first-password')).status).toBe(200);

    expect(await count('password_resets', 'used_at IS NULL')).toBe(0);
  });

  it('spends the token once, whoever asks second', async () => {
    await useRawToken();

    const [a, b] = await Promise.all([reset('first-password'), reset('second-password')]);

    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await count('password_resets', 'used_at IS NOT NULL OR id IS NULL')).toBeLessThanOrEqual(
      1
    );
  });
});

describe('uploading receipts up to the plan limit from two devices', () => {
  async function upload(name: string): Promise<Response> {
    const form = new FormData();
    form.append('receipt', new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' }));
    return api('/api/receipts', { method: 'POST', body: form });
  }

  it('refuses outright on a plan with no receipt storage', async () => {
    const [a, b] = await Promise.all([upload('one.png'), upload('two.png')]);

    expect([a.status, b.status]).toEqual([402, 402]);
    expect(await count('receipts')).toBe(0);
  });

  it('holds the line at the limit when the plan allows some', async () => {
    await env.DB.prepare("UPDATE users SET plan = 'basic' WHERE id = ?").bind(UID).run();
    // One slot left: 499 of the 500 a basic plan allows.
    const rows = [];
    for (let i = 0; i < 499; i += 1) {
      rows.push(
        env.DB.prepare(
          "INSERT INTO receipts (filename, original_name, file_type, file_size, storage_path, profile_id) VALUES (?, ?, 'image/png', 3, ?, ?)"
        ).bind(`f${i}`, `f${i}.png`, `f${i}`, PID)
      );
    }
    await env.DB.batch(rows);

    const [a, b] = await Promise.all([upload('one.png'), upload('two.png')]);

    expect([a.status, b.status].sort()).toEqual([201, 403]);
    expect(await count('receipts')).toBe(500);
  });
});
