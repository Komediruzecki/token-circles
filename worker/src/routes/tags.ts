import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';

// Port of backend/routes/tags.js (tags CRUD + transaction tagging).
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
