-- One row per signed-in device.
--
-- Sessions were stateless: a JWT, and a single `users.token_version` counter that could only ever
-- revoke ALL of them at once. So "log out" had two possible meanings and the product shipped the
-- wrong one — signing out on a laptop revoked the phone and the tablet too — and there was no way
-- to show someone where they were signed in, or to end one session without ending every session.
--
-- Named `auth_sessions`, not `sessions`: 0001_init created a `sessions` table for the Express
-- server's express-session store (sid/sess/expire). Nothing in the Worker reads it, but it may
-- still hold rows, and dropping someone's table to free up a name is not what a migration is for.
--
-- The JWT now carries a `sid`, and this table is what it points at. Deleting a row ends exactly
-- one device. `token_version` stays as the blunt instrument behind "sign out everywhere", because
-- it is the only thing that can revoke a token issued before this table existed.
CREATE TABLE IF NOT EXISTS auth_sessions (
  -- Random uuid, embedded in the JWT as `sid`. Not a secret: holding it grants nothing without
  -- the signed token.
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  -- 'password' | 'google'
  provider TEXT,
  -- What the device was when it signed in. Kept verbatim; the readable label is derived at render
  -- time, so improving the parser never needs a backfill.
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Updated at most once every few minutes, not on every request — see SESSION_TOUCH_SECONDS.
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_seen ON auth_sessions(last_seen_at);
