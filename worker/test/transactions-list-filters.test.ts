/**
 * `GET /api/transactions` — the filter contract, and what `total` means.
 *
 * Two things are pinned here.
 *
 * **The parameter names.** The handler reads `startDate`, `endDate` and `category_ids`. The
 * frontend used to send `date_from`, `date_to` and `category_id`, and an unrecognised query
 * parameter is not an error — the WHERE clause is simply never built, so the request returned the
 * whole profile and looked like it had worked. Nothing on either side failed loudly, which is how
 * it survived. These tests assert from the worker's side that the names it documents are the ones
 * that actually narrow the result, so a future rename cannot quietly reintroduce the gap.
 *
 * **`total` without a window.** The handler used to run a second `COUNT(*)` over the same filtered
 * set on every request. Unwindowed, that recounts exactly the rows just returned — and the app's
 * main list is unwindowed and re-reads after every mutation, so it ran on every create, edit and
 * delete. It is skipped now, and `total` must still be right in both shapes.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

async function reset(): Promise<void> {
  for (const t of ['transactions', 'accounts', 'categories', 'profiles', 'users']) {
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
      "INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (1, 'Checking', 'giro', 0, 0, 1)"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, name, type, profile_id) VALUES (1, 'Food', 'expense', 1), (2, 'Rent', 'expense', 1)"
    ),
    // Three months, two categories. Every filter below picks a strict subset, so a filter that is
    // silently ignored returns 3 and fails loudly.
    env.DB
      .prepare(`INSERT INTO transactions (id, date, description, amount, type, account_id, category_id, profile_id) VALUES
      (1, '2026-01-15', 'January food',  10, 'expense', 1, 1, 1),
      (2, '2026-02-15', 'February rent', 20, 'expense', 1, 2, 1),
      (3, '2026-03-15', 'March food',    30, 'expense', 1, 1, 1)`),
  ]);
}

let cookie = '';

beforeEach(async () => {
  await reset();
  await seed();
  cookie = (await issueSessionCookie(1, 'password', env)).split(';')[0];
});

type ListBody = { rows: { id: number }[]; total: number; limit: number; offset: number };

async function list(query = ''): Promise<ListBody> {
  const res = await SELF.fetch(`https://example.com/api/transactions${query}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': '1' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

const ids = (b: ListBody) => b.rows.map((r) => r.id).sort((x, y) => x - y);

describe('GET /api/transactions — filters actually narrow', () => {
  it('returns everything when unfiltered', async () => {
    expect(ids(await list())).toEqual([1, 2, 3]);
  });

  it('narrows on startDate/endDate', async () => {
    expect(ids(await list('?startDate=2026-02-01&endDate=2026-02-28'))).toEqual([2]);
    expect(ids(await list('?startDate=2026-02-01'))).toEqual([2, 3]);
    expect(ids(await list('?endDate=2026-01-31'))).toEqual([1]);
  });

  it('narrows on category_ids, single and comma-separated', async () => {
    expect(ids(await list('?category_ids=1'))).toEqual([1, 3]);
    expect(ids(await list('?category_ids=1,2'))).toEqual([1, 2, 3]);
  });

  it('ignores the OLD frontend names instead of narrowing — the bug, pinned', async () => {
    // Not aspirational: this documents that the worker has no such parameters, which is exactly
    // why sending them returned the entire profile. If someone ever adds `date_from` as an alias,
    // this test should be deleted deliberately rather than discovered by a user.
    expect(ids(await list('?date_from=2026-02-01&date_to=2026-02-28'))).toEqual([1, 2, 3]);
    expect(ids(await list('?category_id=1'))).toEqual([1, 2, 3]);
  });
});

describe('GET /api/transactions — total', () => {
  it('reports the full count without a window, without a second COUNT query', async () => {
    const body = await list();
    expect(body.total).toBe(3);
    // Unwindowed, the contract is that `limit` echoes the total (the handler's own convention).
    expect(body.limit).toBe(3);
    expect(body.offset).toBe(0);
  });

  it('still reports the FILTERED total, not the table size, when unwindowed', async () => {
    // The skip returns rows.length — which is only correct because it is the length of the
    // filtered set. A filter plus no window must not report 3.
    const body = await list('?category_ids=1');
    expect(body.total).toBe(2);
  });

  it('reports the count of the whole set — not the page — when a window IS given', async () => {
    const body = await list('?limit=1');
    expect(body.rows).toHaveLength(1);
    expect(body.total).toBe(3);
  });

  it('counts the whole filtered set behind an offset, where rows.length would be wrong', async () => {
    // The case the `!limit && !offset` test exists for: with an offset alone, the returned rows
    // start past the beginning, so their length is genuinely not the total.
    const body = await list('?offset=2');
    expect(body.rows).toHaveLength(1);
    expect(body.total).toBe(3);
  });

  it('combines a filter and a window correctly', async () => {
    const body = await list('?category_ids=1&limit=1');
    expect(body.rows).toHaveLength(1);
    expect(body.total).toBe(2);
  });
});
