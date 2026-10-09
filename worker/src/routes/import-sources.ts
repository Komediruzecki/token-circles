import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import * as db from '../db';
import { requireFeature } from '../plan';
import { accept, refuse } from '../http';
import {
  AUTOMATED_IMPORT_SCHEDULES,
  checkImportSourceCreate,
  checkImportSourceEdit,
  foreignSourceAccount,
  IMPORT_SOURCE_MESSAGES,
} from '../../../shared/importSourceSchema';
import type { ImportSourceWrite } from '../../../shared/importSourceSchema';

// Saved import origins ("Connected Sources", migration 0020). A saved Google-Sheet link
// (later: Drive folder / bank aggregator) the user can re-fetch + import on demand. config,
// mapping and category_types are stored as JSON strings and returned to the client parsed.
export const importSourcesRoutes = new Hono<AppEnv>();

interface ImportSourceRow {
  id: number;
  profile_id: number;
  kind: string;
  label: string;
  config: string | null;
  mapping: string | null;
  category_types: string | null;
  default_account_id: number | null;
  schedule: string;
  last_synced_at: string | null;
  last_cursor: string | null;
  created_at: string;
  updated_at: string;
}

const parseJson = (v: string | null): unknown => {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

// Row (JSON-in-TEXT columns) → API object (parsed config/mapping/category_types).
const rowToApi = (r: ImportSourceRow) => ({
  id: r.id,
  profile_id: r.profile_id,
  kind: r.kind,
  label: r.label,
  config: parseJson(r.config) ?? {},
  mapping: parseJson(r.mapping),
  category_types: parseJson(r.category_types),
  default_account_id: r.default_account_id,
  schedule: r.schedule,
  last_synced_at: r.last_synced_at,
  last_cursor: r.last_cursor,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/**
 * The writable columns of a checked body as D1 stores them: the JSON columns as text. The checks
 * and their words are shared with local-first (shared/importSourceSchema.ts).
 */
function toColumns(value: ImportSourceWrite): Record<string, unknown> {
  const data: Record<string, unknown> = { ...value };
  if (value.config !== undefined) data.config = JSON.stringify(value.config);
  for (const key of ['mapping', 'category_types'] as const) {
    if (value[key] !== undefined)
      data[key] = value[key] === null ? null : JSON.stringify(value[key]);
  }
  return data;
}

/** Refuses a default account that is not one of the profile's, at its field. */
async function requireOwnAccount(d1: D1Database, pid: number, value: ImportSourceWrite) {
  const id = value.default_account_id;
  if (id === undefined || id === null) return;
  const owned = await db.first(
    d1,
    'SELECT id FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!owned) throw refuse(foreignSourceAccount());
}

/**
 * 402 when a write asks for a schedule the plan does not include. Only when the write actually
 * sets one: editing the label of a source that is already on a daily schedule must not fail
 * because of a field the request never mentioned.
 */
async function requireAutomationIfScheduled(
  c: Parameters<typeof requireFeature>[0],
  schedule: unknown
): Promise<void> {
  if (typeof schedule !== 'string' || !AUTOMATED_IMPORT_SCHEDULES.includes(schedule)) return;
  await requireFeature(
    c,
    'automatedImports',
    'Scheduled imports are an Advanced feature. Upgrade, or set this source to Manual.'
  );
}

// ── GET /api/import-sources — all sources across the selected profiles ─────────
importSourcesRoutes.get('/api/import-sources', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const rows = await db.all<ImportSourceRow>(
    c.env.DB,
    `SELECT * FROM import_sources WHERE profile_id IN (${inClause}) ORDER BY id DESC`,
    ...pids
  );
  return c.json(rows.map(rowToApi));
});

// ── POST /api/import-sources — save a new source ───────────────────────────────
importSourcesRoutes.post('/api/import-sources', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const value = accept(checkImportSourceCreate(await c.req.json().catch(() => null)));
  await requireOwnAccount(c.env.DB, pid, value);
  await requireAutomationIfScheduled(c, value.schedule);
  const res = await db.insert(c.env.DB, 'import_sources', { profile_id: pid, ...toColumns(value) });
  const row = await db.first<ImportSourceRow>(
    c.env.DB,
    'SELECT * FROM import_sources WHERE id = ?',
    res.meta.last_row_id
  );
  return c.json(row ? rowToApi(row) : null, 201);
});

// ── PUT /api/import-sources/:id — update an owned source ───────────────────────
importSourcesRoutes.put('/api/import-sources/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const existing = await db.first<ImportSourceRow>(
    c.env.DB,
    'SELECT * FROM import_sources WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) return c.json({ error: IMPORT_SOURCE_MESSAGES.notFound }, 404);
  const value = accept(checkImportSourceEdit(await c.req.json().catch(() => null), existing));
  await requireOwnAccount(c.env.DB, pid, value);
  await requireAutomationIfScheduled(c, value.schedule);
  const data = toColumns(value);
  data.updated_at = new Date().toISOString();
  await db.update(c.env.DB, 'import_sources', data, 'id = ? AND profile_id = ?', id, pid);
  const row = await db.first<ImportSourceRow>(
    c.env.DB,
    'SELECT * FROM import_sources WHERE id = ?',
    id
  );
  return c.json(row ? rowToApi(row) : null);
});

// ── DELETE /api/import-sources/:id — remove an owned source ────────────────────
importSourcesRoutes.delete('/api/import-sources/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const res = await db.del(c.env.DB, 'import_sources', 'id = ? AND profile_id = ?', id, pid);
  if ((res.meta?.changes ?? 0) === 0) return c.json({ error: 'Source not found' }, 404);
  return c.json({ deleted: true });
});
