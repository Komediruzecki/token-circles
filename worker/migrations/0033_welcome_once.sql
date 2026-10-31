-- The Welcome mail goes once per account (migration 0033): when its address is first confirmed,
-- or at once for a Google sign-up. The record that it went is a reminder_dedup row with
-- dedup_key 'welcome' (worker/src/welcome.ts), so this migration adds no table and no column.
--
-- Every account that exists when this runs had the welcome of its day at sign-up, a password
-- sign-up's with its confirm link in it. Each is marked as welcomed here, so an account still
-- waiting for its link gets no second welcome when it confirms.
INSERT OR IGNORE INTO reminder_dedup (user_id, dedup_key) SELECT id, 'welcome' FROM users;
