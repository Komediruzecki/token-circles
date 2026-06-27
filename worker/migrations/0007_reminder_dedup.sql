-- Idempotency for scheduled reminder emails (migration 0007).
--
-- Cloudflare cron can re-fire a trigger, and a schedule can match more days than intended (the
-- day-of-month and day-of-week fields are OR'd). This table makes each scheduled send claim a
-- one-time slot per (user, period) so a re-fire never emails the same report twice.
-- dedup_key examples: 'report:2026-06-H1' (1st-half spending report), 'budget:2026-06-15'.
CREATE TABLE IF NOT EXISTS reminder_dedup (
  user_id INTEGER NOT NULL,
  dedup_key TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, dedup_key)
);
