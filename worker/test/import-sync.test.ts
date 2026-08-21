import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import wranglerRaw from '../wrangler.jsonc?raw';
import { runScheduledSheetSyncs } from '../src/import-sync';

// The daily cron that re-syncs saved Google-Sheet sources (src/import-sync.ts). It is the one
// import path with no human in front of it: nobody sees a preview, nobody clicks "Import", and a
// mistake repeats every morning. These tests pin the whole contract — which sources it picks up,
// that it never re-imports what it already has, that a broken sheet can't take the others down,
// and that what it did lands in Recent Imports.
//
// The sheets are served by a stubbed global fetch. `fetchGoogleSheetRows` builds a
// docs.google.com CSV-export URL from the sheet id in the source's saved config, so the stub
// keys on that id — which also proves the cron passes each source's own URL through.

const DAILY_CRON = '0 8 * * *';

const USER_ID = 940;
const PROFILE_ID = 9400;
const OTHER_USER_ID = 941;
const OTHER_PROFILE_ID = 9401;

// sheet id → CSV body served for the next fetch. A missing id answers 404 (a sheet that lost its
// public sharing), which is how the "one broken source" tests break a source.
const sheets = new Map<string, string>();

const HEADERS = 'Date,Description,Amount,Category';
const csv = (...rows: string[]) => [HEADERS, ...rows].join('\n');

const ROW_COFFEE = '2026-03-01,Coffee,4.50,Food';
const ROW_RENT = '2026-03-02,Rent,900.00,Housing';

let fetchCalls: string[] = [];

beforeEach(async () => {
  sheets.clear();
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchCalls.push(url);
      const id = url.match(/\/spreadsheets\/d\/([^/]+)\//)?.[1] ?? '';
      const body = sheets.get(id);
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv' } });
    })
  );

  for (const t of [
    'transactions',
    'import_logs',
    'import_sources',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sheetsync@example.com', 'password', 1)"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE_ID,
      USER_ID
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'othersync@example.com', 'password', 1)"
    ).bind(OTHER_USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Theirs')").bind(
      OTHER_PROFILE_ID,
      OTHER_USER_ID
    ),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Seed a saved source and stock the sheet it points at. Returns the new source's id. */
async function addSource(opts: {
  sheetId: string;
  body?: string;
  profileId?: number;
  schedule?: string;
  kind?: string;
  mapping?: Record<string, string> | null;
  categoryTypes?: Record<string, string> | null;
  url?: string;
}): Promise<number> {
  if (opts.body !== undefined) sheets.set(opts.sheetId, opts.body);
  const res = await env.DB.prepare(
    `INSERT INTO import_sources (profile_id, kind, label, config, mapping, category_types, schedule)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      opts.profileId ?? PROFILE_ID,
      opts.kind ?? 'google_sheet',
      `sheet ${opts.sheetId}`,
      JSON.stringify({
        url: opts.url ?? `https://docs.google.com/spreadsheets/d/${opts.sheetId}/edit`,
      }),
      opts.mapping === null
        ? null
        : JSON.stringify(
            opts.mapping ?? {
              date: 'Date',
              description: 'Description',
              amount: 'Amount',
              category: 'Category',
            }
          ),
      opts.categoryTypes ? JSON.stringify(opts.categoryTypes) : null,
      opts.schedule ?? 'daily'
    )
    .run();
  return res.meta.last_row_id as number;
}

const txFor = (profileId = PROFILE_ID) =>
  env.DB.prepare(
    'SELECT date, description, amount, import_id FROM transactions WHERE profile_id = ? ORDER BY date, description'
  )
    .bind(profileId)
    .all<{ date: string; description: string; amount: number; import_id: string | null }>()
    .then((r) => r.results);

const logsFor = (profileId = PROFILE_ID) =>
  env.DB.prepare(
    'SELECT import_id, source, imported, duplicates_skipped, details FROM import_logs WHERE profile_id = ? ORDER BY id'
  )
    .bind(profileId)
    .all<{
      import_id: string;
      source: string;
      imported: number;
      duplicates_skipped: number;
      details: string | null;
    }>()
    .then((r) => r.results);

