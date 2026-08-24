-- Auth audit trail.
--
-- error_logs (0013) deliberately records only 5xx: "4xx client errors (validation, auth,
-- not-found) are intentional control flow and are NOT logged, to keep the signal clean." That is
-- right for validation errors and wrong for authentication — a user locked out by a 401 loop left
-- no trace at all on the server, and the only way to find out why was to read the request's Cookie
-- header off their screen.
--
-- Deliberately NOT one row per request. A signed-out browser polls /api/auth/me on every load, so
-- persisting every denial would be a write per page view and a free amplification vector. Only
-- these reach D1:
--   * login / register / logout outcomes — rare, and the ones an audit trail is actually for
--   * a session refused when the request DID carry a cookie — the interesting failure; a request
--     with no cookie is simply not signed in
-- Everything else is a structured console line, captured by Workers Observability.
CREATE TABLE IF NOT EXISTS auth_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'login' | 'register' | 'logout' | 'session'
  event TEXT NOT NULL,
  -- 'ok' | 'denied'
  outcome TEXT NOT NULL,
  -- Why it was denied: bad_credentials, captcha, rate_limited, revoked, bad_token, unknown_user…
  reason TEXT,
  user_id INTEGER,
  -- The address that was TRIED, which for a failed login is the only identifier there is. Not a
  -- foreign key: a login attempt for an address with no account is exactly what this must record.
  email TEXT,
  ip TEXT,
  user_agent TEXT,
  -- cf-ray, so a row can be tied back to the Cloudflare request log.
  request_id TEXT,
  -- How many session cookies the request carried. More than one means duplicates across Domain or
  -- Path scopes, which is invisible from the outside and turns a working login into a permanent
  -- 401. This column is the whole reason the incident that prompted the table took an evening.
  cookie_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_logs_created ON auth_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_logs_email ON auth_logs(email);
CREATE INDEX IF NOT EXISTS idx_auth_logs_user ON auth_logs(user_id);
