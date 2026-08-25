import { Hono } from 'hono';
import * as XLSX from 'xlsx';
import { transactionInvariantError } from '../../../shared/transactionInvariant';
import { parseImportCsv } from '../../../shared/importCsv';
import { importRowLabel } from '../../../shared/importRowLabel';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import { parseImportNumber } from '../import-number';
import {
  checkImportRowNumbers,
  MISSING_DATE_WARNING,
  unreadableNumbersReason,
} from '../../../shared/importRowChecks';
import type { ImportRowWarning } from '../../../shared/importRowChecks';
import { enforce } from '../ratelimit';
import * as db from '../db';
import { normalizeCurrencyCode } from '../currency';
import { resolveProfileBaseCurrency } from '../base-currency';
import { recomputeBalancesForAccounts } from '../recompute-balances';

// Parse CSV text into headers + data rows. The implementation moved to shared/ so this and the
// frontend's copy stop drifting; re-exported under the old name so existing call sites and tests
// keep working.
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  return parseImportCsv(text);
}

// Port of backend/routes/importRoutes.js.
//
// What's ported (pure DB / pure-JS text work — Workers-safe):
//   - POST /api/import/execute    — insert transactions (+ create accounts/categories
//                                   on the fly) from an already-parsed JSON `rows` array.
//   - POST /api/import/googlesheet — fetch a published Google Sheet as CSV and parse it
//                                   in pure JS (preview only; the actual insert is /execute).
//
// What's left 501 (needs a Workers-compatible spreadsheet parser + R2/upload handling):
//   - POST /api/import/upload      — multipart xlsx/csv FILE upload + SheetJS parse.
//   - POST /api/import/file-sheet  — re-read a previously uploaded workbook by fileId.
//   - the XLSX fallback branch of /googlesheet (when CSV export isn't available) also
//     depends on the spreadsheet parser, so it surfaces a 501-style error there.
export const importRoutes = new Hono<AppEnv>();

// ── getCategoryIcon — ported verbatim from backend/utils.js ───────────────────
// Maps a category name to an icon key when /execute auto-creates a category.
function getCategoryIcon(name: string): string {
  const lower = name.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i, 'car'],
    [/food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i, 'coffee'],
    [/hous|rent|mortgage|home|lease|property|real\s*estate/i, 'home'],
    [/utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i, 'zap'],
    [
      /entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i,
      'film',
    ],
    [/shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i, 'shopping-cart'],
    [
      /health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i,
      'heart',
    ],
    [/edu|school|college|university|tuition|book|course|class|learn|study|student/i, 'book'],
    [/travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i, 'plane'],
    [/insur/i, 'shield'],
    [/sav|invest|retire|ira|401|stock|broker|dividend|interest/i, 'trending-up'],
    [/phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i, 'smartphone'],
    [/gift|donat|charit|present/i, 'gift'],
    [/pet|dog|cat|animal/i, 'smile'],
    [/fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i, 'bar-chart-2'],
    [/subscri|member|recur/i, 'arrow-right'],
    [/child|kid|baby|daycare|nanny|babysit|school\s*supp/i, 'baby'],
    [/beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i, 'sun'],
    [/business|work|office|supplies|desk/i, 'briefcase'],
    [/tax|irs|government/i, 'folder'],
    [/credit|debt|loan|card|payment/i, 'creditcard'],
    [/income|salary|wage|paycheck|payroll|earn|revenue|reimbursement/i, 'dollar-sign'],
    [/misc|other|general|uncategor|unknown|various|catch.?all/i, 'more-horizontal'],
    [/bill/i, 'file-text'],
  ];
  for (const [pattern, icon] of patterns) {
    if (pattern.test(lower)) return icon;
  }
  return 'tag';
}

