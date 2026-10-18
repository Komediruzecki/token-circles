-- State that belongs to a person's account rather than to the browser it is used in (migration
-- 0034): the setup wizard's record, the guided tours finished, and whether the Dashboard's
-- Getting started card is hidden. These lived in localStorage, so a new device or a fresh
-- browser forgot them. Local-first mode still keeps them there; it has no account.
--
-- One small row per account and key. The keys are an allowlist and every value is JSON the
-- Worker builds from checked fields, capped at 1 KB (shared/accountStateKeys.ts and
-- shared/accountState.ts; routes in worker/src/routes/account-state.ts). Deleting the account
-- deletes its rows (routes/account.ts).
--
-- Named user_state, not account_state: in this schema "account" is a bank account (accounts,
-- account_balance_history). Checked against every prior migration: no table or index of this
-- name exists, so CREATE TABLE IF NOT EXISTS cannot silently keep an older one (see
-- auth_sessions in 0024).
CREATE TABLE IF NOT EXISTS user_state (
  user_id INTEGER NOT NULL,
  -- 'onboarding' | 'tours' | 'getting_started'
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
