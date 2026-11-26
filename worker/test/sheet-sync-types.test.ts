import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHeaderMapping } from '../../shared/importMapping';
import { syncTypes, type ImportValueType } from '../../shared/importCategoryTypes';
import { runScheduledSheetSyncs } from '../src/import-sync';
import { executeImport, fetchGoogleSheetRows } from '../src/routes/imports';

// A saved sheet is synced two ways: by hand (Connected sources' Sync, which types the rows in
// the browser and sends them to /api/import/execute) and by the daily cron, on the Worker. Review
// of 19 Nov: the cron typed a category the saved types did not name by its amount's sign, while
// Sync gave it the fresh import's guess, so an unsigned 12.00 in Pharmacy came in overnight as
// income and by hand as an expense. Both now take shared/importCategoryTypes.ts.

const DAILY_CRON = '0 8 * * *';
const USER_ID = 960;
const BY_HAND = 9600;
const BY_CRON = 9601;
const MAPPING = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  category: 'Category',
  means_of_payment: 'Means of Payment',
};

const sheets = new Map<string, string>();
const urlOf = (sheetId: string) => `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

beforeEach(async () => {
  sheets.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = sheets.get(url.match(/\/spreadsheets\/d\/([^/]+)\//)?.[1] ?? '');
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv' } });
    })
  );
  for (const table of [
    'transactions',
    'import_logs',
    'import_sources',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, email_verified, token_version) VALUES (?, 'sheettypes@example.com', 'password', 1, 1)"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'By hand')").bind(
      BY_HAND,
      USER_ID
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'By cron')").bind(
      BY_CRON,
      USER_ID
    ),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Connected sources' Sync: read the sheet, type its values (applySavedMapping), import it all. */
async function syncByHand(sheetId: string, saved: Record<string, ImportValueType> | null) {
  const fetched = await fetchGoogleSheetRows(urlOf(sheetId));
  expect(fetched.status).toBe(200);
  const headers = fetched.body.headers as string[];
  const rows = fetched.body.rows as string[][];
  const mapping = resolveHeaderMapping(MAPPING, headers);
  const outcome = await executeImport(env.DB, BY_HAND, {
    rows,
    mapping,
    categoryTypes: syncTypes(rows, mapping, saved) ?? {},
    importId: crypto.randomUUID(),
  });
  expect(outcome.status).toBe(200);
}

/** The same sheet saved with the same types and a daily schedule, synced by the cron. */
async function syncByCron(sheetId: string, saved: Record<string, ImportValueType> | null) {
  await env.DB.prepare(
    `INSERT INTO import_sources (profile_id, kind, label, config, mapping, category_types, schedule)
     VALUES (?, 'google_sheet', 'Example sheet', ?, ?, ?, 'daily')`
  )
    .bind(
      BY_CRON,
      JSON.stringify({ url: urlOf(sheetId) }),
      JSON.stringify(MAPPING),
      saved === null ? null : JSON.stringify(saved)
    )
    .run();
  await runScheduledSheetSyncs(DAILY_CRON, env);
}

/** Each row as it came in: its type, and the account it went to. */
async function booked(profileId: number) {
  const { results } = await env.DB.prepare(
    `SELECT t.description, t.type, a.name AS account
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.profile_id = ? ORDER BY t.description`
  )
    .bind(profileId)
    .all<{ description: string; type: string; account: string | null }>();
  return Object.fromEntries(results.map((r) => [r.description, `${r.type} ${r.account ?? '-'}`]));
}

const sheet = (...rows: string[]) =>
  ['Date,Description,Amount,Category,Means of Payment', ...rows].join('\n');

describe("a saved sheet's rows, synced by hand and by the cron", () => {
  it('come in with the same types, signed or not, where the sheet was saved with types', async () => {
    const cases: Array<{ name: string; csv: string; saved: Record<string, ImportValueType> }> = [
      {
        // As the card saves a sheet after its import: the import's types, Groceries only.
        name: 'unsigned',
        csv: sheet(
          '2026-03-01,Example shop,12.00,Groceries,Example Card',
          '2026-03-02,Example pills,12.00,Pharmacy,Example Card',
          '2026-03-03,Example pay,2500.00,Salary,Example Card'
        ),
        saved: { Groceries: 'expense', 'Example Card': 'account' },
      },
      {
        name: 'signed',
        csv: sheet(
          '2026-03-01,Example shop,-12.00,Groceries,Example Card',
          '2026-03-02,Example pills,-8.00,Pharmacy,Example Card',
          '2026-03-03,Example return,15.00,Returns,Example Card',
          '2026-03-04,Example pay,2500.00,Salary,Example Wallet'
        ),
        saved: { Groceries: 'expense', Salary: 'income', 'Example Card': 'account' },
      },
    ];
    for (const { name, csv, saved } of cases) {
      sheets.set(name, csv);
      await env.DB.prepare('DELETE FROM transactions').run();
      await env.DB.prepare('DELETE FROM accounts').run();
      await env.DB.prepare('DELETE FROM categories').run();
      await env.DB.prepare('DELETE FROM import_sources').run();
      await syncByHand(name, saved);
      await syncByCron(name, saved);
      const byHand = await booked(BY_HAND);
      expect(Object.keys(byHand).length, name).toBeGreaterThan(2);
      expect(await booked(BY_CRON), name).toEqual(byHand);
    }
    // A category the saved types do not name is typed as Map columns would type it, not by its
    // amount's sign, and a new Means of Payment value is an account, as it is by hand.
    expect(await booked(BY_CRON)).toEqual({
      'Example pay': 'income Example Wallet',
      'Example pills': 'expense Example Card',
      'Example return': 'expense Example Card',
      'Example shop': 'expense Example Card',
    });
  });

  // Released behaviour, kept (maff decides it): a sheet saved before this release has no saved
  // types, and the two syncs have always typed it differently. By hand, Sync gives each category
  // the fresh import's guess; the cron leaves each row to its amount's sign. Pinned here so that
  // a change to either is a decision, not a side effect.
  it('keep their own rules where the sheet was saved with no types', async () => {
    const plain = (...rows: string[]) => ['Date,Description,Amount,Category', ...rows].join('\n');
    const cases = [
      {
        name: 'unsigned-untyped',
        csv: plain(
          '2026-03-01,Example shop,12.00,Groceries',
          '2026-03-02,Example pills,12.00,Pharmacy',
          '2026-03-03,Example pay,2500.00,Salary'
        ),
        byHand: {
          'Example pay': 'income -',
          'Example pills': 'expense -',
          'Example shop': 'expense -',
        },
        byCron: {
          'Example pay': 'income -',
          'Example pills': 'income -',
          'Example shop': 'income -',
        },
      },
      {
        name: 'signed-untyped',
        csv: plain(
          '2026-03-01,Example shop,-12.00,Groceries',
          '2026-03-02,Example return,15.00,Returns',
          '2026-03-03,Example pay,2500.00,Salary',
          '2026-03-04,Example pay back,-50.00,Salary'
        ),
        byHand: {
          'Example pay': 'income -',
          'Example pay back': 'income -',
          'Example return': 'expense -',
          'Example shop': 'expense -',
        },
        byCron: {
          'Example pay': 'income -',
          'Example pay back': 'expense -',
          'Example return': 'income -',
          'Example shop': 'expense -',
        },
      },
    ];
    for (const { name, csv, byHand, byCron } of cases) {
      sheets.set(name, csv);
      for (const table of ['transactions', 'accounts', 'categories', 'import_sources']) {
        await env.DB.prepare(`DELETE FROM ${table}`).run();
      }
      await syncByHand(name, null);
      await syncByCron(name, null);
      expect(await booked(BY_HAND), name).toEqual(byHand);
      expect(await booked(BY_CRON), name).toEqual(byCron);
    }
  });
});
