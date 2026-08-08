import { Hono } from 'hono';
import type { Context } from 'hono';
import { normalizeTagRuleCriteria } from '../../../shared/tagRules';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { linkTransactionsToTag, listTagRules, matchTransactions } from '../tag-rules';

// Port of backend/routes/tags.js (tags CRUD + transaction tagging), plus the tag-rule engine
// (saved filters that attach a tag to matching transactions) and per-tag analytics.
const TAG_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
  '#a855f7',
];

export const tagsRoutes = new Hono<AppEnv>();

tagsRoutes.get('/api/tags', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all(
    c.env.DB,
    'SELECT id, name, color, created_at FROM tags WHERE profile_id = ? ORDER BY name',
    pid
  );
  return c.json(rows);
});

tagsRoutes.post('/api/tags', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) throw new HttpError(400, 'Tag name is required');
  const dupe = await db.first(
    c.env.DB,
    'SELECT id FROM tags WHERE name = ? AND profile_id = ?',
    name,
    pid
  );
  if (dupe) throw new HttpError(400, 'Tag already exists');
  let color = b.color;
  if (!color) {
    const row = await db.first<{ c: number }>(
      c.env.DB,
      'SELECT COUNT(*) AS c FROM tags WHERE profile_id = ?',
      pid
    );
    color = TAG_COLORS[(row?.c ?? 0) % TAG_COLORS.length];
  }
  const res = await db.insert(c.env.DB, 'tags', { name, color, profile_id: pid });
  return c.json({ id: res.meta.last_row_id, name, color });
});

// ── Tag rules & analytics ────────────────────────────────────────────────────
// Registered BEFORE the /:id routes so the literal 'rules' / 'summary' segments are never
// captured as an :id (same ordering rule as categories.ts /mappings).

/** Date-window helper shared by the summary endpoints. */
function dateWindow(c: Context<AppEnv>): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  // Compare the date part only, so an imported row carrying a time component (e.g.
  // '2024-03-31T12:00:00') is still counted within an endDate of '2024-03-31'. This matches the
  // IndexedDB runtime's summary window (which slices date to 10 chars), keeping cloud and local
  // totals identical. For the normal 'YYYY-MM-DD' rows substr() is a no-op.
  if (startDate) {
    parts.push('substr(t.date, 1, 10) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    parts.push('substr(t.date, 1, 10) <= ?');
    params.push(endDate);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

interface TypeTotals {
  income: number;
  expense: number;
  transfer: number;
  deduction: number;
  count: number;
}

function emptyTotals(): TypeTotals {
  return { income: 0, expense: 0, transfer: 0, deduction: 0, count: 0 };
}

function addTotals(totals: TypeTotals, type: string, total: number, count: number): void {
  if (type === 'income' || type === 'expense' || type === 'transfer' || type === 'deduction') {
    totals[type] += total;
  }
  totals.count += count;
}

/** Per-tag totals for the whole tag list — powers the Tags page overview. */
tagsRoutes.get('/api/tags/summary', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const window = dateWindow(c);
  const tags = await db.all<{ id: number; name: string; color: string }>(
    c.env.DB,
    'SELECT id, name, color FROM tags WHERE profile_id = ? ORDER BY name',
    pid
  );
  const rows = await db.all<{ tag_id: number; type: string; total: number; cnt: number }>(
    c.env.DB,
    `SELECT tt.tag_id AS tag_id, t.type AS type,
            SUM(COALESCE(t.amount_local, t.amount)) AS total, COUNT(*) AS cnt
     FROM transaction_tags tt
     JOIN transactions t ON t.id = tt.transaction_id
     JOIN tags g ON g.id = tt.tag_id
     WHERE g.profile_id = ? AND t.profile_id = ?${window.sql}
     GROUP BY tt.tag_id, t.type`,
    pid,
    pid,
    ...window.params
  );
  const ruleCounts = await db.all<{ tag_id: number; cnt: number }>(
    c.env.DB,
    'SELECT tag_id, COUNT(*) AS cnt FROM tag_rules WHERE profile_id = ? GROUP BY tag_id',
    pid
  );

  const byTag = new Map<number, TypeTotals>();
  for (const row of rows) {
    const totals = byTag.get(row.tag_id) ?? emptyTotals();
    addTotals(totals, row.type, Number(row.total) || 0, Number(row.cnt) || 0);
    byTag.set(row.tag_id, totals);
  }
  const rulesByTag = new Map(ruleCounts.map((r) => [r.tag_id, Number(r.cnt) || 0]));

  return c.json(
    tags.map((tag) => {
      const totals = byTag.get(tag.id) ?? emptyTotals();
      return {
        ...tag,
        ...totals,
        net: totals.income - totals.expense,
        rule_count: rulesByTag.get(tag.id) ?? 0,
      };
    })
  );
});

tagsRoutes.get('/api/tags/rules', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rules = await listTagRules(c.env.DB, pid);
  return c.json(rules);
});

