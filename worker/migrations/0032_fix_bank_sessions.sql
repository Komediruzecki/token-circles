DROP TABLE IF EXISTS bank_sessions;

CREATE TABLE bank_sessions (
  id TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL,
  aspsp_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  accounts TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE(profile_id, aspsp_name)
);

CREATE INDEX idx_bank_sessions_profile ON bank_sessions(profile_id);
