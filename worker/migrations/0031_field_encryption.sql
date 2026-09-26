-- Field encryption at rest (migration 0031). Server-side: the Worker holds the keys and decrypts
-- to compute, so this protects a leaked database export, not the data from the operator.
-- Design, threat model and rollout: docs/plans/field-encryption.md.
--
-- Schema only. Every existing row starts at 0 (plaintext) and nothing here reads or rewrites a
-- value: with no DATA_KEK_<n> secret configured, behaviour is exactly what it was before.

-- This user's data key, AES-256-GCM-wrapped under a master key from Workers Secrets
-- (`dk1.<n>.<iv>.<ct>`). NULL: the user has no key, so every row they own is plaintext. It lives
-- on the users row on purpose — deleting the account deletes the only live copy of the key.
ALTER TABLE users ADD COLUMN dek_wrapped TEXT;

-- 0: this row's sealed text columns are plaintext. 1: they are ciphertext under the owner's key.
-- New rows are written at 1 when the owner has a key. An existing row goes 0 -> 1 in exactly one
-- place, the backfill, and only by compare-and-set against the values it read.
ALTER TABLE transactions ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring_transactions ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;

-- 0: the R2 object is the raw upload. 1: it is the chunked AES-GCM format (field-crypto.ts, TCE1).
ALTER TABLE receipts ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;

-- How the backfill finds work in the one table that can be large. Partial, so it shrinks to
-- nothing once the backfill is done instead of indexing a column that is 1 on every row.
CREATE INDEX IF NOT EXISTS idx_transactions_text_plain ON transactions(id) WHERE text_enc = 0;