/** Validate a rule body and return the normalized fields ready to persist. */
async function readRuleBody(
  c: Context<AppEnv>,
  pid: number,
  opts: { requireTag: boolean }
): Promise<{ tag_id?: number; name: string; criteria: string; auto_apply: number }> {
  const b = (await c.req.json()) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  const criteria = normalizeTagRuleCriteria(b.criteria);
  const auto_apply = b.auto_apply === false || b.auto_apply === 0 ? 0 : 1;

  let tag_id: number | undefined;
  if (b.tag_id !== undefined || opts.requireTag) {
    const parsed = Number(b.tag_id);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, 'tag_id is required');
    // Ownership check — a rule must never point at another tenant's tag.
    const tag = await db.first(
      c.env.DB,
      'SELECT id FROM tags WHERE id = ? AND profile_id = ?',
      parsed,
      pid
    );
    if (!tag) throw new HttpError(404, 'Tag not found');
    tag_id = parsed;
  }
  return { tag_id, name, criteria: JSON.stringify(criteria), auto_apply };
}

tagsRoutes.post('/api/tags/rules', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const { tag_id, name, criteria, auto_apply } = await readRuleBody(c, pid, { requireTag: true });
  const res = await db.insert(c.env.DB, 'tag_rules', {
    profile_id: pid,
    tag_id,
    name,
    criteria,
    auto_apply,
  });
  // Echo the parsed criteria, not the stored JSON string — GET /api/tags/rules and the local
  // runtime both return objects, and a client shouldn't have to branch on which call it made.
  return c.json(
    {
      id: res.meta.last_row_id,
      tag_id,
      name,
      criteria: normalizeTagRuleCriteria(criteria),
      auto_apply: auto_apply === 1,
    },
    201
  );
});

/**
 * Dry-run a criteria set: how many existing transactions it would tag, and a sample of them.
 * The Tags page calls this as the rule is edited so "apply to all previous transactions" is never
 * a blind bulk write.
 */
tagsRoutes.post('/api/tags/rules/preview', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, unknown>;
  const criteria = normalizeTagRuleCriteria(b.criteria);
  const { ids, scanned, truncated } = await matchTransactions(c.env.DB, pid, [criteria]);

  // How many matches the tag already covers, so the UI can show "N new".
  let alreadyTagged = 0;
  const tagId = Number(b.tag_id);
  if (Number.isInteger(tagId) && tagId > 0 && ids.length) {
    // Chunk at 90, not 100: this COUNT binds `tag_id` PLUS the id chunk, so a 100-id chunk would be
    // 101 binds — over D1's ~100 ceiling and a 500 exactly when a rule matches many rows.
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const row = await db.first<{ c: number }>(
        c.env.DB,
        `SELECT COUNT(*) AS c FROM transaction_tags WHERE tag_id = ? AND transaction_id IN (${chunk
          .map(() => '?')
          .join(',')})`,
        tagId,
        ...chunk
      );
      alreadyTagged += row?.c ?? 0;
    }
  }

  const sampleIds = ids.slice(0, 10);
  const sample = sampleIds.length
    ? await db.all(
        c.env.DB,
        `SELECT id, description, amount, date, type FROM transactions
         WHERE profile_id = ? AND id IN (${sampleIds.map(() => '?').join(',')})
         ORDER BY date DESC, id DESC`,
        pid,
        ...sampleIds
      )
    : [];

  return c.json({
    matched: ids.length,
    already_tagged: alreadyTagged,
    new_matches: ids.length - alreadyTagged,
    scanned,
    truncated,
    sample,
  });
});

