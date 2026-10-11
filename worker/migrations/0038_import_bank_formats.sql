-- The bank formats an import read (shared/bankFormats.ts).
--
-- bank_formats: the adapter ids of the statements an import session read (dkb, erste, ...), joined
-- by commas, or NULL for none: a generic CSV, a Google Sheet, an email attachment. Every writer
-- keeps only the ids the app reads. It is a column, not a key in details, because both runtimes
-- cut details at 8000 characters, and a cut leaves JSON that does not parse.
--
-- A column only, and no rewrite of existing rows: they read NULL. The name is used by no table in
-- 0001_init.sql or any later migration.
ALTER TABLE import_logs ADD COLUMN bank_formats TEXT;
