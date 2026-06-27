-- Email reminder unsubscribe. Per-type preferences already live in the `settings` table
-- (email_notifications / email_budget_alerts / email_spending_report); this adds a global,
-- token-based one-click unsubscribe (the legacy app never had one).
ALTER TABLE users ADD COLUMN notifications_unsubscribed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN unsubscribe_token TEXT;
CREATE INDEX IF NOT EXISTS idx_users_unsub ON users(unsubscribe_token);