tagsRoutes.put('/api/tags/rules/:ruleId', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const { tag_id, name, criteria, auto_apply } = await readRuleBody(c, pid, { requireTag: false });
  const data: Record<string, unknown> = { name, criteria, auto_apply };
  if (tag_id !== undefined) data.tag_id = tag_id;
  const res = await db.update(
    c.env.DB,
    'tag_rules',
    data,
    'id = ? AND profile_id = ?',
    c.req.param('ruleId'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Rule not found');
  return c.json({ ok: true });
});

tagsRoutes.delete('/api/tags/rules/:ruleId', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.del(
    c.env.DB,
    'tag_rules',
    'id = ? AND profile_id = ?',
    c.req.param('ruleId'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Rule not found');
  return c.json({ ok: true });
});

/**
 * Apply a tag's rules to transactions that already exist — the "tag everything historical that
 * matches this filter" action. Optional `criteria` in the body applies an unsaved rule instead of
 * the stored ones, so the page can offer "apply now" before the rule is saved.
 */
tagsRoutes.post('/api/tags/:id/apply', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const tagId = Number(c.req.param('id'));
  const tag = await db.first<{ id: number }>(
    c.env.DB,
    'SELECT id FROM tags WHERE id = ? AND profile_id = ?',
    tagId,
    pid
  );
  if (!tag) throw new HttpError(404, 'Tag not found');

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const criteriaList =
    body.criteria !== undefined
      ? [normalizeTagRuleCriteria(body.criteria)]
      : (await listTagRules(c.env.DB, pid, { tagId })).map((rule) => rule.criteria);

  if (!criteriaList.length) {
    throw new HttpError(400, 'This tag has no rules to apply');
  }

  const { ids, scanned, truncated } = await matchTransactions(c.env.DB, pid, criteriaList);
  const tagged = await linkTransactionsToTag(c.env.DB, tagId, ids);
  return c.json({ matched: ids.length, tagged, scanned, truncated });
});

/**
 * Bulk-tag an explicit set of transactions — the "Tag selected" action on the transactions page.
 * Additive, not a replace: `mode: 'add'` attaches this tag on top of whatever each row already has
 * (idempotent), `mode: 'remove'` detaches only this tag. Other tags on a row are untouched — unlike
 * PUT /api/transactions/:id/tags, which overwrites the whole set.
 */
tagsRoutes.post('/api/tags/:id/transactions', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const tagId = Number(c.req.param('id'));
  const tag = await db.first<{ id: number }>(
    c.env.DB,
    'SELECT id FROM tags WHERE id = ? AND profile_id = ?',
    tagId,
    pid
  );
  if (!tag) throw new HttpError(404, 'Tag not found');

  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = b.mode === 'remove' ? 'remove' : 'add';
  const rawIds = Array.isArray(b.transactionIds) ? b.transactionIds : [];
  const requested = [
    ...new Set(rawIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)),
  ];
  if (!requested.length) throw new HttpError(400, 'transactionIds must be a non-empty array');
  if (requested.length > 1000) {
    throw new HttpError(400, 'Cannot tag more than 1000 transactions at once');
  }

  // Only touch transactions that belong to THIS profile. linkTransactionsToTag does not scope by
  // profile (its rule-apply caller hands it an already-scoped id list), so a bulk endpoint taking
  // client-supplied ids must filter here — otherwise a caller could tag or untag another tenant's
  // rows. Chunk at 90 to keep the ownership IN-list under D1's ~100 bound-variable ceiling.
  const owned: number[] = [];
  for (let i = 0; i < requested.length; i += 90) {
    const chunk = requested.slice(i, i + 90);
    const rows = await db.all<{ id: number }>(
      c.env.DB,
      `SELECT id FROM transactions WHERE profile_id = ? AND id IN (${chunk.map(() => '?').join(',')})`,
      pid,
      ...chunk
    );
    for (const row of rows) owned.push(row.id);
  }

  if (mode === 'remove') {
    let removed = 0;
    for (let i = 0; i < owned.length; i += 90) {
      const chunk = owned.slice(i, i + 90);
      const res = await db.run(
        c.env.DB,
        `DELETE FROM transaction_tags WHERE tag_id = ? AND transaction_id IN (${chunk
          .map(() => '?')
          .join(',')})`,
        tagId,
        ...chunk
      );
      removed += res.meta.changes ?? 0;
    }
    return c.json({ ok: true, mode, matched: owned.length, removed });
  }

  const added = await linkTransactionsToTag(c.env.DB, tagId, owned);
  return c.json({ ok: true, mode, matched: owned.length, added });
});

