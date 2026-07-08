-- Migration: add transfer_account_id to recurring_transactions.
-- Lets a recurring Transfer name a destination account, so populate can move
-- money From (account_id) -> To (transfer_account_id) as a two-legged transfer.
-- Nullable with no default; existing rows keep transfer_account_id = NULL and
-- fall back to the single-account (or no balance) behavior.
ALTER TABLE recurring_transactions ADD COLUMN transfer_account_id INTEGER;
