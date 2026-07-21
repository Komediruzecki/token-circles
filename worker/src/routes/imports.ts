import { Hono } from 'hono';
import * as XLSX from 'xlsx';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { HttpError } from '../http';
import { enforce } from '../ratelimit';
import * as db from '../db';
import { recomputeBalancesForAccounts } from '../recompute-balances';

// Parse CSV text into headers + data rows (quoted-field aware). Pure JS.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const all: string[][] = [];
  for (const line of text.trim().split('\n')) {
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim().replace(/^"|"$/g, ''));
        cur = '';
      } else cur += ch;
    }
    cols.push(cur.trim().replace(/^"|"$/g, ''));
    all.push(cols);
  }
  const headers = all[0] || [];
  const rows = all.slice(1).filter((row) => row.some((cell) => cell));
  return { headers, rows };
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

// ── parseFlexibleAmount — mirror of the frontend bankImport parseFlexibleNumber (I1) ──
// EU bank exports write amounts with either convention. When BOTH separators are present the
// LAST one is the decimal separator ("1.234,56" and "1,234.56" both → 1234.56); a lone comma is
// a decimal comma ("1234,56" → 1234.56); otherwise it is a plain dot-decimal number. A value that
// is already a JS number passes straight through. Unparseable → 0 (the prior `Number()`/`|| 0`
// default). Used for the transaction amount(s) that feed account balances in /import/execute.
function parseFlexibleAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const s = String(value).replace(/\s/g, '');
  if (!s) return 0;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  // European: strip '.' thousands, treat ',' as the decimal point.
  const european = () => parseFloat(s.replace(/\./g, '').replace(',', '.'));
  // US/JS: strip ',' thousands, '.' is already the decimal point.
  const dot = () => parseFloat(s.replace(/,/g, ''));
  let n: number;
  if (hasDot && hasComma) {
    n = s.lastIndexOf(',') > s.lastIndexOf('.') ? european() : dot();
  } else if (hasComma) {
    n = european();
  } else {
    n = dot();
  }
  return Number.isFinite(n) ? n : 0;
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