/** Detail view for one tag: totals, monthly series, and a category breakdown. */
tagsRoutes.get('/api/tags/:id/summary', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const tagId = Number(c.req.param('id'));
  const tag = await db.first<{ id: number; name: string; color: string }>(
    c.env.DB,
    'SELECT id, name, color FROM tags WHERE id = ? AND profile_id = ?',
    tagId,
    pid
  );
  if (!tag) throw new HttpError(404, 'Tag not found');
  const window = dateWindow(c);

  const monthly = await db.all<{ month: string; type: string; total: number; cnt: number }>(
    c.env.DB,
    `SELECT substr(t.date, 1, 7) AS month, t.type AS type,
            SUM(COALESCE(t.amount_local, t.amount)) AS total, COUNT(*) AS cnt
     FROM transaction_tags tt
     JOIN transactions t ON t.id = tt.transaction_id
     WHERE tt.tag_id = ? AND t.profile_id = ?${window.sql}
     GROUP BY month, t.type
     ORDER BY month`,
    tagId,
    pid,
    ...window.params
  );

  const categories = await db.all<{
    category_id: number | null;
    name: string | null;
    color: string | null;
    type: string;
    total: number;
    cnt: number;
  }>(
    c.env.DB,
    `SELECT t.category_id AS category_id, cat.name AS name, cat.color AS color, t.type AS type,
            SUM(COALESCE(t.amount_local, t.amount)) AS total, COUNT(*) AS cnt
     FROM transaction_tags tt
     JOIN transactions t ON t.id = tt.transaction_id
     LEFT JOIN categories cat ON cat.id = t.category_id AND cat.profile_id = t.profile_id
     WHERE tt.tag_id = ? AND t.profile_id = ?${window.sql}
     GROUP BY t.category_id, cat.name, cat.color, t.type
     ORDER BY total DESC`,
    tagId,
    pid,
    ...window.params
  );

  const totals = emptyTotals();
  const months = new Map<string, TypeTotals>();
  for (const row of monthly) {
    const total = Number(row.total) || 0;
    const cnt = Number(row.cnt) || 0;
    addTotals(totals, row.type, total, cnt);
    const bucket = months.get(row.month) ?? emptyTotals();
    addTotals(bucket, row.type, total, cnt);
    months.set(row.month, bucket);
  }

  return c.json({
    tag,
    totals: { ...totals, net: totals.income - totals.expense },
    monthly: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({ month, ...values })),
    categories: categories.map((row) => ({
      category_id: row.category_id,
      name: row.name ?? 'Uncategorized',
      color: row.color ?? '#6b7280',
      type: row.type,
      total: Number(row.total) || 0,
      count: Number(row.cnt) || 0,
    })),
  });
});

tagsRoutes.get('/api/tags/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const tag = await db.first(
    c.env.DB,
    'SELECT id, name, color, created_at FROM tags WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!tag) throw new HttpError(404, 'Tag not found');
  return c.json(tag);
});

