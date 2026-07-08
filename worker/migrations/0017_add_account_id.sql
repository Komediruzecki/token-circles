-- Migration: add account_id to recurring_transactions and bills.
-- Enables atomic account-balance updates when populating recurring transactions
-- or marking bills as paid. Nullable with no default so it is safe on existing
-- rows (legacy rows keep account_id = NULL and simply skip the balance update).
ALTER TABLE recurring_transactions ADD COLUMN account_id INTEGER;
ALTER TABLE bills ADD COLUMN account_id INTEGER;
