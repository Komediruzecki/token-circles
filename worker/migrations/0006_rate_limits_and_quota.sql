-- Rate limiting + reminder quota (migration 0006).

-- Fixed-window rate-limit buckets (see worker/src/ratelimit.ts). `bucket` is e.g. "forgot:<ip>";
-- `reset_at` is epoch-ms. Expired rows are swept from the cron.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Per-user, per-month outbound reminder counter, to enforce plans.ts remindersPerMonth.
CREATE TABLE IF NOT EXISTS reminder_sends (
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL, -- 'YYYY-MM'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);
