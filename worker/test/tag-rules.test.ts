/**
 * Tag rules end-to-end against the real worker: rules CRUD, dry-run preview, applying a rule to
 * pre-existing transactions, auto-apply on create, and the summary endpoints.
 *
 * The point of these tests is that the Worker and the local IndexedDB runtime share
 * shared/tagRules.ts, so the same assertions hold in
 * frontend/src/core/storage/__tests__/localHandlers.tagRules.test.ts.
 *
 * Runs against workerd via Miniflare (D1 from worker/migrations/). Worker deps can't install in
 * the CI sandbox — run locally with `pnpm -C worker test`.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 810;
const PROFILE = 8100;
const OTHER_USER = 811;
const OTHER_PROFILE = 8110;
let cookie = '';

beforeEach(async () => {
  for (const t of [
    'transaction_tags',
    'tag_rules',
    'tags',
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'tags@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'other@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Main'
    ),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      OTHER_PROFILE,
      OTHER_USER,
      'Theirs'
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (10, ?, 'Software', 'expense', '#111')"
    ).bind(PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (11, ?, 'Food', 'expense', '#222')"
    ).bind(PROFILE),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function call(
  path: string,
  init: { method?: string; body?: unknown; profile?: number } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-Profile-Id': String(init.profile ?? PROFILE),
  };
  return SELF.fetch(`https://example.com${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function createTag(name = 'Company'): Promise<number> {
  const res = await call('/api/tags', { method: 'POST', body: { name, color: '#6e9bff' } });
  expect(res.status).toBe(200);
  return (await res.json<{ id: number }>()).id;
}

/** Insert a transaction directly so tests can seed history without the create route. */
async function seedTransaction(patch: {
  description?: string;
  amount?: number;
  date?: string;
  type?: string;
  category_id?: number | null;
}): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO transactions (description, amount, date, type, category_id, profile_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      patch.description ?? 'Generic',
      patch.amount ?? 100,
      patch.date ?? '2026-03-15',
      patch.type ?? 'expense',
      patch.category_id ?? null,
      PROFILE
    )
    .run();
  return res.meta.last_row_id as number;
}

async function tagIdsFor(transactionId: number): Promise<number[]> {
  const { results } = await env.DB.prepare(
    'SELECT tag_id FROM transaction_tags WHERE transaction_id = ? ORDER BY tag_id'
  )
    .bind(transactionId)
    .all<{ tag_id: number }>();
  return (results ?? []).map((r) => r.tag_id);
}

/** Seed many identical transactions quickly (for the >100-match scan/link paths). */
async function seedMany(count: number, description: string, date = '2026-03-15'): Promise<void> {
  for (let start = 0; start < count; start += 50) {
    const stmts = [];
    for (let i = start; i < Math.min(start + 50, count); i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO transactions (description, amount, date, type, profile_id) VALUES (?, 10, ?, 'expense', ?)"
        ).bind(description, date, PROFILE)
      );
    }
    await env.DB.batch(stmts);
  }
}