const sourceRow = (id: number) =>
  env.DB.prepare('SELECT last_synced_at, updated_at FROM import_sources WHERE id = ?')
    .bind(id)
    .first<{ last_synced_at: string | null; updated_at: string }>();

describe('daily sheet sync — which crons and which sources', () => {
  it('runs only on the daily trigger, not on the reminder crons', async () => {
    await addSource({ sheetId: 'DAILY1', body: csv(ROW_COFFEE) });

    // The other two entries in wrangler.jsonc's cron list drive the weekly/semi-monthly
    // reminder emails; re-syncing sheets on them would import the same sheet three times a week.
    await runScheduledSheetSyncs('0 9 * * 1', env);
    await runScheduledSheetSyncs('0 10 1,15 * *', env);
    expect(fetchCalls).toEqual([]);
    expect(await txFor()).toHaveLength(0);

    await runScheduledSheetSyncs(DAILY_CRON, env);
    expect(await txFor()).toHaveLength(1);
  });

  it('the daily guard matches a cron that is actually configured, in every environment', () => {
    // src/import-sync.ts hardcodes the cron string it answers to. If wrangler.jsonc's schedule
    // ever changes, the sync silently stops running — nothing else would fail. This is the test
    // that notices.
    // wrangler.jsonc is JSONC: whole-line comments and trailing commas, no block comments.
    // Stripping both is enough to hand it to JSON.parse; if the file ever grows syntax this
    // does not cover, JSON.parse throws and this test fails loudly rather than skipping.
    const config = JSON.parse(
      wranglerRaw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
    ) as { env: Record<string, { triggers?: { crons?: string[] } }> };
    const envs = Object.entries(config.env ?? {});
    expect(envs.length).toBeGreaterThan(0);
    for (const [name, cfg] of envs) {
      expect(cfg.triggers?.crons, `env.${name} has no crons`).toContain(DAILY_CRON);
    }
  });

  it('leaves manual and on_open sources alone', async () => {
    await addSource({ sheetId: 'MANUAL', body: csv(ROW_COFFEE), schedule: 'manual' });
    await addSource({ sheetId: 'ONOPEN', body: csv(ROW_RENT), schedule: 'on_open' });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(fetchCalls).toEqual([]);
    expect(await txFor()).toHaveLength(0);
  });

  it('leaves non-sheet kinds alone even when they are flagged daily', async () => {
    // google_drive_folder / bank_aggregator are accepted by the API but have no fetcher yet;
    // handing their config to the sheet fetcher would 501 on every run.
    await addSource({
      sheetId: 'AGGR',
      body: csv(ROW_COFFEE),
      schedule: 'daily',
      kind: 'bank_aggregator',
    });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(fetchCalls).toEqual([]);
    expect(await txFor()).toHaveLength(0);
  });

  it('skips a source with no URL saved in its config', async () => {
    const id = await addSource({ sheetId: 'NOURL', body: csv(ROW_COFFEE) });
    await env.DB.prepare("UPDATE import_sources SET config = '{}' WHERE id = ?").bind(id).run();

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(fetchCalls).toEqual([]);
    expect(await sourceRow(id).then((r) => r?.last_synced_at)).toBeNull();
  });
});

