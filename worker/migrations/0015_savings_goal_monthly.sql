-- The Goals UI has a "monthly contribution" field (used for the savings projections),
-- but savings_goals never had a column for it, so the value was silently dropped on the
-- worker and projections couldn't work in server mode. Add it.
ALTER TABLE savings_goals ADD COLUMN monthly_contribution REAL DEFAULT 0;