describe('tag rules', () => {
  it('creates, lists, updates and deletes a rule', async () => {
    const tagId = await createTag();
    const created = await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: tagId, name: 'AWS spend', criteria: { description: 'aws' } },
    });
    expect(created.status).toBe(201);
    const rule = await created.json<{
      id: number;
      criteria: { description: string };
      auto_apply: boolean;
    }>();
    // The create response echoes parsed criteria, matching GET and the local runtime.
    expect(rule.criteria.description).toBe('aws');
    expect(rule.auto_apply).toBe(true);

    const list = await (
      await call('/api/tags/rules')
    ).json<
      { id: number; name: string; auto_apply: boolean; criteria: { description: string } }[]
    >();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('AWS spend');
    expect(list[0].criteria.description).toBe('aws');
    expect(list[0].auto_apply).toBe(true);

    const updated = await call(`/api/tags/rules/${rule.id}`, {
      method: 'PUT',
      body: { name: 'Cloud spend', criteria: { description: 'aws' }, auto_apply: false },
    });
    expect(updated.status).toBe(200);
    const afterUpdate = await (
      await call('/api/tags/rules')
    ).json<{ name: string; auto_apply: boolean }[]>();
    expect(afterUpdate[0].name).toBe('Cloud spend');
    expect(afterUpdate[0].auto_apply).toBe(false);

    expect((await call(`/api/tags/rules/${rule.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await call('/api/tags/rules')).json()).toHaveLength(0);
  });

  it('routes the literal /rules segment ahead of /:id', async () => {
    // A regression guard: if /api/tags/:id were registered first, 'rules' would be read as an id.
    const res = await call('/api/tags/rules');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('rejects a rule pointing at another user’s tag', async () => {
    await env.DB.prepare(
      "INSERT INTO tags (id, profile_id, name, color) VALUES (999, ?, 'Foreign', '#fff')"
    )
      .bind(OTHER_PROFILE)
      .run();

    const res = await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: 999, criteria: { description: 'x' } },
    });
    expect(res.status).toBe(404);
    expect(await (await call('/api/tags/rules')).json()).toHaveLength(0);
  });

  it('requires a tag id', async () => {
    const res = await call('/api/tags/rules', {
      method: 'POST',
      body: { criteria: { description: 'x' } },
    });
    expect(res.status).toBe(400);
  });

  it('previews matches without writing anything', async () => {
    const tagId = await createTag();
    const awsId = await seedTransaction({ description: 'AWS invoice' });
    await seedTransaction({ description: 'Groceries' });

    const preview = await (
      await call('/api/tags/rules/preview', {
        method: 'POST',
        body: { tag_id: tagId, criteria: { description: 'aws' } },
      })
    ).json<{ matched: number; new_matches: number; already_tagged: number; sample: unknown[] }>();
    expect(preview.matched).toBe(1);
    expect(preview.new_matches).toBe(1);
    expect(preview.already_tagged).toBe(0);
    expect(preview.sample).toHaveLength(1);

    expect(await tagIdsFor(awsId)).toEqual([]);
  });

  it('applies a rule to pre-existing transactions and is idempotent', async () => {
    const tagId = await createTag();
    const a = await seedTransaction({ description: 'AWS invoice' });
    const b = await seedTransaction({ description: 'AWS support' });
    const c = await seedTransaction({ description: 'Groceries' });

    const first = await (
      await call(`/api/tags/${tagId}/apply`, {
        method: 'POST',
        body: { criteria: { description: 'aws' } },
      })
    ).json<{ matched: number; tagged: number }>();
    expect(first).toMatchObject({ matched: 2, tagged: 2 });

    const second = await (
      await call(`/api/tags/${tagId}/apply`, {
        method: 'POST',
        body: { criteria: { description: 'aws' } },
      })
    ).json<{ matched: number; tagged: number }>();
    expect(second).toMatchObject({ matched: 2, tagged: 0 });

    expect(await tagIdsFor(a)).toEqual([tagId]);
    expect(await tagIdsFor(b)).toEqual([tagId]);
    expect(await tagIdsFor(c)).toEqual([]);
  });

  it('applies the tag’s saved rules when no criteria are supplied', async () => {
    const tagId = await createTag();
    const software = await seedTransaction({ description: 'AWS invoice', category_id: 10 });
    const food = await seedTransaction({ description: 'Groceries', category_id: 11 });
    await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { categoryIds: [10] } },
    });

    const result = await (
      await call(`/api/tags/${tagId}/apply`, { method: 'POST', body: {} })
    ).json<{
      matched: number;
      tagged: number;
    }>();
    expect(result).toMatchObject({ matched: 1, tagged: 1 });
    expect(await tagIdsFor(software)).toEqual([tagId]);
    expect(await tagIdsFor(food)).toEqual([]);
  });

  it('refuses to apply when the tag has no rules', async () => {
    const tagId = await createTag();
    const res = await call(`/api/tags/${tagId}/apply`, { method: 'POST', body: {} });
    expect(res.status).toBe(400);
  });

  it('narrows the scan by the structural conditions', async () => {
    // Mirror of the IndexedDB test of the same name — the two runtimes must scan the same window,
    // which is what keeps them tagging the same rows once a ledger passes TAG_RULE_SCAN_LIMIT.
    const tagId = await createTag();
    await seedTransaction({ description: 'Old company spend', date: '2020-01-05' });
    await seedTransaction({ description: 'Company laptop', date: '2026-03-01' });
    await seedTransaction({ description: 'Company lunch', date: '2026-03-02' });

    const preview = await (
      await call('/api/tags/rules/preview', {
        method: 'POST',
        body: { tag_id: tagId, criteria: { description: 'company', dateFrom: '2026-01-01' } },
      })
    ).json<{ matched: number; scanned: number }>();
    expect(preview).toMatchObject({ matched: 2, scanned: 2 });

    const anyPreview = await (
      await call('/api/tags/rules/preview', {
        method: 'POST',
        body: {
          tag_id: tagId,
          criteria: { match: 'any', description: 'company', dateFrom: '2026-01-01' },
        },
      })
    ).json<{ matched: number; scanned: number }>();
    expect(anyPreview).toMatchObject({ matched: 3, scanned: 3 });
  });

  it('applies a rule selecting many categories and accounts', async () => {
    // D1 rejects a statement binding more than 100 variables ("too many SQL variables"). The SQL
    // pushdown binds profile_id + dates + types + every category id + every account id TWICE (it
    // checks account_id OR transfer_account_id), so a wide rule blew the ceiling and 500-d the
    // apply. The pushdown is only ever a pre-filter, so it must drop clauses that don't fit rather
    // than emit an oversized statement.
    const tagId = await createTag();
    const stmts = [];
    for (let i = 0; i < 50; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, ?, 'expense', '#333')"
        ).bind(500 + i, PROFILE, `Cat ${i}`)
      );
    }
    for (let i = 0; i < 25; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO accounts (id, profile_id, name, type, balance) VALUES (?, ?, ?, 'giro', 0)"
        ).bind(600 + i, PROFILE, `Acct ${i}`)
      );
    }
    await env.DB.batch(stmts);

    const hit = await seedTransaction({ description: 'Wide rule hit', category_id: 500 });
    await env.DB.prepare('UPDATE transactions SET account_id = 600 WHERE id = ?').bind(hit).run();
    const miss = await seedTransaction({ description: 'Wide rule miss', category_id: 11 });

    const criteria = {
      match: 'all',
      types: ['income', 'expense', 'transfer', 'deduction'],
      categoryIds: Array.from({ length: 50 }, (_, i) => 500 + i),
      accountIds: Array.from({ length: 25 }, (_, i) => 600 + i),
      dateFrom: '2020-01-01',
      dateTo: '2030-12-31',
    };

    const preview = await call('/api/tags/rules/preview', {
      method: 'POST',
      body: { tag_id: tagId, criteria },
    });
    expect(preview.status).toBe(200);
    await expect(preview.json<{ matched: number }>()).resolves.toMatchObject({ matched: 1 });

    const applied = await call(`/api/tags/${tagId}/apply`, { method: 'POST', body: { criteria } });
    expect(applied.status).toBe(200);
    await expect(applied.json<{ matched: number; tagged: number }>()).resolves.toMatchObject({
      matched: 1,
      tagged: 1,
    });
    // Correctness is unchanged by which clauses were pushed down — the shared matcher decides.
    expect(await tagIdsFor(hit)).toEqual([tagId]);
    expect(await tagIdsFor(miss)).toEqual([]);
  });

  it('never sweeps the ledger with an empty rule', async () => {
    const tagId = await createTag();
    const a = await seedTransaction({ description: 'AWS invoice' });

    const preview = await (
      await call('/api/tags/rules/preview', {
        method: 'POST',
        body: { tag_id: tagId, criteria: {} },
      })
    ).json<{ matched: number }>();
    expect(preview.matched).toBe(0);

    const applied = await (
      await call(`/api/tags/${tagId}/apply`, { method: 'POST', body: { criteria: {} } })
    ).json<{ matched: number; tagged: number }>();
    expect(applied).toMatchObject({ matched: 0, tagged: 0 });
    expect(await tagIdsFor(a)).toEqual([]);
  });

  it('auto-applies rules to transactions created afterwards', async () => {
    const tagId = await createTag();
    await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { description: 'aws' }, auto_apply: true },
    });

    const res = await call('/api/transactions', {
      method: 'POST',
      body: { description: 'AWS invoice', amount: 20, date: '2026-04-01', type: 'expense' },
    });
    expect(res.status).toBe(200);
    const created = await res.json<{ id: number }>();
    expect(await tagIdsFor(created.id)).toEqual([tagId]);
  });

  it('does not auto-apply a rule with auto_apply off', async () => {
    const tagId = await createTag();
    await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { description: 'aws' }, auto_apply: false },
    });

    const created = await (
      await call('/api/transactions', {
        method: 'POST',
        body: { description: 'AWS invoice', amount: 20, date: '2026-04-01', type: 'expense' },
      })
    ).json<{ id: number }>();
    expect(await tagIdsFor(created.id)).toEqual([]);
  });

  it('deleting a tag removes its rules', async () => {
    const tagId = await createTag();
    await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { description: 'aws' } },
    });

    expect((await call(`/api/tags/${tagId}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await call('/api/tags/rules')).json()).toHaveLength(0);
  });
});

