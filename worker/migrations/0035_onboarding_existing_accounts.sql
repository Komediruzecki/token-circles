-- The setup wizard's record moves from the browser to the account (user_state, migration 0034):
-- the app opens the wizard for an account whose record is not finished. An account already in
-- use when this runs has no record, so it is marked finished here, with outcome 'existing', and
-- never meets the wizard because of the move. The first-week measurement leaves 'existing' out.
--
-- In use means data in any of its profiles (an account, a transaction or a bill), or a decision
-- in any profile's settings ('onboarding', written when the wizard was finished or skipped). An
-- account with neither is left as it is: the app before this one offered such an account the
-- wizard too, and still does.
--
-- step and started_at are null: neither was recorded before. INSERT OR IGNORE keeps a record the
-- app already wrote. The key order matches the Worker's JSON.stringify of a record.
INSERT OR IGNORE INTO user_state (user_id, key, value)
SELECT users.id,
       'onboarding',
       json_object('step', NULL, 'started_at', NULL, 'finished_at', datetime('now'),
                   'outcome', 'existing')
  FROM users
 WHERE EXISTS (
         SELECT 1 FROM profiles
          WHERE profiles.user_id = users.id
            AND (EXISTS (SELECT 1 FROM accounts WHERE accounts.profile_id = profiles.id)
              OR EXISTS (SELECT 1 FROM transactions WHERE transactions.profile_id = profiles.id)
              OR EXISTS (SELECT 1 FROM bills WHERE bills.profile_id = profiles.id)
              OR EXISTS (SELECT 1 FROM settings
                          WHERE settings.profile_id = profiles.id AND settings.key = 'onboarding'))
       );
