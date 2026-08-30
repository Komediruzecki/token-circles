-- TOTP two-factor auth (migration 0028).
--
-- `secret_enc` is the base32 TOTP secret encrypted with AES-256-GCM under a key HKDF-derived
-- from JWT_SECRET (info label in twofa.ts). Not plaintext, because a D1 leak must not hand out
-- every user's second factor together with their password hashes. The trade-off is deliberate:
-- rotating JWT_SECRET orphans these secrets — TOTP then fails to decrypt and sign-in falls back
-- to recovery codes, which are hashed (not encrypted) below and survive rotation.
--
-- `confirmed_at` is NULL between "show the QR" and "user typed a valid code". Only a confirmed
-- row makes login demand a second factor; an abandoned setup must never lock anyone out.
--
-- `last_used_step` is the RFC 6238 anti-replay high-water mark: a code at or below it is spent,
-- so shoulder-surfing a code that was just used buys nothing within its 30s window.
CREATE TABLE IF NOT EXISTS totp_credentials (
  user_id INTEGER PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  last_used_step INTEGER,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-use backup codes. Same shape and reasoning as password_resets (0005): only a SHA-256
-- hash is stored, so a database leak yields nothing typeable — the raw codes exist only on the
-- sheet the user saved at enrollment.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);