describe('tag summaries', () => {
  it('summarizes every tag by type and honours the date window', async () => {
    const tagId = await createTag();
    await seedTransaction({ description: 'Company laptop', amount: 300, type: 'expense' });
    await seedTransaction({
      description: 'Company refund',
      amount: 120,
      type: 'income',
      date: '2026-04-02',
    });
    await call('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { description: 'company' } },
    });
    await call(`/api/tags/${tagId}/apply`, { method: 'POST', body: {} });

    const all = await (
      await call('/api/tags/summary')
    ).json<{ expense: number; income: number; net: number; count: number; rule_count: number }[]>();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      expense: 300,
      income: 120,
      net: -180,
      count: 2,
      rule_count: 1,
    });

    const windowed = await (
      await call('/api/tags/summary?startDate=2026-04-01&endDate=2026-04-30')
    ).json<{ income: number; expense: number; count: number }[]>();
    expect(windowed[0]).toMatchObject({ income: 120, expense: 0, count: 1 });
  });

  it('returns a monthly series and category breakdown for one tag', async () => {
    const tagId = await createTag();
    await seedTransaction({
      description: 'Company laptop',
      amount: 300,
      category_id: 10,
      date: '2026-03-15',
    });
    await seedTransaction({
      description: 'Company lunch',
      amount: 40,
      category_id: 11,
      date: '2026-04-02',
    });
    await call(`/api/tags/${tagId}/apply`, {
      method: 'POST',
      body: { criteria: { description: 'company' } },
    });

    const detail = await (
      await call(`/api/tags/${tagId}/summary`)
    ).json<{
      tag: { name: string };
      totals: { expense: number };
      monthly: { month: string; expense: number }[];
      categories: { name: string }[];
    }>();
    expect(detail.tag.name).toBe('Company');
    expect(detail.totals.expense).toBe(340);
    expect(detail.monthly.map((m) => m.month)).toEqual(['2026-03', '2026-04']);
    expect(detail.monthly[0].expense).toBe(300);
    expect(detail.categories.map((c) => c.name)).toEqual(['Software', 'Food']);
  });

  it('404s the detail summary for another user’s tag', async () => {
    await env.DB.prepare(
      "INSERT INTO tags (id, profile_id, name, color) VALUES (999, ?, 'Foreign', '#fff')"
    )
      .bind(OTHER_PROFILE)
      .run();
    expect((await call('/api/tags/999/summary')).status).toBe(404);
    expect(
      (
        await call('/api/tags/999/apply', {
          method: 'POST',
          body: { criteria: { description: 'x' } },
        })
      ).status
    ).toBe(404);
  });

  // ── Large-scan / bound-variable regressions ────────────────────────────────

  it('applies a rule matching 100+ transactions without tripping the SQL variable limit', async () => {
    // Regression: the "already tagged" COUNT binds tag_id PLUS a chunk of ids. At a 100-id chunk
    // that is 101 binds — over D1's ceiling — and used to 500 exactly on the "apply to all" case.
    const tagId = await createTag();
    await seedMany(105, 'AWS invoice');

    const applied = await call(`/api/tags/${tagId}/apply`, {
      method: 'POST',
      body: { criteria: { description: 'aws' } },
    });
    expect(applied.status).toBe(200);
    expect(await applied.json<{ matched: number; tagged: number }>()).toMatchObject({
      matched: 105,
      tagged: 105,
    });

    // Preview over the same 100+ set runs the same COUNT loop and must also succeed.
    const preview = await call('/api/tags/rules/preview', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { description: 'aws' } },
    });
    expect(preview.status).toBe(200);
    expect((await preview.json<{ already_tagged: number }>()).already_tagged).toBe(105);
  });

  it('narrows a single-rule date range on the day, matching rows that carry a time component', async () => {
    // Regression: the SQL pushdown compared the raw date column while the matcher slices to the
    // day, so '2026-01-15T10:30:00Z' was dropped from a dateTo of '2026-01-15' — a divergence from
    // the local runtime, which scans in memory.
    const tagId = await createTag();
    const withTime = await seedTransaction({ description: 'Timed', date: '2026-01-15T10:30:00Z' });
    const plain = await seedTransaction({ description: 'Plain', date: '2026-01-15' });
    const after = await seedTransaction({ description: 'After', date: '2026-01-16' });

    const applied = await call(`/api/tags/${tagId}/apply`, {
      method: 'POST',
      body: { criteria: { dateFrom: '2026-01-15', dateTo: '2026-01-15' } },
    });
    expect(await applied.json<{ matched: number; tagged: number }>()).toMatchObject({
      matched: 2,
      tagged: 2,
    });
    expect(await tagIdsFor(withTime)).toEqual([tagId]);
    expect(await tagIdsFor(plain)).toEqual([tagId]);
    expect(await tagIdsFor(after)).toEqual([]);
  });

  // ── Bulk tag / untag (selection-bar action) ────────────────────────────────

  it('bulk-adds a tag additively and idempotently', async () => {
    const company = await createTag('Company');
    const travel = await createTag('Travel');
    const t1 = await seedTransaction({ description: 'A' });
    const t2 = await seedTransaction({ description: 'B' });
    const t3 = await seedTransaction({ description: 'C' });
    await call(`/api/tags/${travel}/transactions`, {
      method: 'POST',
      body: { transactionIds: [t1], mode: 'add' },
    });

    const res = await call(`/api/tags/${company}/transactions`, {
      method: 'POST',
      body: { transactionIds: [t1, t2], mode: 'add' },
    });
    expect(
      await res.json<{ ok: boolean; mode: string; matched: number; added: number }>()
    ).toMatchObject({ ok: true, mode: 'add', matched: 2, added: 2 });

    expect(await tagIdsFor(t1)).toEqual([company, travel].sort((a, b) => a - b));
    expect(await tagIdsFor(t2)).toEqual([company]);
    expect(await tagIdsFor(t3)).toEqual([]);

    const again = await call(`/api/tags/${company}/transactions`, {
      method: 'POST',
      body: { transactionIds: [t1, t2], mode: 'add' },
    });
    expect((await again.json<{ added: number }>()).added).toBe(0);
  });

  it('bulk-removes only the given tag, leaving others intact', async () => {
    const company = await createTag('Company');
    const travel = await createTag('Travel');
    const t1 = await seedTransaction({ description: 'A' });
    const t2 = await seedTransaction({ description: 'B' });
    await call(`/api/tags/${company}/transactions`, {
      method: 'POST',
      body: { transactionIds: [t1, t2], mode: 'add' },
    });
    await call(`/api/tags/${travel}/transactions`, {
      method: 'POST',
      body: { transactionIds: [t1], mode: 'add' },
    });

    const res = await call(`/api/tags/${company}/transactions`, {
      method: 'POST',
      body: { transactionIds: [t1, t2], mode: 'remove' },
    });
    expect(await res.json<{ matched: number; removed: number }>()).toMatchObject({
      matched: 2,
      removed: 2,
    });
    expect(await tagIdsFor(t1)).toEqual([travel]);
    expect(await tagIdsFor(t2)).toEqual([]);
  });

  it('never bulk-tags another profile’s transaction', async () => {
    const company = await createTag('Company');
    const { meta } = await env.DB.prepare(
      "INSERT INTO transactions (description, amount, date, type, profile_id) VALUES ('Foreign', 10, '2026-03-15', 'expense', ?)"
    )
      .bind(OTHER_PROFILE)
      .run();
    const foreignId = meta.last_row_id as number;

    const res = await call(`/api/tags/${company}/transactions`, {
      method: 'POST',
      body: { transactionIds: [foreignId], mode: 'add' },
    });
    expect(await res.json<{ matched: number; added: number }>()).toMatchObject({
      matched: 0,
      added: 0,
    });
    expect(await tagIdsFor(foreignId)).toEqual([]);
  });

  it('404s bulk tagging with another profile’s tag', async () => {
    await env.DB.prepare(
      "INSERT INTO tags (id, profile_id, name, color) VALUES (999, ?, 'Foreign', '#fff')"
    )
      .bind(OTHER_PROFILE)
      .run();
    const t1 = await seedTransaction({ description: 'A' });
    expect(
      (
        await call('/api/tags/999/transactions', {
          method: 'POST',
          body: { transactionIds: [t1], mode: 'add' },
        })
      ).status
    ).toBe(404);
  });

  it('rejects an empty id list for bulk tagging', async () => {
    const company = await createTag('Company');
    expect(
      (
        await call(`/api/tags/${company}/transactions`, {
          method: 'POST',
          body: { transactionIds: [], mode: 'add' },
        })
      ).status
    ).toBe(400);
  });
});
