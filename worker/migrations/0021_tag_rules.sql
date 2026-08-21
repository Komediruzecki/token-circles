-- Tag rules: reusable saved filters that attach a tag to matching transactions.
-- `criteria` holds the JSON blob defined by shared/tagRules.ts. Rules are always read in bulk
-- and evaluated in memory (never compiled into SQL), so there is nothing to index inside the
-- blob and new condition types need no further migration.
CREATE TABLE IF NOT EXISTS tag_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  criteria TEXT NOT NULL DEFAULT '{}',
  -- 1 = also tag transactions created after this rule was saved.
  auto_apply INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tag_rules_profile ON tag_rules(profile_id);
CREATE INDEX IF NOT EXISTS idx_tag_rules_tag ON tag_rules(tag_id);
-- The auto-apply path runs on every transaction insert, so give it a covering lookup.
CREATE INDEX IF NOT EXISTS idx_tag_rules_profile_auto ON tag_rules(profile_id, auto_apply);
