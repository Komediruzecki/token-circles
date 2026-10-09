-- A sign-in code request's cookie is a random handle (migration 0032).
--
-- The request makes 32 random bytes and sets them as the fm_logincode cookie. The code's row keeps
-- only their SHA-256 hash, and trading the code finds the row by that hash and the address: the
-- state of the request stays here, and the cookie is its handle.
--
-- Rows written before this migration have no handle, so no cookie finds them, and each expires
-- within ten minutes, as every code does: a person whose code stops working asks for a new one.
--
-- A column, not a table, so there is no new name to check against 0001_init. SQLite lets a UNIQUE
-- index hold any number of NULLs, so those older rows sit under it as they are.
ALTER TABLE login_codes ADD COLUMN handle_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_login_codes_handle ON login_codes(handle_hash);