// ── parseDateString — ported from importRoutes.parseDateString ────────────────
// Ported with two audit fixes (I2):
//   1. An out-of-range month/day no longer silently rolls into another month/year.
//      The old `new Date(y, m-1, d)` turned "04/13/2026" into Jan 2027 (month index 12
//      overflows to the next year); it now counts as unparseable and falls back to today().
//   2. The final date is formatted from the explicit y/m/d integers as `${y}-${pad(m)}-${pad(d)}`
//      rather than via `new Date(...).toISOString()`, so the runtime timezone can never shift
//      the calendar day. For strings only the JS Date parser understands, UTC parts are used.
//
// The numeric Excel-serial branch is dropped: it relied on spreadsheetService and only fires for
// binary-spreadsheet imports, which aren't supported on Workers.
function parseDateString(dateStr: unknown): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = () => new Date().toISOString().split('T')[0];
  const inRange = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const format = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  if (dateStr === null || dateStr === undefined || dateStr === '') return today();
  const s = String(dateStr).trim();

  // ISO yyyy-mm-dd (the unambiguous, leading form): take the parts verbatim.
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1]!, 10);
    const m = parseInt(isoMatch[2]!, 10);
    const d = parseInt(isoMatch[3]!, 10);
    return inRange(m, d) ? format(y, m, d) : today();
  }

  // nn[/.-]nn[/.-]yyyy — ambiguous day/month order. Resolve by range:
  //   first > 12  → day-first;   second > 12 → month-first;
  //   both <= 12  → day-first (this app targets EU banks);   both > 12 → invalid.
  const dmyMatch = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmyMatch) {
    const a = parseInt(dmyMatch[1]!, 10);
    const b = parseInt(dmyMatch[2]!, 10);
    const y = parseInt(dmyMatch[3]!, 10);
    let d: number;
    let m: number;
    if (a > 12 && b <= 12) {
      d = a;
      m = b; // day-first
    } else if (b > 12 && a <= 12) {
      m = a;
      d = b; // month-first
    } else if (a <= 12 && b <= 12) {
      d = a;
      m = b; // ambiguous → day-first (EU default)
    } else {
      return today(); // both > 12 → unparseable
    }
    return inRange(m, d) ? format(y, m, d) : today();
  }

  // Anything else the JS Date parser understands (e.g. "Apr 13 2026", ISO datetimes).
  // Format from UTC parts so a calendar day is never shifted by the runtime timezone
  // (a bare Excel serial isn't handled here — that branch is intentionally dropped, above).
  const date = new Date(s);
  if (!isNaN(date.getTime())) {
    return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return today();
}

// Cap the uploaded file size BEFORE parsing (S8). /import/upload parses xlsx/csv entirely in
// memory, so an unbounded body is a memory-exhaustion vector; 10 MB comfortably covers real
// bank exports. Mirrors the RECEIPT_MAX_BYTES guard in routes/receipts.ts.
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

// Pull a value from a row using any of the casing variants the Express code checks.
function pick(row: Record<string, any>, mapping: Record<string, any>, key: string): any {
  const variants = [key, key.charAt(0).toUpperCase() + key.slice(1), key.toUpperCase()];
  // Also support the CamelCase forms used for compound mapping keys.
  const camelMap: Record<string, string[]> = {
    amount_local: ['AmountLocal'],
    means_of_payment: ['MeansOfPayment', 'MEANS_OF_PAYMENT'],
    exchange_rate: ['ExchangeRate'],
  };
  if (camelMap[key]) variants.push(...camelMap[key]);
  for (const v of variants) {
    const colIdx = mapping[v];
    if (colIdx === undefined) continue;
    const cell = row[colIdx];
    if (cell !== undefined) return cell;
  }
  return undefined;
}

const NEW_CATEGORY_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#64748b',
  '#78716c',
];

const INCOME_KEYWORDS = [
  'salary',
  'income',
  'wages',
  'wage',
  'payroll',
  'revenue',
  'dividend',
  'refund',
  'bonus',
  'paycheck',
  'pay cheque',
  'interest',
  'credit',
  'received',
  'royalt',
  'reimbursement',
];

// ── POST /api/import/upload — parse an xlsx/csv FILE and return a preview ──────
// SheetJS parses the workbook in-memory (Workers-safe); CSV is parsed in pure JS.
// Stateless: pass an optional `sheetName` field to read a specific tab. The response
// lists all sheetNames so the client can re-call /upload to switch sheets (this
// replaces the old stateful upload->fileId->file-sheet flow). The parsed rows then
// go to POST /api/import/execute.
importRoutes.post('/api/import/upload', requireAuth, async (c) => {
  const rl = await enforce(c, `import:${c.get('userId')}`, 30, 300);
  if (rl) return rl;
  const body = await c.req.parseBody();
  const file = body['file'] ?? body['import'];
  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded');
  // Size cap BEFORE parsing (S8): refuse an oversized workbook rather than parse it in memory.
  if (file.size > IMPORT_MAX_BYTES) {
    throw new HttpError(
      413,
      `File too large (max ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)}MB)`
    );
  }
  const requested =
    typeof body['sheetName'] === 'string' ? (body['sheetName'] as string) : undefined;
  const buf = new Uint8Array(await file.arrayBuffer());

  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const { headers, rows } = parseCsv(new TextDecoder().decode(buf));
    return c.json({ headers, rows, selectedSheet: 'CSV', sheetNames: ['CSV'] });
  }

  const wb = XLSX.read(buf, { type: 'array' });
  const sheetNames = wb.SheetNames;
  const selected = requested && sheetNames.includes(requested) ? requested : sheetNames[0];
  if (!selected) throw new HttpError(400, 'Spreadsheet has no sheets');
  const matrix = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[selected]!, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  const headers = (matrix[0] as any[] | undefined)?.map((h) => String(h ?? '')) ?? [];
  const rows = matrix
    .slice(1)
    .filter((r) => Array.isArray(r) && r.some((cell) => cell !== '' && cell != null));
  return c.json({ headers, rows, selectedSheet: selected, sheetNames });
});

