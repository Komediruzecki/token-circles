-- Durable production error log for the API worker.
--
-- `logWorkerError` (worker/src/errorlog.ts), called from the Hono onError handler, writes 5xx
-- failures here so incidents survive the short Workers-Logs retention window and stay queryable
-- from your own database, e.g.:
--   wrangler d1 execute finance-manager --remote --env prod \
--     --command "SELECT id, created_at, status, method, path, message FROM error_logs ORDER BY id DESC LIMIT 50"
--
-- 4xx client errors are intentional control flow and are NOT recorded here.

CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  method TEXT,
  path TEXT,
  status INTEGER,
  message TEXT,
  stack TEXT,
  user_id INTEGER,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs (created_at DESC);
