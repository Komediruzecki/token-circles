import { resolveHeaderMapping } from '../../shared/importMapping';
import type { Env } from './index';
import * as db from './db';
import { executeImport, fetchGoogleSheetRows } from './routes/imports';

// Daily cron: auto-sync saved Google-Sheet sources flagged schedule='daily' (Ask 3). Each source
// is fetched server-side, its saved (by-header) mapping resolved against the current header row,
// and the SHARED executeImport is run with a FRESH importId — so the execute-side dedup lands only
// genuinely new rows, never duplicates, and never disturbs previously-imported transactions. This
// is the "no hardware, no credentials" runner for public sheets; private sheets are out of scope.

interface SourceRow {
  id: number;
  profile_id: number;
  kind: string;
  config: string | null;
  mapping: string | null;
  category_types: string | null;
}

const parseJson = (v: string | null): any => {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

// Best-effort per source: one failing sheet must not stop the rest. Runs only on the daily trigger
// so the Monday/1st-15th reminder crons don't re-sync.
export async function runScheduledSheetSyncs(cron: string, env: Env): Promise<void> {
  if (cron !== '0 8 * * *') return;
  const sources = await db.all<SourceRow>(
    env.DB,
    "SELECT id, profile_id, kind, config, mapping, category_types FROM import_sources WHERE schedule = 'daily' AND kind = 'google_sheet'"
  );
  for (const src of sources) {
    try {
      const config = parseJson(src.config) || {};
      if (!config.url) continue;
      const fetched = await fetchGoogleSheetRows(config.url, config.sheetName);
      if (fetched.status !== 200) continue;
      const headers = (fetched.body.headers as string[]) || [];
      const rows = (fetched.body.rows as string[][]) || [];
      if (headers.length === 0 || rows.length === 0) continue;

      const mapping = resolveHeaderMapping(parseJson(src.mapping) || {}, headers);
      // If the essential columns didn't resolve (sheet renamed/removed them), skip rather than
      // import junk — a manual "Fetch & preview" will surface the mismatch to the user.
      if (mapping.date === undefined || mapping.amount === undefined) continue;

      const importId = crypto.randomUUID();
      const outcome = await executeImport(env.DB, src.profile_id, {
        rows,
        mapping,
        categoryTypes: parseJson(src.category_types) || undefined,
        importId,
      });

      const body = outcome.body as Record<string, unknown>;
      // executeImport rejects the whole batch on a validation error rather than importing part of
      // it. Nothing landed, so don't claim the source is synced — leaving last_synced_at alone is
      // what makes the next run (or a manual preview) retry it.
      if (outcome.status !== 200) {
        console.error('[sheet-sync] source', src.id, 'rejected:', body.error ?? outcome.status);
        continue;
      }

      const now = new Date().toISOString();
      await db.update(
        env.DB,
        'import_sources',
        { last_synced_at: now, updated_at: now },
        'id = ?',
        src.id
      );

      const imported = Number(body.imported ?? 0);
      const dupes = Number(body.duplicates ?? 0);
      // Rows the sheet lost (unreadable numbers) and rows that imported but guessed something
      // (missing date → today, odd decimals → rounded to cents). Nobody watches a cron run, so
      // these counts are the only trace the user ever gets — carry them into the session details
      // the Import page renders.
      const skipped = Array.isArray(body.skipped_items) ? body.skipped_items.length : 0;
      const warned = Array.isArray(body.warnings) ? body.warnings.length : 0;
      // Record the session so it shows in the Import page's Recent Imports (and is undoable).
      // Only when something actually imported — a daily re-sync of an unchanged sheet imports 0
      // (every row already exists) and must not spam Recent Imports with an entry every day.
      if (imported > 0) {
        await db.insert(env.DB, 'import_logs', {
          profile_id: src.profile_id,
          import_id: importId,
          source: 'Google Sheet (daily sync)',
          imported,
          duplicates_skipped: dupes,
          accounts_created: Number(body.accounts_created ?? 0),
          categories_created: Number(body.categories_created ?? 0),
          details: JSON.stringify({
            mode: 'daily-sync',
            source_id: src.id,
            rows_skipped_invalid: skipped,
            rows_with_warnings: warned,
          }),
        });
      } else if (skipped > 0) {
        // A run where every changed row was unreadable writes no session (an entry a day for a
        // permanently broken sheet is worse than none), so the Worker log is where it shows.
        console.warn('[sheet-sync] source', src.id, 'skipped', skipped, 'unreadable rows');
      }
    } catch (err) {
      console.error(
        '[sheet-sync] source',
        src.id,
        'failed:',
        err instanceof Error ? err.message : err
      );
    }
  }
}
