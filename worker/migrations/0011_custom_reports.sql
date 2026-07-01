-- Custom reports were kept in a per-isolate in-memory Map keyed by a Date.now() id with no
-- ownership check, so any authenticated user could read/update/delete another user's report id
-- (an IDOR, conditional on a shared warm isolate). Persist them in D1, scoped by user_id.
CREATE TABLE IF NOT EXISTS custom_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_reports_user ON custom_reports(user_id);
