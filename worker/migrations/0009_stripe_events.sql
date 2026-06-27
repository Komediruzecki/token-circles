-- Stripe webhook idempotency + ordering (migration 0009).
--
-- Stripe retries webhook delivery on any non-2xx and can deliver an event more than once, sometimes
-- out of order. Two guards:
--   * stripe_events remembers every event id we've applied, so each event is processed at most once.
--   * users.stripe_event_at is a per-customer watermark (the `created` time of the newest applied
--     subscription event); an older/stale event can't overwrite newer state, e.g. a late
--     subscription.updated can't resurrect a plan that subscription.deleted already canceled.
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created INTEGER NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE users ADD COLUMN stripe_event_at INTEGER NOT NULL DEFAULT 0;
