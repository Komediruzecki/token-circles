-- Email sign-in codes (migration 0029): "email me a code" login.
--
-- Same shape and the same reasoning as password_resets (0005) and email_verifications (0022):
-- only a SHA-256 hash of the 6-digit code is stored, so a database leak yields nothing typeable —
-- the raw code exists only inside the email. Guessing is bounded by the signed ceremony cookie
-- (only the browser that requested a code can attempt it), the per-code `attempts` counter that
-- burns the code after a handful of misses, the 10-minute expiry, and single use — not by the
-- hash alone.
--
-- `email` is kept alongside the user id on purpose (the 0022 lesson): a code is minted for one
-- address, and verification matches on that address, not just on the account.
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email);
CREATE INDEX IF NOT EXISTS idx_login_codes_user ON login_codes(user_id);
