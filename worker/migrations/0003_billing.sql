-- Stripe billing columns on users. `users.plan` ('free' | 'premium') already exists (0001);
-- these track the Stripe customer + subscription so webhooks can keep the plan in sync.
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT; -- active | trialing | canceled | past_due | ...
ALTER TABLE users ADD COLUMN plan_renews_at TEXT;      -- ISO 8601, from current_period_end
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);
