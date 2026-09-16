-- Migration to store encrypted session tokens for bank sync features
CREATE TABLE IF NOT EXISTS bank_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bank_sessions_profile ON bank_sessions(profile_id);
