import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import * as db from '../db';

// Saved import origins ("Connected Sources", migration 0020). A saved Google-Sheet link
// (later: Drive folder / bank aggregator) the user can re-fetch + import on demand. config,
// mapping and category_types are stored as JSON strings and returned to the client parsed.
export const importSourcesRoutes = new Hono<AppEnv>();

const KINDS = new Set(['google_sheet', 'google_drive_folder', 'bank_aggregator']);
const SCHEDULES = new Set(['manual', 'on_open', 'daily']);

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
 * Pull the writable columns out of a request body, stringifying the JSON columns and
 * clamping strings. On create (`partial: false`) kind/label/config/schedule always land
 * (with defaults); on update (`partial: true`) only the keys the body actually carries are
 * touched. Returns an error string for an invalid enum value so the caller can 400.
 */
function readWritable(
  b: Record<string, unknown>,
  partial: boolean
): { data: Record<string, unknown>; error?: string } {
  const data: Record<string, unknown> = {};
  if (!partial || 'kind' in b) {
    const kind = typeof b.kind === 'string' ? b.kind : 'google_sheet';
    if (!KINDS.has(kind)) return { data, error: 'Invalid kind' };
    data.kind = kind;
  }
  if (!partial || 'label' in b) {
    data.label = typeof b.label === 'string' ? b.label.slice(0, 200) : '';
  }
  if (!partial || 'config' in b) {
    data.config = JSON.stringify(b.config && typeof b.config === 'object' ? b.config : {});
  }
  if ('mapping' in b) {
    data.mapping = b.mapping && typeof b.mapping === 'object' ? JSON.stringify(b.mapping) : null;
  }
  if ('category_types' in b) {
    data.category_types =
      b.category_types && typeof b.category_types === 'object'
        ? JSON.stringify(b.category_types)
        : null;
  }
  if ('default_account_id' in b) {
    data.default_account_id =
      typeof b.default_account_id === 'number' && Number.isFinite(b.default_account_id)
        ? Math.floor(b.default_account_id)
        : null;
  }
  if (!partial || 'schedule' in b) {
    const schedule = typeof b.schedule === 'string' ? b.schedule : 'manual';
    if (!SCHEDULES.has(schedule)) return { data, error: 'Invalid schedule' };
    data.schedule = schedule;
  }
  if ('last_synced_at' in b) {
    data.last_synced_at =
      typeof b.last_synced_at === 'string' ? b.last_synced_at.slice(0, 40) : null;
  }
  if ('last_cursor' in b) {
    data.last_cursor = typeof b.last_cursor === 'string' ? b.last_cursor.slice(0, 200) : null;
  }
  return { data };
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
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const { data, error } = readWritable(b, false);
  if (error) return c.json({ error }, 400);
  const res = await db.insert(c.env.DB, 'import_sources', { profile_id: pid, ...data });
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
  if (!existing) return c.json({ error: 'Source not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const { data, error } = readWritable(b, true);
  if (error) return c.json({ error }, 400);
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
