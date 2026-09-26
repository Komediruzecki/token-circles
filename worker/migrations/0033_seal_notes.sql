-- Field encryption, part two (migration 0033): the free text 0031 left in plaintext — notes on
-- accounts, goals, loan prepayments, housing and holdings, the patterns auto-categorization learns,
-- and tag-rule criteria. The same contract as 0031: schema only, every row starts at 0 (plaintext),
-- and nothing here reads or rewrites a value. Names stay plaintext; the plan doc says why.
ALTER TABLE accounts ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE savings_goals ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retirement_goals ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loan_prepayments ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE housings ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE portfolio_holdings ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE category_mappings ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tag_rules ADD COLUMN text_enc INTEGER NOT NULL DEFAULT 0;