tagsRoutes.put('/api/tags/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) throw new HttpError(400, 'Tag name is required');
  const res = await db.update(
    c.env.DB,
    'tags',
    { name, color: b.color || '#6b7280' },
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

tagsRoutes.delete('/api/tags/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.del(c.env.DB, 'tags', 'id = ? AND profile_id = ?', c.req.param('id'), pid);
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  // tag_rules cascades on tag_id, but drop them explicitly so a deployment where D1 has FK
  // enforcement off can't leave orphaned rules re-tagging every new transaction.
  await db.del(
    c.env.DB,
    'tag_rules',
    'tag_id = ? AND profile_id = ?',
    Number(c.req.param('id')),
    pid
  );
  return c.json({ ok: true });
});

// Replace the set of tags on a transaction (POST and PUT are aliases).
async function replaceTransactionTags(c: Context<AppEnv>): Promise<Response> {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  if (!Array.isArray(b.tagIds)) throw new HttpError(400, 'tagIds must be an array');
  const txId = c.req.param('id');
  const tx = await db.first(
    c.env.DB,
    'SELECT id FROM transactions WHERE id = ? AND profile_id = ?',
    txId,
    pid
  );
  if (!tx) throw new HttpError(404, 'Transaction not found');
  // Only attach tags owned by this profile — prevents attaching another tenant's tag id,
  // and the SELECT de-dupes so a repeated id can't violate the PK.
  // Cap (and de-dupe) so the ownership SELECT's IN-list stays under D1's ~100 bound-variable
  // limit — a transaction realistically needs only a handful of tags.
  const ids = [
    ...new Set(b.tagIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))),
  ].slice(0, 50);
  let owned: Array<{ id: number }> = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    owned = await db.all<{ id: number }>(
      c.env.DB,
      `SELECT id FROM tags WHERE profile_id = ? AND id IN (${ph})`,
      pid,
      ...ids
    );
    if (owned.length !== ids.length) {
      throw new HttpError(403, 'One or more tags do not belong to this profile');
    }
  }
  const stmts = [
    c.env.DB.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').bind(txId),
  ];
  for (const row of owned) {
    stmts.push(
      c.env.DB.prepare('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').bind(
        txId,
        row.id
      )
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
}
tagsRoutes.post('/api/transactions/:id/tags', requireAuth, replaceTransactionTags);
tagsRoutes.put('/api/transactions/:id/tags', requireAuth, replaceTransactionTags);

tagsRoutes.get('/api/transactions/:id/tags', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const tx = await db.first(
    c.env.DB,
    'SELECT id FROM transactions WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!tx) throw new HttpError(404, 'Transaction not found');
  const tags = await db.all(
    c.env.DB,
    `SELECT t.id, t.name, t.color
     FROM tags t
     JOIN transaction_tags tt ON t.id = tt.tag_id
     WHERE tt.transaction_id = ? AND t.profile_id = ?
     ORDER BY t.name`,
    c.req.param('id'),
    pid
  );
  return c.json(tags);
});

tagsRoutes.get('/api/transactions/by-tag/:tagId', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  let sql = `
    SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    JOIN transaction_tags tt ON t.id = tt.transaction_id
    WHERE t.profile_id = ? AND tt.tag_id = ?`;
  const params: unknown[] = [pid, c.req.param('tagId')];
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const categoryIds = c.req.query('category_ids');
  const type = c.req.query('type');
  if (startDate) {
    sql += ' AND t.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND t.date <= ?';
    params.push(endDate);
  }
  if (categoryIds) {
    const ids = categoryIds
      .split(',')
      .map(Number)
      .filter((n) => !isNaN(n))
      .slice(0, 80); // cap to stay under D1's ~100 bound-variable limit on the IN-list
    if (ids.length) {
      sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }
  if (type) {
    sql += ' AND t.type = ?';
    params.push(type);
  }
  sql += ' ORDER BY t.date DESC, t.id DESC';
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  if (limit && !isNaN(parseInt(limit))) sql += ` LIMIT ${Math.min(parseInt(limit), 1000)}`;
  if (offset && !isNaN(parseInt(offset))) sql += ` OFFSET ${parseInt(offset)}`;
  const rows = await db.all(c.env.DB, sql, ...params);
  return c.json({ rows, total: rows.length });
});
