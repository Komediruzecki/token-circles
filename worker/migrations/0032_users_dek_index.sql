-- Field encryption: find data keys by the master key that wraps them without reading every user
-- (migration 0032). /api/health asks whether any key is under a master key that is not configured,
-- and the rotation step of the backfill cron asks which keys are not under the newest one. A
-- wrapped key starts `dk1.<n>.`, so both are range lookups on this index, and with nothing to find
-- they read nothing — /api/health is public, so it must not cost a scan of users per call.
CREATE INDEX IF NOT EXISTS idx_users_dek_wrapped ON users(dek_wrapped);
