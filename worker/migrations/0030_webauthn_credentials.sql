-- Passkeys / WebAuthn credentials (migration 0030).
--
-- `id` is the authenticator's credential id (base64url) — the natural primary key, and what an
-- assertion presents to find the row. `public_key` is the COSE key bytes (base64url); only the
-- PUBLIC half ever exists server-side, which is the whole point of passkeys: a database leak
-- hands out nothing that signs.
--
-- `counter` is the authenticator's signature counter, enforced monotonic on login where the
-- authenticator supports it (many platform passkeys always report 0, which the library accepts).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_name TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