// ── POST /api/import/googlesheet — fetch + parse a published sheet as CSV ──────
// Pure-JS CSV path is ported (handles quoted fields). The XLSX fallback (used when
// the sheet can't be exported as CSV, or to enumerate multiple tab names) needs the
// spreadsheet parser and is reported as a 501-style error.
importRoutes.post('/api/import/googlesheet', requireAuth, async (c) => {
  const rl = await enforce(c, `import:${c.get('userId')}`, 30, 300);
  if (rl) return rl;
  const b = (await c.req.json()) as Record<string, any>;
  const { url, sheetName } = b;
  if (!url) throw new HttpError(400, 'URL is required');

  const idMatch = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new HttpError(400, 'Invalid Google Sheets URL or ID');
  const sheetId = idMatch[1];
  const gidMatch = String(url).match(/[?&#]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  // CSV export (respects a specific tab via gid). Pure JS — Workers-safe.
  async function tryCsvExport(): Promise<
    | {
        headers: string[];
        rows: string[][];
        sheetName: string;
      }
    | { error: string }
  > {
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
      const rows: string[][] = [];
      const lines = text.trim().split('\n');
      for (const line of lines) {
        const cols: string[] = [];
        let cur = '';
        let inQuotes = false;
        for (const ch of line) {
          if (ch === '"') inQuotes = !inQuotes;
          else if (ch === ',' && !inQuotes) {
            cols.push(cur.trim().replace(/^"|"$/g, ''));
            cur = '';
          } else cur += ch;
        }
        cols.push(cur.trim().replace(/^"|"$/g, ''));
        rows.push(cols);
      }
      const headers = rows[0] || [];
      const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell));
      return { headers, rows: dataRows, sheetName: sheetName || 'Sheet1' };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  const csvResult = await tryCsvExport();
  if (!('error' in csvResult) && csvResult.headers.length > 0) {
    return c.json({
      headers: csvResult.headers,
      rows: csvResult.rows,
      selectedSheet: csvResult.sheetName,
      sheetNames: [csvResult.sheetName],
    });
  }

  // CSV export failed / returned nothing. The Express fallback parses the XLSX
  // export to enumerate tabs, which the spreadsheet parser can't do on Workers.
  // TODO: needs a Workers-compatible spreadsheet parser + R2/upload handling
  return c.json(
    {
      error:
        'Could not import this Google Sheet via CSV export' +
        ('error' in csvResult && csvResult.error ? ': ' + csvResult.error : '') +
        ". Make sure the sheet is shared as 'Anyone with link can view'. " +
        'The XLSX fallback is not available on this deployment yet.',
    },
    501
  );
});

// ── POST /api/import/execute — insert transactions from a parsed JSON `rows` ──
// Faithful port of the Express handler: creates accounts for category names typed
// as 'account', creates missing categories, inserts each transaction scoped to the
// active profile, then recomputes affected account balances. All pure DB work.
importRoutes.post('/api/import/execute', requireAuth, async (c) => {
  const rl = await enforce(c, `import:${c.get('userId')}`, 30, 300);
  if (rl) return rl;
  const pid = await getProfileId(c);
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const b = (await c.req.json()) as Record<string, any>;
  const { rows, mapping, categoryTypes, accountTypes, accountBalances, accountBalanceDates } = b;
  if (!rows || !mapping) throw new HttpError(400, 'Missing data');
  // Stable client-supplied id for this import; stamped on every row so a retry is idempotent
  // (the prior attempt's rows are deleted first). Null for old clients → unchanged behaviour.
  const importId = typeof b.importId === 'string' && b.importId ? b.importId : null;
  // Preview mode: compute new_categories + duplicate estimate WITHOUT mutating (B5/A2).
  const dryRun = Boolean(b.dry_run ?? b.dryRun);
  // Category-creation gating (audit B5): when `approvedCategories` (alias `createCategories`)
  // is present — even as an empty array — a new category is only created when its name is in
  // the approved list; unapproved rows import uncategorized. Absent → auto-create-all (compat).
  const approvedRaw = b.approvedCategories ?? b.createCategories;
  const gateCategories = approvedRaw !== undefined;
  const approvedCats = new Set(
    (Array.isArray(approvedRaw) ? approvedRaw : []).map((s: unknown) =>
      String(s).trim().toLowerCase()
    )
  );

  const DB = c.env.DB;
  const today = () => new Date().toISOString().split('T')[0];

  // name(lowercased) -> accountId, seeded with the profile(s)' existing accounts.
  const accountIdMap = new Map<string, number>();
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
  };
  await loadAccounts();

  // Batch-create accounts for the category names the user flagged as 'account' type (+ history).
  // Skipped in dry-run (preview must not mutate).
  let accountsCreated = 0;
  const createdAccountNames: string[] = [];
  if (!dryRun && categoryTypes) {
    const toCreate = Object.entries(categoryTypes as Record<string, string>)
      .filter(
        ([name, t]) => t === 'account' && !accountIdMap.has(String(name).trim().toLowerCase())
      )
      .map(([name]) => ({
        name: name.trim(),
        accType: (accountTypes && accountTypes[name]) || 'giro',
        balance: parseFloat((accountBalances && accountBalances[name]) || '0') || 0,
        balanceDate: (accountBalanceDates && accountBalanceDates[name]) || today(),
      }));
    if (toCreate.length) {
      await DB.batch(
        toCreate.map((a) =>
          DB.prepare(
            'INSERT INTO accounts (name, type, currency, balance, notes, profile_id, starting_balance, starting_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(a.name, a.accType, 'USD', a.balance, '', pid, a.balance, a.balanceDate)
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
  for (const row of rows as Array<Record<string, any>>) {
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
  const newAccts: string[] = [];
  const seenAcct = new Set<string>();
  const ctLower: Record<string, string> = {};
  if (categoryTypes)
    for (const [k, v] of Object.entries(categoryTypes)) ctLower[k.toLowerCase().trim()] = String(v);
  for (const row of rows as Array<Record<string, any>>) {
    const raw = pick(row, mapping, 'category');
    if (!raw || !String(raw).trim()) continue;
    const name = String(raw).trim();
    const lower = name.toLowerCase();
    if (ctLower[lower] !== 'account' || accountIdMap.has(lower) || seenAcct.has(lower)) continue;
    seenAcct.add(lower);
    newAccts.push(name);
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
      String(t.currency ?? '') || 'USD'
    );
    const amt = Math.abs(Number(t.amount));
    const bucket = dedupBuckets.get(k);
    if (bucket) bucket.push(amt);
    else dedupBuckets.set(k, [amt]);
  }
  const duplicateIndices: number[] = [];

  const rowsArr = rows as Array<Record<string, any>>;
  for (let ri = 0; ri < rowsArr.length; ri++) {
    const row = rowsArr[ri]!;
    const catRaw = pick(row, mapping, 'category');
    const catName = catRaw ? String(catRaw).trim() : '';
    const catLower = catName.toLowerCase();
    const categoryId = catLower && categoryMap.has(catLower) ? categoryMap.get(catLower)! : null;

    const amountRaw = parseFlexibleAmount(pick(row, mapping, 'amount'));
    const amount = Math.abs(amountRaw);
    const dateRaw = pick(row, mapping, 'date') ?? today();
    const currency = pick(row, mapping, 'currency') || 'USD';
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
        parseFlexibleAmount(pick(row, mapping, 'amount_local') ?? amount) || amount,
        mopName,
        parseFloat(pick(row, mapping, 'exchange_rate') ?? 1.0) || 1.0,
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
    return c.json({
      imported: txStmts.length,
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
    });
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

  return c.json({
    imported,
    duplicates: duplicateIndices.length,
    duplicate_indices: duplicateIndices,
    new_categories: newCats,
    new_accounts: newAccts,
    accounts_created: accountsCreated,
    categories_created: catsToCreate.length,
    created_accounts: createdAccountNames,
    created_categories: catsToCreate,
    message: `Successfully imported ${imported} transactions`,
  });
});
