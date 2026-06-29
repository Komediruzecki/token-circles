-- Pending-cancellation flag (migration 0010).
--
-- When a user cancels "at end of billing period", Stripe keeps the subscription `active`
-- (cancel_at_period_end = true) until plan_renews_at, then deletes it. status='active' alone can't
-- tell "renewing" from "canceling", so we store the flag — the billing UI shows
-- "canceled — access ends on <date>" during that window. Entitlement is unchanged.
ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