describe('daily sheet sync — importing', () => {
  it('imports the sheet, stamps last_synced_at and records one undoable session', async () => {
    const id = await addSource({ sheetId: 'BOOKS', body: csv(ROW_COFFEE, ROW_RENT) });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/spreadsheets/d/BOOKS/export?format=csv');

    const tx = await txFor();
    expect(tx.map((t) => [t.date, t.description, t.amount])).toEqual([
      ['2026-03-01', 'Coffee', 4.5],
      ['2026-03-02', 'Rent', 900],
    ]);

    const synced = await sourceRow(id);
    expect(synced?.last_synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const logs = await logsFor();
    expect(logs).toHaveLength(1);
    expect(logs[0].source).toBe('Google Sheet (daily sync)');
    expect(logs[0].imported).toBe(2);
    expect(JSON.parse(logs[0].details!)).toMatchObject({ mode: 'daily-sync', source_id: id });
    // The session's import_id is stamped on every row it created, which is what makes
    // "Delete import" able to undo exactly this run.
    expect(new Set(tx.map((t) => t.import_id))).toEqual(new Set([logs[0].import_id]));
  });

  it('re-running an unchanged sheet imports nothing and does not spam Recent Imports', async () => {
    await addSource({ sheetId: 'STEADY', body: csv(ROW_COFFEE, ROW_RENT) });

    await runScheduledSheetSyncs(DAILY_CRON, env);
    await runScheduledSheetSyncs(DAILY_CRON, env);
    await runScheduledSheetSyncs(DAILY_CRON, env);

    // Every run gets a FRESH importId, so the dedup pass must match on the row content —
    // if it matched on importId the same rows would land three times.
    expect(await txFor()).toHaveLength(2);
    expect(await logsFor()).toHaveLength(1);
  });

  it('imports only the rows added since the last run', async () => {
    await addSource({ sheetId: 'GROWS', body: csv(ROW_COFFEE, ROW_RENT) });
    await runScheduledSheetSyncs(DAILY_CRON, env);

    sheets.set('GROWS', csv(ROW_COFFEE, ROW_RENT, '2026-03-03,Groceries,52.10,Food'));
    await runScheduledSheetSyncs(DAILY_CRON, env);

    const tx = await txFor();
    expect(tx.map((t) => t.description)).toEqual(['Coffee', 'Rent', 'Groceries']);
    const logs = await logsFor();
    expect(logs).toHaveLength(2);
    expect(logs[1].imported).toBe(1);
    expect(logs[1].duplicates_skipped).toBe(2);
    // The two sessions are distinct, so either one can be undone on its own.
    expect(logs[0].import_id).not.toBe(logs[1].import_id);
  });

  it('follows the saved header names after the sheet owner reorders the columns', async () => {
    // The mapping is persisted BY HEADER NAME precisely so this keeps working (migration 0020).
    await addSource({ sheetId: 'MOVED', body: csv(ROW_COFFEE) });
    await runScheduledSheetSyncs(DAILY_CRON, env);

    sheets.set(
      'MOVED',
      ['Amount,Category,Date,Description', '900.00,Housing,2026-03-02,Rent'].join('\n')
    );
    await runScheduledSheetSyncs(DAILY_CRON, env);

    const tx = await txFor();
    expect(tx.map((t) => [t.description, t.amount])).toEqual([
      ['Coffee', 4.5],
      ['Rent', 900],
    ]);
  });

  it('skips the run when the sheet no longer has the mapped date or amount column', async () => {
    // Renaming/removing the amount column would otherwise import a sheet full of zero-amount
    // rows every morning. Better to do nothing and let the next manual preview explain it.
    const id = await addSource({
      sheetId: 'RENAMED',
      body: ['Date,Description,Total,Category', '2026-03-01,Coffee,4.50,Food'].join('\n'),
    });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(fetchCalls).toHaveLength(1);
    expect(await txFor()).toHaveLength(0);
    expect(await logsFor()).toHaveLength(0);
    // Not marked as synced — nothing was synced.
    expect(await sourceRow(id).then((r) => r?.last_synced_at)).toBeNull();
  });

  it('skips an empty sheet without marking it synced', async () => {
    const id = await addSource({ sheetId: 'EMPTY', body: HEADERS });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(await txFor()).toHaveLength(0);
    expect(await sourceRow(id).then((r) => r?.last_synced_at)).toBeNull();
  });

  it('carries skipped and warned row counts into the session details', async () => {
    // Nobody watches a cron run. A row the sheet made unreadable and a row imported with a
    // guessed date both have to leave a trace, or the sync quietly rewrites the user's books.
    await addSource({
      sheetId: 'MESSY',
      body: csv(
        ROW_COFFEE,
        '2026-03-05,Broken amount,"1,2,3",Food', // not a number under any separator rule
        ',Undated payment,12.00,Food', // no date at all
        ',Undated refund,7.00,Food' // ditto — two warnings against one skip, so a mix-up shows
      ),
    });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    const logs = await logsFor();
    expect(logs).toHaveLength(1);
    // Coffee + both undated rows imported; the ambiguous "1,2,3" amount could not be read.
    expect(logs[0].imported).toBe(3);
    expect(JSON.parse(logs[0].details!)).toMatchObject({
      mode: 'daily-sync',
      rows_skipped_invalid: 1,
      rows_with_warnings: 2,
    });

    const undated = (await txFor()).find((t) => t.description === 'Undated payment');
    expect(undated?.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('writes no session when every changed row was unreadable', async () => {
    // An entry a day for a permanently broken sheet is worse than none — the Worker log carries
    // it instead. What must not happen is a session claiming an import that never occurred.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await addSource({
      sheetId: 'ALLBAD',
      body: csv('2026-03-05,Broken,"1,2,3",Food', '2026-03-06,Also broken,"4,5,6",Food'),
    });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect(await txFor()).toHaveLength(0);
    expect(await logsFor()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    // The sheet was reachable and mapped, so the run itself succeeded — it just had nothing
    // importable in it.
    expect(await sourceRow(id).then((r) => r?.last_synced_at)).not.toBeNull();
    warn.mockRestore();
  });

  it('creates the accounts a source declares and routes transfers to them', async () => {
    await addSource({
      sheetId: 'ACCTS',
      body: csv('2026-03-04,Salary,2000.00,Erste Giro'),
      categoryTypes: { 'Erste Giro': 'account' },
    });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    const acc = await env.DB.prepare('SELECT name FROM accounts WHERE profile_id = ?')
      .bind(PROFILE_ID)
      .all<{ name: string }>();
    expect(acc.results.map((a) => a.name)).toEqual(['Erste Giro']);
    const logs = await logsFor();
    expect(logs[0].imported).toBe(1);
    expect(JSON.parse(logs[0].details!).source_id).toBeGreaterThan(0);
  });
});

describe('daily sheet sync — isolation', () => {
  it('imports each source into its own profile', async () => {
    await addSource({ sheetId: 'MINE', body: csv(ROW_COFFEE) });
    await addSource({
      sheetId: 'THEIRS',
      body: csv(ROW_RENT),
      profileId: OTHER_PROFILE_ID,
    });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect((await txFor()).map((t) => t.description)).toEqual(['Coffee']);
    expect((await txFor(OTHER_PROFILE_ID)).map((t) => t.description)).toEqual(['Rent']);
    expect(await logsFor()).toHaveLength(1);
    expect(await logsFor(OTHER_PROFILE_ID)).toHaveLength(1);
  });

  it('one unreachable sheet does not stop the sources after it', async () => {
    // `sheets` has no entry for GONE, so the stub answers 404 and fetchGoogleSheetRows returns 501.
    const broken = await addSource({ sheetId: 'GONE' });
    const ok = await addSource({ sheetId: 'FINE', body: csv(ROW_RENT) });

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect((await txFor()).map((t) => t.description)).toEqual(['Rent']);
    expect(await sourceRow(broken).then((r) => r?.last_synced_at)).toBeNull();
    expect(await sourceRow(ok).then((r) => r?.last_synced_at)).not.toBeNull();
  });

  it('one throwing source does not stop the sources after it', async () => {
    // A 404 is handled inside fetchGoogleSheetRows; this is the other shape — fetch itself
    // rejecting, which lands in runScheduledSheetSyncs' own catch.
    const broken = await addSource({ sheetId: 'THROWS', body: csv(ROW_COFFEE) });
    const ok = await addSource({ sheetId: 'ALSOFINE', body: csv(ROW_RENT) });
    const serveSheet = globalThis.fetch; // the stub installed in beforeEach
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/d/THROWS/')) throw new Error('connection reset');
        return serveSheet(input as RequestInfo);
      })
    );

    await runScheduledSheetSyncs(DAILY_CRON, env);

    expect((await txFor()).map((t) => t.description)).toEqual(['Rent']);
    expect(await sourceRow(broken).then((r) => r?.last_synced_at)).toBeNull();
    expect(await sourceRow(ok).then((r) => r?.last_synced_at)).not.toBeNull();
  });
});
