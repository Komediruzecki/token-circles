-- Every account that exists when this runs is marked as having had both week-one mails
-- (migration 0040), so none of them gets day 2 or day 7 out of the blue.
--
-- It has to be marked, not left to the job's window of days: the job counts days from the
-- account's Welcome claim, and migration 0033, which ships in the same release, writes that claim
-- for every account with the time it runs. Without these rows every existing account would look
-- two days old two days after the release. The record is the reminder_dedup row the job claims
-- before it sends (worker/src/weekOne.ts), so this adds no table and no column.
INSERT OR IGNORE INTO reminder_dedup (user_id, dedup_key) SELECT id, 'week-one:day2' FROM users;
INSERT OR IGNORE INTO reminder_dedup (user_id, dedup_key) SELECT id, 'week-one:day7' FROM users;
