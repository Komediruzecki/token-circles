-- Per-account transaction queries — the account_id / transfer_account_id filter on the list
-- endpoint (WHERE t.account_id = ? OR t.transfer_account_id = ?) and account-linked lookups — had
-- no index and fell back to a profile-wide scan. Add covering indexes.
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_account ON transactions(transfer_account_id);
