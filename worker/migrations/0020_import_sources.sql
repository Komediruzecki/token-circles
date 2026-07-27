-- Saved, reusable import origins ("Connected Sources"): a saved Google-Sheet link
-- (and, later, a Drive folder or bank-aggregator connection) that can be re-fetched
-- and imported on demand or on a schedule. config/mapping/category_types hold JSON.
-- The column mapping is persisted BY HEADER NAME (not column index) so it survives the
-- sheet owner reordering columns; indices are re-resolved at fetch time.
CREATE TABLE IF NOT EXISTS import_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'google_sheet',
  label TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  mapping TEXT,
  category_types TEXT,
  default_account_id INTEGER,
  schedule TEXT NOT NULL DEFAULT 'manual',
  last_synced_at TEXT,
  last_cursor TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_import_sources_profile ON import_sources(profile_id);
