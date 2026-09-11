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
import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeTagRuleCriteria, transactionMatchesTagRule } from '../../shared/tagRules';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import app from '../src/index';
import { openRows, sealForInsert } from '../src/sealed-rows';
import { autoApplyTagRules } from '../src/tag-rules';

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

  it('explains a 0-match rule by counting each condition separately', async () => {
    // Mirror of the IndexedDB test of the same name. The reported confusion: description clearly
    // matches a transaction, yet the rule finds nothing, because a category chip left selected
    // ANDs the result to zero with nothing on screen saying so.
    const tagId = await createTag();
    await seedTransaction({ description: 'Feedbackqueue', category_id: 11 });

    const preview = await (
      await call('/api/tags/rules/preview', {
        method: 'POST',
        body: {
          tag_id: tagId,
          criteria: { description: 'Feedbackqueue', categoryIds: [10] },
        },
      })
    ).json<{ matched: number; conditions: { key: string; matched: number }[] }>();

    expect(preview.matched).toBe(0);
    const byKey = Object.fromEntries(preview.conditions.map((c) => [c.key, c.matched]));
    expect(byKey.description).toBe(1); // the text condition is fine on its own...
    expect(byKey.categories).toBe(0); // ...the category is what zeroes the rule
  });

  it('omits the breakdown when the rule matched something', async () => {
    const tagId = await createTag();
    await seedTransaction({ description: 'Feedbackqueue', category_id: 10 });
    const preview = await (
      await call('/api/tags/rules/preview', {
        method: 'POST',
        body: { tag_id: tagId, criteria: { description: 'Feedbackqueue', categoryIds: [10] } },
      })
    ).json<{ matched: number; conditions: unknown[] }>();
    expect(preview.matched).toBe(1);
    expect(preview.conditions).toEqual([]);
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

// ── Sealed text (field encryption) ───────────────────────────────────────────
// These force a master key whatever mode the suite runs in, and drive the Worker through
// app.fetch with it. Their user only ever goes through KEYED. The ledger mixes rows sealed under
// that user's key with rows still at text_enc 0 (the backfill has not reached them), and every
// answer is checked against the shared matcher run over the same rows in plaintext.
describe('tag rules over sealed text', () => {
  const KEK = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const KEYED = { ...env, DATA_KEK_1: KEK };
  const S_USER = 54000;
  const S_PROFILE = 54000;
  const S_SOFTWARE = 54010;
  const S_FOOD = 54011;
  let sealedCookie = '';

  interface LedgerRow {
    sealed: boolean;
    description: string;
    beneficiary?: string;
    payor?: string;
    notes?: string;
    category_id?: number;
    amount?: number;
    type?: string;
    date: string;
  }

  // Newest first with distinct dates, so ledger order is the scan's order (date DESC, id DESC).
  const LEDGER: LedgerRow[] = [
    {
      sealed: true,
      description: 'AWS invoice',
      beneficiary: 'Cloud Vendor Inc',
      notes: 'team account',
      category_id: S_SOFTWARE,
      date: '2026-03-09',
    },
    {
      sealed: false,
      description: 'AWS console credits',
      category_id: S_SOFTWARE,
      date: '2026-03-08',
    },
    {
      sealed: true,
      description: 'Weekly shop',
      beneficiary: 'Corner Grocer Ltd',
      notes: 'groceries',
      category_id: S_FOOD,
      date: '2026-03-07',
    },
    {
      sealed: false,
      description: 'Bakery',
      payor: 'Corner Grocer refund desk',
      category_id: S_FOOD,
      date: '2026-03-06',
    },
    {
      sealed: true,
      description: 'Rent March',
      beneficiary: 'Example Landlord',
      amount: 900,
      date: '2026-03-05',
    },
    {
      sealed: false,
      description: 'rent deposit back',
      amount: 50,
      type: 'income',
      date: '2026-03-04',
    },
    {
      sealed: true,
      description: 'Salary',
      payor: 'Acme Payroll',
      amount: 3000,
      type: 'income',
      date: '2026-03-03',
    },
    { sealed: true, description: 'Coffee', date: '2026-03-02' },
  ];

  function plainOf(row: LedgerRow): Record<string, unknown> {
    return {
      profile_id: S_PROFILE,
      description: row.description,
      beneficiary: row.beneficiary ?? '',
      payor: row.payor ?? '',
      notes: row.notes ?? '',
      category_id: row.category_id ?? null,
      amount: row.amount ?? 20,
      type: row.type ?? 'expense',
      date: row.date,
    };
  }

  async function insertRow(values: Record<string, unknown>): Promise<number> {
    const cols = Object.keys(values);
    const res = await env.DB.prepare(
      `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
      .bind(...cols.map((col) => values[col]))
      .run();
    return Number(res.meta.last_row_id);
  }

  /** Seeds LEDGER: sealed rows through sealForInsert, the rest raw at text_enc 0. */
  async function seedLedger(): Promise<number[]> {
    const ring = new DataKeyring(KEYED);
    const ids: number[] = [];
    for (const row of LEDGER) {
      const plain = plainOf(row);
      ids.push(
        await insertRow(
          row.sealed ? await sealForInsert(ring, S_USER, 'transactions', plain) : plain
        )
      );
    }
    return ids;
  }

  /** What the shared matcher says over the plaintext ledger, in scan order. */
  function expectedIds(ids: number[], criteriaList: unknown[]): number[] {
    const parsed = criteriaList.map(normalizeTagRuleCriteria);
    return LEDGER.flatMap((row, i) =>
      parsed.some((criteria) => transactionMatchesTagRule(plainOf(row), criteria)) ? [ids[i]] : []
    );
  }

  async function keyedCall(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    return app.fetch(
      new Request(`https://example.com${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Cookie: sealedCookie,
          'Content-Type': 'application/json',
          'X-Profile-Id': String(S_PROFILE),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      KEYED,
      createExecutionContext()
    );
  }

  async function keyedTag(name: string): Promise<number> {
    const res = await keyedCall('/api/tags', { method: 'POST', body: { name, color: '#6e9bff' } });
    expect(res.status).toBe(200);
    return (await res.json<{ id: number }>()).id;
  }

  async function taggedIds(tagId: number): Promise<number[]> {
    const { results } = await env.DB.prepare(
      'SELECT transaction_id FROM transaction_tags WHERE tag_id = ? ORDER BY transaction_id'
    )
      .bind(tagId)
      .all<{ transaction_id: number }>();
    return results.map((r) => r.transaction_id);
  }

  interface Preview {
    matched: number;
    sample: Record<string, unknown>[];
    conditions: { key: string; matched: number }[];
  }

  async function preview(tagId: number, criteria: unknown): Promise<Preview> {
    const res = await keyedCall('/api/tags/rules/preview', {
      method: 'POST',
      body: { tag_id: tagId, criteria },
    });
    expect(res.status).toBe(200);
    return res.json<Preview>();
  }

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sealed-tags@example.com', 'password', 1)"
      ).bind(S_USER),
      env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
        S_PROFILE,
        S_USER,
        'Sealed'
      ),
      env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Software', 'expense', '#111')"
      ).bind(S_SOFTWARE, S_PROFILE),
      env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Food', 'expense', '#222')"
      ).bind(S_FOOD, S_PROFILE),
    ]);
    sealedCookie = (await issueSessionCookie(S_USER, 'password', env)).split(';')[0];
  });

  it('previews over a mix of sealed and plaintext rows exactly as over plaintext', async () => {
    const ids = await seedLedger();
    for (const [i, row] of LEDGER.entries()) {
      const stored = await env.DB.prepare(
        'SELECT description, text_enc FROM transactions WHERE id = ?'
      )
        .bind(ids[i])
        .first<{ description: string; text_enc: number }>();
      expect(stored!.text_enc).toBe(row.sealed ? 1 : 0);
      if (row.sealed) expect(stored!.description.startsWith('tc1.')).toBe(true);
      else expect(stored!.description).toBe(row.description);
    }

    const tagId = await keyedTag('Sealed preview');
    const cases: Record<string, unknown>[] = [
      { description: 'aws' },
      // Every sealed value starts "tc1." — a matcher handed ciphertext would hit all five.
      { description: 'tc1' },
      { description: 'TC1.', descriptionMode: 'starts_with' },
      { counterparty: 'grocer' },
      { notes: 'groceries' },
      { description: 'rent', descriptionMode: 'starts_with' },
      { description: 'salary', descriptionMode: 'equals' },
      { description: 'ce', descriptionMode: 'ends_with' },
      { match: 'any', categoryIds: [S_FOOD], description: 'aws' },
      { types: ['expense'], description: 'rent' },
      { amountMin: 100, counterparty: 'landlord' },
      { match: 'any', amountMin: 1000, notes: 'team' },
      { categoryIds: [S_SOFTWARE] },
    ];
    for (const criteria of cases) {
      const want = expectedIds(ids, [criteria]);
      const got = await preview(tagId, criteria);
      expect({ criteria, matched: got.matched }).toEqual({ criteria, matched: want.length });
      expect(got.sample.map((row) => row.id)).toEqual(want.slice(0, 10));
      for (const row of got.sample) {
        expect(row.description).toBe(LEDGER[ids.indexOf(row.id as number)].description);
        expect('text_enc' in row).toBe(false);
      }
    }
    expect((await preview(tagId, { description: 'tc1' })).matched).toBe(0);
    expect((await preview(tagId, { description: 'aws' })).matched).toBe(2);
  });

  it('applies saved rules OR-ed together, tagging only what plaintext would', async () => {
    const ids = await seedLedger();
    const tagId = await keyedTag('Sealed apply');
    const rules = [
      { categoryIds: [S_SOFTWARE] },
      { types: ['expense'], description: 'rent' },
      { match: 'any', amountMin: 1000, counterparty: 'grocer' },
      { description: 'tc1' },
    ];
    for (const criteria of rules) {
      const res = await keyedCall('/api/tags/rules', {
        method: 'POST',
        body: { tag_id: tagId, criteria },
      });
      expect(res.status).toBe(201);
    }
    const want = expectedIds(ids, rules);
    expect(want).toHaveLength(6);
    const res = await keyedCall(`/api/tags/${tagId}/apply`, { method: 'POST', body: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ matched: 6, tagged: 6 });
    expect(await taggedIds(tagId)).toEqual([...want].sort((a, b) => a - b));

    // An unsaved rule that only ciphertext could satisfy tags nothing.
    const probe = await keyedTag('Probe');
    const probed = await keyedCall(`/api/tags/${probe}/apply`, {
      method: 'POST',
      body: { criteria: { description: 'tc1' } },
    });
    expect(await probed.json()).toMatchObject({ matched: 0, tagged: 0 });
    expect(await taggedIds(probe)).toEqual([]);
  });

  it('explains a 0-match rule with per-condition counts over opened text', async () => {
    const ids = await seedLedger();
    const tagId = await keyedTag('Sealed explain');
    for (const criteria of [
      { description: 'aws', categoryIds: [S_FOOD] },
      { counterparty: 'grocer', notes: 'team' },
    ]) {
      const got = await preview(tagId, criteria);
      expect(got.matched).toBe(0);
      const byKey = Object.fromEntries(got.conditions.map((c) => [c.key, c.matched]));
      for (const [key, value] of Object.entries(criteria)) {
        const conditionKey = key === 'categoryIds' ? 'categories' : key;
        expect(byKey[conditionKey]).toBe(expectedIds(ids, [{ [key]: value }]).length);
      }
    }
    const got = await preview(tagId, { counterparty: 'grocer', notes: 'team' });
    expect(Object.fromEntries(got.conditions.map((c) => [c.key, c.matched]))).toEqual({
      counterparty: 2,
      notes: 1,
    });
  });

  it('lists a tag’s transactions with their text opened and no marker', async () => {
    await seedLedger();
    const tagId = await keyedTag('Sealed list');
    await keyedCall(`/api/tags/${tagId}/apply`, {
      method: 'POST',
      body: { criteria: { description: 'aws' } },
    });
    const res = await keyedCall(`/api/transactions/by-tag/${tagId}`);
    expect(res.status).toBe(200);
    const { rows, total } = await res.json<{ rows: Record<string, unknown>[]; total: number }>();
    expect(total).toBe(2);
    expect(rows.map((r) => r.description)).toEqual(['AWS invoice', 'AWS console credits']);
    expect(rows[0]).toMatchObject({
      beneficiary: 'Cloud Vendor Inc',
      payor: '',
      notes: 'team account',
      category_name: 'Software',
    });
    for (const row of rows) expect('text_enc' in row).toBe(false);
  });

  it('fails closed when a sealed value cannot be opened', async () => {
    const ids = await seedLedger();
    const stored = await env.DB.prepare('SELECT description FROM transactions WHERE id = ?')
      .bind(ids[0])
      .first<{ description: string }>();
    const s = stored!.description;
    const tampered = s.slice(0, 10) + (s[10] === 'A' ? 'B' : 'A') + s.slice(11);
    await env.DB.prepare('UPDATE transactions SET description = ? WHERE id = ?')
      .bind(tampered, ids[0])
      .run();

    const tagId = await keyedTag('Tampered');
    const previewed = await keyedCall('/api/tags/rules/preview', {
      method: 'POST',
      body: { tag_id: tagId, criteria: { description: 'aws' } },
    });
    expect(previewed.status).toBe(500);
    const applied = await keyedCall(`/api/tags/${tagId}/apply`, {
      method: 'POST',
      body: { criteria: { description: 'aws' } },
    });
    expect(applied.status).toBe(500);
    expect(await taggedIds(tagId)).toEqual([]);
  });

  it('auto-apply never matches text that is still sealed', async () => {
    const ids = await seedLedger();
    // The rules below are saved through KEYED, so their criteria are sealed under K.
    const keys = { ring: new DataKeyring(KEYED), owner: S_USER };
    const probe = await keyedTag('Auto probe');
    await keyedCall('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: probe, criteria: { description: 'tc1' }, auto_apply: true },
    });
    const raw = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?')
      .bind(ids[0])
      .first<Record<string, unknown>>();
    expect(String(raw!.description).startsWith('tc1.')).toBe(true);
    expect(await autoApplyTagRules(env.DB, S_PROFILE, ids[0], raw!, keys)).toEqual([]);
    expect(await taggedIds(probe)).toEqual([]);

    // Opened, the same row is matched on its real text.
    const aws = await keyedTag('Auto AWS');
    await keyedCall('/api/tags/rules', {
      method: 'POST',
      body: { tag_id: aws, criteria: { description: 'aws' }, auto_apply: true },
    });
    const [opened] = await openRows(new DataKeyring(KEYED), S_USER, 'transactions', [raw!]);
    expect(await autoApplyTagRules(env.DB, S_PROFILE, ids[0], opened, keys)).toEqual([aws]);

    // Plaintext that merely starts with "tc1." is text, and matches like any other.
    const lookalike = await insertRow({ ...plainOf(LEDGER[7]), description: 'tc1. token refill' });
    const row = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?')
      .bind(lookalike)
      .first<Record<string, unknown>>();
    expect(await autoApplyTagRules(env.DB, S_PROFILE, lookalike, row!, keys)).toEqual([probe]);
  });
});