// ── POST /api/import/file-sheet — obsolete on Workers ─────────────────────────
// The old flow kept the parsed workbook server-side keyed by fileId (in-memory),
// which isn't possible on stateless Workers. Re-call /api/import/upload with a
// `sheetName` field instead (the file is re-parsed in-memory).
importRoutes.post('/api/import/file-sheet', requireAuth, async (c) => {
  return c.json(
    { error: 'Re-upload via /api/import/upload with a sheetName field (stateless Worker flow).' },
    410
  );
});

// ── fetchGoogleSheetRows — fetch + parse a published sheet as CSV (Workers-safe) ──
// Extracted from the HTTP handler so the route, the daily cron sync and email-in can all call
// it. Returns a { status, body } pair. Pure-JS CSV path only; the XLSX fallback (multi-tab
// enumeration) needs a spreadsheet parser and still surfaces as a 501-style error.
export async function fetchGoogleSheetRows(
  url: unknown,
  sheetName?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!url) return { status: 400, body: { error: 'URL is required' } };
  const idMatch = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return { status: 400, body: { error: 'Invalid Google Sheets URL or ID' } };
  const sheetId = idMatch[1];
  const gidMatch = String(url).match(/[?&#]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;
  try {
    const csvUrl = gid
      ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
      : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const r = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('Sheet is not publicly accessible (got HTML instead of CSV)');
    }
    const { headers, rows } = parseCsv(text);
    if (headers.length > 0) {
      return {
        status: 200,
        body: {
          headers,
          rows,
          selectedSheet: sheetName || 'Sheet1',
          sheetNames: [sheetName || 'Sheet1'],
        },
      };
    }
    throw new Error('No rows found');
  } catch (err) {
    // CSV export failed / returned nothing. The Express fallback parses the XLSX export to
    // enumerate tabs, which the spreadsheet parser can't do on Workers yet.
    return {
      status: 501,
      body: {
        error:
          'Could not import this Google Sheet via CSV export: ' +
          (err as Error).message +
          ". Make sure the sheet is shared as 'Anyone with link can view'. " +
          'The XLSX fallback is not available on this deployment yet.',
      },
    };
  }
}

// ── POST /api/import/googlesheet — fetch + parse a published sheet as CSV ──────
importRoutes.post('/api/import/googlesheet', requireAuth, async (c) => {
  const rl = await enforce(c, `import:${c.get('userId')}`, 30, 300);
  if (rl) return rl;
  const b = (await c.req.json()) as Record<string, any>;
  const { status, body } = await fetchGoogleSheetRows(b.url, b.sheetName);
  return c.json(body, status as 200);
});

// ── Import core: executeImport ────────────────────────────────────────────────
// The insert+dedup engine, extracted from the HTTP handler so the route, the daily cron sheet
// sync and email-in share ONE implementation (no Hono context). Returns a { status, body } pair
// the route turns into a JSON response. Creates accounts for category names typed as 'account',
// creates missing categories, inserts each transaction scoped to `pid`, then recomputes affected
// account balances. `mapping` is field→column-index and `rows` are arrays, as the client sends.
export interface ExecuteImportInput {
  rows: any;
  mapping: any;
  categoryTypes?: any;
  accountTypes?: any;
  accountBalances?: any;
  accountBalanceDates?: any;
  importId?: string | null;
  dryRun?: boolean;
  approvedCategories?: any;
  defaultCurrency?: any;
}

