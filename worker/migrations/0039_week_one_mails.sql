-- The week-one mails (migration 0039): day 2 and day 7 of a new account's first week, sent by the
-- daily scheduled job (worker/src/weekOne.ts).
--
-- week_one_mails is the account's switch for them: 1 sends, 0 stops them. Settings turns it on and
-- off, and the stop link in each of the two mails turns it off. The general unsubscribe
-- (notifications_unsubscribed) stops them too, without touching this column. It lives on users,
-- not in a profile's settings, because the mails go to the account. No column of this name exists
-- (0001_init.sql and every later migration checked).
--
-- The index lets the job find the accounts whose Welcome claim, the reminder_dedup row
-- (user_id, 'welcome') whose sent_at is the instant the address was confirmed, falls in a window
-- of days. The primary key starts with user_id, so without it that lookup reads the whole table,
-- which grows by a row per account with reminders per day. No index of this name exists.
ALTER TABLE users ADD COLUMN week_one_mails INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_reminder_dedup_key_sent ON reminder_dedup(dedup_key, sent_at);
