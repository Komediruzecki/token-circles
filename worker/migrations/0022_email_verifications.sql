-- Email verification (migration 0022). Confirm-your-address links for password signups.
--
-- Same shape and the same reasoning as password_resets (0005): only a SHA-256 hash of the
-- token is stored, so a database leak yields no usable confirm links — the raw token exists
-- only inside the email.
--
-- `email` is kept alongside the user id on purpose. A token is minted for one address; if the
-- account's address changes before the link is clicked, confirming would otherwise mark the
-- NEW address verified on the strength of an email sent to the old one.
CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
