-- Personal access tokens: bearer credentials for the MCP server (/mcp) and the ingest API
-- (/api/v1/*). Cookies stay the only way the browser app authenticates; these exist so an agent
-- or an unattended routine can reach a single user's data without one.
--
-- token_hash is a plain SHA-256, NOT a slow KDF, and that is deliberate. The secret is 32 bytes
-- of CSPRNG output, not a human-chosen password: there is no dictionary to walk and no feasible
-- brute force, so PBKDF2 would buy nothing while adding its full cost to every authenticated
-- request. Password hashing in this codebase (auth.ts) runs 100_000 iterations for exactly the
-- opposite reason -- those inputs ARE guessable.
--
-- Named api_tokens; checked against every prior migration. 0001_init created tables for the
-- retired Express server, so a name collision here would be a silent CREATE TABLE IF NOT EXISTS
-- no-op that fails on the following statement instead (see auth_sessions in 0024).
CREATE TABLE IF NOT EXISTS api_tokens (
  -- uuid. Not a secret: it names the token in listings and in the signed upload URLs.
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  -- Human label, chosen at mint: "Drive import routine".
  name TEXT NOT NULL,
  -- SHA-256 hex of the full secret including its tc_pat_ prefix. The secret itself is returned
  -- once at mint and never stored.
  token_hash TEXT NOT NULL UNIQUE,
  -- First 8 chars of the random part, so a listing can say which token is which.
  hint TEXT NOT NULL,
  -- JSON array of: read, write, import.
  scopes TEXT NOT NULL,
  -- Profile that unattended calls act on when the caller names none. NULL falls back to the
  -- user's first profile (ensureProfile).
  default_profile_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Touched at most once per TOKEN_TOUCH_SECONDS, not per request (see apitoken.ts).
  last_used_at TEXT,
  expires_at TEXT,
  -- Set by revoke. Rows are kept so a listing can still show what was revoked and when.
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
