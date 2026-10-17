-- A credit card, and a Giro account's overdraft (shared/accountSchema.ts).
--
-- credit_limit: how much a card lets you owe, or how far below zero an overdraft goes, as an
-- amount of 0 or more; NULL for none given.
-- credit_rate: the yearly percentage charged on money owed, like loans.interest_rate; NULL for
-- none given.
--
-- Only credit and giro accounts hold either. 'credit' is a new accounts.type value, which the app
-- checks; the column itself takes any text. Balances stay signed: money owed is below zero.
--
-- Columns only, and no rewrite of existing rows: they read NULL. Neither name is used by any table
-- in 0001_init.sql or any later migration.
ALTER TABLE accounts ADD COLUMN credit_limit REAL;
ALTER TABLE accounts ADD COLUMN credit_rate REAL;
