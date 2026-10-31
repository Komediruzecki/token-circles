-- What an expense category holds (shared/guidance/kinds.ts).
--
-- kind: one of fifteen ids (housing, groceries, eating_out, ...), or NULL. Set on expense
-- categories only; the app reads a NULL kind as the one the category's name suggests.
-- essential: 1 or 0 once the person says whether the category is needed every month; NULL while
-- its kind decides.
--
-- Columns only, and no rewrite of existing rows: they read NULL, and the app fills both in on read.
-- Neither name is used by any table in 0001_init.sql or any later migration.
ALTER TABLE categories ADD COLUMN kind TEXT;
ALTER TABLE categories ADD COLUMN essential INTEGER;