export async function executeImport(
  DB: D1Database,
  pid: number,
  input: ExecuteImportInput
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rows = input.rows;
  const mapping = input.mapping;
  if (!rows || !mapping) return { status: 400, body: { error: 'Missing data' } };
  const pids = [pid];
  const inClause = pids.map(() => '?').join(',');
  const categoryTypes = input.categoryTypes;
  const accountTypes = input.accountTypes;
  const accountBalances = input.accountBalances;
  const accountBalanceDates = input.accountBalanceDates;
  // Stable client-supplied id for this import; stamped on every row so a retry is idempotent
  // (the prior attempt's rows are deleted first). Null → unchanged behaviour.
  const importId = input.importId ?? null;
  // Preview mode: compute new_categories + duplicate estimate WITHOUT mutating (B5/A2).
  const dryRun = Boolean(input.dryRun);
  // Category-creation gating (audit B5): when `approvedCategories` is present — even as an empty
  // array — a new category is only created when its name is in the approved list; unapproved rows
  // import uncategorized. Absent (undefined) → auto-create-all (backward-compat).
  const approvedRaw = input.approvedCategories;
  const gateCategories = approvedRaw !== undefined;
  const approvedCats = new Set(
    (Array.isArray(approvedRaw) ? approvedRaw : []).map((s: unknown) =>
      String(s).trim().toLowerCase()
    )
  );

  const today = () => new Date().toISOString().split('T')[0];

  // name(lowercased) -> accountId, seeded with the profile(s)' existing accounts.
  const accountIdMap = new Map<string, number>();
  // id → display name, so a rejection can name the account rather than quote a bare id.
  const accountNameById = new Map<number, string>();
  const loadAccounts = async () => {
    const accs = await db.all<{ id: number; name: string }>(
      DB,
      `SELECT id, name FROM accounts WHERE profile_id IN (${inClause})`,
      ...pids
    );
    // Trim as well as lowercase: the row-side resolution trims the category /
    // means_of_payment value, so a stored account name with stray whitespace (e.g.
    // "Revolut ") must key on the trimmed form or the transfer's destination leg never
    // resolves and shows "Erste Current -> —".
    for (const a of accs) accountIdMap.set(a.name.trim().toLowerCase(), a.id);
    for (const a of accs) accountNameById.set(a.id, a.name);
  };
  await loadAccounts();

  // Currency for accounts this import creates — the client's base currency (Settings; EUR by
  // default), falling back to EUR when the request does not contain a valid code.
  const requestedCurrency = input.defaultCurrency;
  const defaultCurrency = await resolveProfileBaseCurrency(DB, pid, requestedCurrency, !dryRun);
  const rowsArr = rows as Array<Record<string, any>>;
  const skippedItems: Array<{ index: number; reason: string; label?: string }> = [];
  const warnings: ImportRowWarning[] = [];
  const validatedRows: Array<{
    index: number;
    row: Record<string, any>;
    amountRaw: number;
    amount: number;
    amountLocal: number;
    exchangeRate: number;
  }> = [];
  for (let index = 0; index < rowsArr.length; index++) {
    const row = rowsArr[index]!;
    const rawDate = pick(row, mapping, 'date');
    const label = importRowLabel(rawDate, pick(row, mapping, 'description'));
    const checked = checkImportRowNumbers({
      amount: pick(row, mapping, 'amount'),
      amountLocal: pick(row, mapping, 'amount_local'),
      exchangeRate: pick(row, mapping, 'exchange_rate'),
    });
    const { amount: amountRaw, amountLocal, exchangeRate } = checked;
    if (
      checked.invalidFields.length > 0 ||
      amountRaw === null ||
      amountLocal === null ||
      exchangeRate === null
    ) {
      skippedItems.push({
        index,
        reason: unreadableNumbersReason(checked.invalidFields),
        label,
      });
      continue;
    }
    // A row that still imports but deserves a look: a rounded amount, or a date the sheet did not
    // give (parseDateString falls back to today, which is a guess the user must be told about).
    for (const reason of checked.warnings) warnings.push({ index, reason, label });
    if (String(rawDate ?? '').trim() === '') {
      warnings.push({ index, reason: MISSING_DATE_WARNING, label });
    }
    validatedRows.push({
      index,
      row,
      amountRaw,
      amount: Math.abs(amountRaw),
      amountLocal: Math.abs(amountLocal),
      exchangeRate,
    });
  }
  const validRows = validatedRows.map(({ row }) => row);

  // Batch-create accounts for the category names the user flagged as 'account' type (+ history).
  // Skipped in dry-run (preview must not mutate).
  let accountsCreated = 0;
  const createdAccountNames: string[] = [];
  const validAccountNames = new Set(
    validRows
      .flatMap((row) => [
        String(pick(row, mapping, 'category') || ''),
        String(pick(row, mapping, 'means_of_payment') || ''),
      ])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
  const accountValidationErrors: Array<{ field: string; reason: string }> = [];
  const toCreate = Object.entries((categoryTypes || {}) as Record<string, string>)
    .filter(
      ([name, type]) =>
        type === 'account' &&
        (rowsArr.length === 0 || validAccountNames.has(String(name).trim().toLowerCase())) &&
        !accountIdMap.has(String(name).trim().toLowerCase())
    )
    .map(([name]) => {
      const rawBalance = (accountBalances && accountBalances[name]) || '';
      const balance =
        String(rawBalance).trim() === '' ? 0 : parseImportNumber(String(rawBalance).trim());
      if (balance === null) {
        accountValidationErrors.push({
          field: `accountBalances.${name}`,
          reason: 'Use an unambiguous number such as 1234.56 or 1.234,56.',
        });
      }
      return {
        name: name.trim(),
        accType: (accountTypes && accountTypes[name]) || 'giro',
        balance: balance ?? 0,
        balanceDate: (accountBalanceDates && accountBalanceDates[name]) || today(),
      };
    });
  if (accountValidationErrors.length > 0) {
    return {
      status: 422,
      body: {
        error: 'One or more account starting balances are invalid or ambiguous.',
        validation_errors: accountValidationErrors,
        skipped_items: skippedItems,
        warnings,
      },
    };
  }
  if (!dryRun && toCreate.length > 0) {
    if (toCreate.length) {
      await DB.batch(
        toCreate.map((a) =>
          DB.prepare(
            'INSERT INTO accounts (name, type, currency, balance, notes, profile_id, starting_balance, starting_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(a.name, a.accType, defaultCurrency, a.balance, '', pid, a.balance, a.balanceDate)
        )
      );
      await loadAccounts(); // pick up the new ids
      accountsCreated = toCreate.length;
      createdAccountNames.push(...toCreate.map((a) => a.name));
      const hist = toCreate
        .map((a) => {
          const id = accountIdMap.get(a.name.trim().toLowerCase());
          return id
            ? DB.prepare(
                'INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)'
              ).bind(id, a.balance, a.balanceDate)
            : null;
        })
        .filter((s): s is D1PreparedStatement => s !== null);
      if (hist.length) await DB.batch(hist);
    }
  }

  if (dryRun && toCreate.length > 0) {
    // A preview must answer for the state the import will PRODUCE, not the state before it
    // runs. Nothing is inserted in a dry run, so these accounts still have no ids, and every
    // transfer naming one is reported as `no account named "X"`. On a FIRST import -- where
    // every account in the sheet is about to be created -- that is every transfer row in the
    // file, so the user is told thousands of rows are broken when the real import accepts all
    // of them (accounts are created above, before the row loop). Stand placeholder ids in for
    // the rows the real run will insert. They count down from MAX_SAFE_INTEGER: distinct, so
    // the "both sides resolve to the same account" check still fires, and positive, because
    // the shared invariant rejects a non-positive account id. The dry run returns at the early
    // exit below without ever writing a transaction or recomputing a balance with one.
    let placeholder = Number.MAX_SAFE_INTEGER;
    for (const a of toCreate) {
      const lower = a.name.trim().toLowerCase();
      if (!accountIdMap.has(lower)) accountIdMap.set(lower, placeholder--);
    }
  }

  // Existing categories -> map, then batch-create the DISTINCT new, non-account names.
  const categoryMap = new Map<string, number>();
  const loadCategories = async () => {
    const cats = await db.all<{ id: number; name: string }>(
      DB,
      'SELECT id, name FROM categories WHERE profile_id = ?',
      pid
    );
    for (const cat of cats) categoryMap.set(cat.name.toLowerCase(), cat.id);
  };
  await loadCategories();

  let colorIndex = 0;
  const newCats: string[] = [];
  const seenNew = new Set<string>();
  for (const row of validRows) {
    const raw = pick(row, mapping, 'category');
    if (!raw || !String(raw).trim()) continue;
    const name = String(raw).trim();
    const lower = name.toLowerCase();
    // Skip names that already exist, are already queued, or are an account (Means-of-Payment /
    // transfer target) — those must NOT become 'account'-typed categories.
    if (categoryMap.has(lower) || seenNew.has(lower) || accountIdMap.has(lower)) continue;
    seenNew.add(lower);
    newCats.push(name);
  }
  // Account-typed values that don't already name an existing account — the accounts a run
  // would CREATE. Surfaced so the preview can show new accounts (parity with the serverless
  // detectNewAccounts). accountIdMap holds the existing accounts, so "not in it" == new.
  //
  // TWO columns, not one. A transfer's destination comes from Category and its SOURCE comes from
  // Means of Payment, and this scanned only Category — so a Means-of-Payment value was
  // enumerated nowhere, offered nowhere, and never created. On a profile with no accounts yet
  // that rejects every single transfer row for a missing source, which is exactly what a first
  // import looks like. A Means-of-Payment value needs no `categoryTypes` marking to qualify:
  // it is the account the money moved from, by definition of the column.
  const newAccts: string[] = [];
  const seenAcct = new Set<string>();
  const ctLower: Record<string, string> = {};
  if (categoryTypes)
    for (const [k, v] of Object.entries(categoryTypes)) ctLower[k.toLowerCase().trim()] = String(v);
  const offerAccount = (raw: unknown) => {
    if (!raw || !String(raw).trim()) return;
    const name = String(raw).trim();
    const lower = name.toLowerCase();
    if (accountIdMap.has(lower) || seenAcct.has(lower)) return;
    seenAcct.add(lower);
    newAccts.push(name);
  };
  /*
   * A row the sheet itself calls a transfer names an account in BOTH columns, whatever anyone
   * marked. The destination of a transfer is an account by definition — there is no reading of
   * "transfer to Groceries" that makes Groceries a category — so a `type` of transfer is enough
   * to offer the Category value, without waiting for a `categoryTypes` marking that a first-time
   * import has no way to have set yet.
   */
  const rowIsTransfer = (row: Record<string, unknown>) =>
    mapping.type !== undefined &&
    String(pick(row, mapping, 'type') || '')
      .trim()
      .toLowerCase() === 'transfer';

  for (const row of validRows) {
    const raw = pick(row, mapping, 'category');
    const markedAccount =
      raw && String(raw).trim() && ctLower[String(raw).trim().toLowerCase()] === 'account';
    if (markedAccount || rowIsTransfer(row)) offerAccount(raw);
    offerAccount(pick(row, mapping, 'means_of_payment'));
  }
  // Only create approved names when gating is on; unapproved values import uncategorized
  // (category_id resolves to null below). Absent → create every new name (backward-compat).
  const catsToCreate = gateCategories
    ? newCats.filter((name) => approvedCats.has(name.toLowerCase()))
    : newCats;
  if (!dryRun && catsToCreate.length) {
    await DB.batch(
      catsToCreate.map((name) => {
        const color = NEW_CATEGORY_COLORS[colorIndex % NEW_CATEGORY_COLORS.length];
        colorIndex++;
        const catType =
          (categoryTypes && categoryTypes[name]) ||
          (INCOME_KEYWORDS.some((kw) => name.toLowerCase().includes(kw)) ? 'income' : 'expense');
        return DB.prepare(
          'INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, ?, ?, ?)'
        ).bind(name, catType, color, getCategoryIcon(name), pid);
      })
    );
    await loadCategories();
  }

  // Build all transaction inserts, then flush in chunks — one D1 round-trip per chunk instead of
  // one per row (the old per-row loop was the hang for large imports).
  const TX_SQL = `INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id, account_id, transfer_account_id, import_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const txStmts: D1PreparedStatement[] = [];

  // Resolution-aware duplicate detection (audit A2), matching the serverless import.
  // Key on the RESOLVED (date, lowercased description, account_id, type, currency) with a
  // ±0.01 amount tolerance; two rows that share only date+description+amount but differ in
  // account/type/currency get different keys and both import. Dedup against existing stored
  // transactions AND rows accepted earlier in THIS import. Rows belonging to the current
  // importId are excluded from the existing set — a retry deletes and re-inserts them, so they
  // must not count as their own duplicates.
  const dedupKeyOf = (
    date: string,
    desc: string,
    accountId: number | null,
    type: string,
    currency: string
  ): string => `${date}\x00${desc}\x00${accountId ?? ''}\x00${type}\x00${currency}`;
  const existingForDedup = await db.all<{
    date: string;
    description: string | null;
    amount: number;
    type: string | null;
    currency: string | null;
    account_id: number | null;
  }>(
    DB,
    `SELECT date, description, amount, type, currency, account_id FROM transactions
       WHERE profile_id = ?${importId ? ' AND (import_id IS NULL OR import_id != ?)' : ''}`,
    ...(importId ? [pid, importId] : [pid])
  );
  const dedupBuckets = new Map<string, number[]>();
  for (const t of existingForDedup) {
    const k = dedupKeyOf(
      String(t.date ?? ''),
      String(t.description ?? '')
        .toLowerCase()
        .trim(),
      t.account_id ?? null,
      String(t.type ?? ''),
      normalizeCurrencyCode(t.currency, defaultCurrency)
    );
    const amt = Math.abs(Number(t.amount));
    const bucket = dedupBuckets.get(k);
    if (bucket) bucket.push(amt);
    else dedupBuckets.set(k, [amt]);
  }
  const duplicateIndices: number[] = [];

  for (const validated of validatedRows) {
    const { index: ri, row, amountRaw, amount, amountLocal, exchangeRate } = validated;
    const catRaw = pick(row, mapping, 'category');
    const catName = catRaw ? String(catRaw).trim() : '';
    const catLower = catName.toLowerCase();
    const categoryId = catLower && categoryMap.has(catLower) ? categoryMap.get(catLower)! : null;

    const dateRaw = pick(row, mapping, 'date') ?? today();
    const currency = normalizeCurrencyCode(pick(row, mapping, 'currency'), defaultCurrency);
    const catType = catName ? categoryTypes && categoryTypes[catName] : null;

    // Determine transaction type (mirrors the Express precedence exactly).
    let validatedType: string;
    if (mapping.type !== undefined) {
      const rawType = String(pick(row, mapping, 'type') || '')
        .trim()
        .toLowerCase();
      if (['income', 'expense', 'transfer'].includes(rawType)) {
        validatedType = rawType;
      } else if (catType && (catType === 'income' || catType === 'expense')) {
        validatedType = catType;
      } else {
        validatedType =
          amountRaw < 0 ||
          rawType.includes('expense') ||
          rawType.includes('debit') ||
          rawType.includes('spent')
            ? 'expense'
            : amountRaw > 0 ||
                rawType.includes('income') ||
                rawType.includes('credit') ||
                rawType.includes('received')
              ? 'income'
              : 'expense';
      }
    } else if (catType && (catType === 'income' || catType === 'expense')) {
      validatedType = catType;
    } else {
      validatedType = amountRaw < 0 ? 'expense' : amountRaw > 0 ? 'income' : 'expense';
    }

    // account_id from Means of Payment (FROM), transfer_account_id from Category (TO).
    const mopName = pick(row, mapping, 'means_of_payment') || '';
    const accountId = mopName
      ? accountIdMap.get(String(mopName).trim().toLowerCase()) || null
      : null;
    const transferAccountId = catLower ? accountIdMap.get(catLower) || null : null;

    const description = pick(row, mapping, 'description') || '';
    const parsedDate = parseDateString(dateRaw);
    const invariantError = transactionInvariantError({
      type: validatedType,
      amount,
      amount_local: amountLocal,
      account_id: accountId,
      transfer_account_id: transferAccountId,
    });
    if (invariantError) {
      // The invariant lives in shared/ and only sees ids, so on its own it says "a transfer must
      // have both source and destination accounts" — which names neither the side that is missing
      // nor the cell to go and fix. Repeated over a few hundred rows that is unreadable, and it is
      // the reported experience: 341 identical lines and nothing to act on. Say which side failed
      // and quote the value that did not resolve.
      const detail = (() => {
        if (validatedType !== 'transfer') return undefined;
        if (accountId !== null && accountId === transferAccountId) {
          const name = accountNameById.get(accountId);
          return `both sides resolve to "${name}" (source comes from Means of Payment, destination from Category)`;
        }
        const missing: string[] = [];
        if (accountId === null) {
          missing.push(
            mopName
              ? `no account named "${String(mopName).trim()}" (Means of Payment, the source)`
              : 'the Means of Payment cell is empty, so there is no source account'
          );
        }
        if (transferAccountId === null) {
          const cat = pick(row, mapping, 'category');
          missing.push(
            cat && String(cat).trim()
              ? `no account named "${String(cat).trim()}" (Category, the destination)`
              : 'the Category cell is empty, so there is no destination account'
          );
        }
        return missing.length ? missing.join('; ') : undefined;
      })();
      skippedItems.push({
        index: ri,
        reason: detail ? `${invariantError} — ${detail}` : invariantError,
        label: importRowLabel(dateRaw, description),
      });
      continue;
    }
    // Multiplicity-aware duplicate check on the resolved fields: skip a row only when it
    // matches a transaction that ALREADY EXISTED before this import, consuming one match per
    // row. Accepted rows are never added back into the bucket, so genuine same-day repeats in
    // this import all import (multiple bank fees, repeated top-ups) instead of collapsing to
    // one. A re-import still dedupes: the existing copies consume the incoming ones one-for-one.
    const dedupKey = dedupKeyOf(
      parsedDate,
      String(description).toLowerCase().trim(),
      accountId,
      validatedType,
      currency
    );
    const dupBucket = dedupBuckets.get(dedupKey);
    const matchAt = dupBucket ? dupBucket.findIndex((a) => Math.abs(a - amount) < 0.01) : -1;
    if (matchAt !== -1) {
      dupBucket!.splice(matchAt, 1);
      duplicateIndices.push(ri);
      continue;
    }

    txStmts.push(
      DB.prepare(TX_SQL).bind(
        description,
        amount,
        parsedDate,
        pick(row, mapping, 'beneficiary') || '',
        pick(row, mapping, 'payor') || '',
        categoryId,
        currency,
        amountLocal,
        mopName,
        exchangeRate,
        validatedType,
        pick(row, mapping, 'notes') || '',
        pid,
        accountId,
        transferAccountId,
        importId
      )
    );
  }

  // Preview mode: report what WOULD be created without mutating anything (B5/A2).
  if (dryRun) {
    return {
      status: 200,
      body: {
        imported: txStmts.length,
        skipped: skippedItems.length,
        skipped_items: skippedItems,
        warnings,
        dry_run: true,
        duplicates: duplicateIndices.length,
        duplicate_indices: duplicateIndices,
        new_categories: newCats,
        new_accounts: newAccts,
        accounts_created: 0,
        categories_created: 0,
        created_accounts: [],
        created_categories: [],
        message: 'Dry run — no changes made',
      },
    };
  }

  // Idempotent retry: drop any rows a prior (partial) run of THIS import created before re-inserting,
  // so a retry can't duplicate transactions. Balances are recomputed from the survivors below.
  if (importId) {
    await db.run(
      DB,
      'DELETE FROM transactions WHERE profile_id = ? AND import_id = ?',
      pid,
      importId
    );
  }
  const CHUNK = 100;
  for (let i = 0; i < txStmts.length; i += CHUNK) {
    await DB.batch(txStmts.slice(i, i + CHUNK));
  }
  const imported = txStmts.length;

  // Recompute balances for ALL the profile's accounts (preserves the original's self-healing pass),
  // via the shared recompute routine (also used by POST /api/accounts/recompute-balances) so the
  // two never diverge.
  await recomputeBalancesForAccounts(DB, [...accountIdMap.values()]);

  return {
    status: 200,
    body: {
      imported,
      skipped: skippedItems.length,
      skipped_items: skippedItems,
      warnings,
      duplicates: duplicateIndices.length,
      duplicate_indices: duplicateIndices,
      new_categories: newCats,
      new_accounts: newAccts,
      accounts_created: accountsCreated,
      categories_created: catsToCreate.length,
      created_accounts: createdAccountNames,
      created_categories: catsToCreate,
      message: `Successfully imported ${imported} transactions`,
    },
  };
}

// ── POST /api/import/execute — insert transactions from a parsed JSON `rows` ──
importRoutes.post('/api/import/execute', requireAuth, async (c) => {
  const rl = await enforce(c, `import:${c.get('userId')}`, 30, 300);
  if (rl) return rl;
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const importId = typeof b.importId === 'string' && b.importId ? b.importId : null;
  const { status, body } = await executeImport(c.env.DB, pid, {
    rows: b.rows,
    mapping: b.mapping,
    categoryTypes: b.categoryTypes,
    accountTypes: b.accountTypes,
    accountBalances: b.accountBalances,
    accountBalanceDates: b.accountBalanceDates,
    importId,
    dryRun: Boolean(b.dry_run ?? b.dryRun),
    approvedCategories: b.approvedCategories ?? b.createCategories,
    defaultCurrency: b.defaultCurrency,
  });
  return c.json(body, status as 200);
});
