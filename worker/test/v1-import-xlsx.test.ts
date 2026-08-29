/**
 * Spreadsheet uploads, on both parse paths.
 *
 * The Worker cannot `import 'xlsx'` from shared/ -- the package is installed under frontend/ and
 * worker/, and shared/ sits at the repo root -- so the PBZ adapter takes the module as a
 * parameter and this route supplies `() => import('xlsx')`. That injection is the kind of wiring
 * that typechecks and then fails at runtime, in the one runtime that matters, so it is asserted
 * here inside a real workerd isolate rather than assumed.
 *
 * Workbooks are built in memory. A real bank spreadsheet is personal data and does not belong in
 * the repo.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { signCapability } from '../src/signed-url';

const USER_ID = 9600;
const PROFILE_ID = 9601;
const SECRET = 'test-jwt-secret-not-for-prod';

function sheetToBytes(aoa: unknown[][], bookType: 'xls' | 'xlsx'): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer);
}

/** App-shaped .xlsx: header on row 1, one signed amount column. The generic path's territory. */
const plainXlsx = (): Uint8Array =>
  sheetToBytes(
    [
      ['Date', 'Description', 'Amount', 'Means of Payment'],
      ['2026-07-02', 'Coffee', -3.5, 'Wallet'],
      ['2026-07-03', 'Book', -12.25, 'Wallet'],
    ],
    'xlsx'
  );

/** PBZ's legacy binary .xls: metadata rows, then a header, then data. The adapter's territory. */
const pbzXls = (): Uint8Array =>
  sheetToBytes(
    [
      ['', 'TRANSAKCIJSKI RACUN:', '', '', '', ''],
      ['', 'HR1234567890123456789', '', '', '', ''],
      ['', 'OD:', 'DO:', '', '', ''],
      ['', '01.07.2026', '31.07.2026', '', '', ''],
      ['DATUM', 'VRSTA TRANSAKCIJE', 'OPIS PLACANJA', 'IZNOS', 'VALUTA', ''],
      [new Date(2026, 6, 2), 'POS placanje', 'POS KONZUM ZAGREB', -42.5, ' EUR ', ''],
      [new Date(2026, 6, 5), 'Uplata', 'PLACA', 2500, ' EUR ', ''],
    ],
    'xls'
  );

async function seed(): Promise<void> {
  await env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare('DELETE FROM import_logs WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'xlsx@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'Sheet Profile', ?)"
  )
    .bind(PROFILE_ID, USER_ID)
    .run();
}

async function post(
  body: Uint8Array,
  filename: string,
  query: Record<string, string> = {}
): Promise<Response> {
  const sig = await signCapability(
    { tokenId: 'tok-xlsx', userId: USER_ID, profileId: PROFILE_ID, purpose: 'import' },
    SECRET
  );
  const form = new FormData();
  form.append('file', new File([body], filename, { type: 'application/vnd.ms-excel' }));
  const qs = new URLSearchParams({ sig, mode: 'commit', ...query });
  return SELF.fetch(`https://api.example.com/api/v1/import?${qs}`, { method: 'POST', body: form });
}

describe('POST /api/v1/import - spreadsheets', () => {
  beforeEach(seed);

  it('imports an app-shaped .xlsx through the generic path', async () => {
    const res = await post(plainXlsx(), 'ledger.xlsx');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.parsedBy).toBe('generic-csv');
    expect(body.imported).toBe(2);
    expect(body.dateParseRate).toBe(1);
  });

  it('loads xlsx inside the Worker to parse a PBZ .xls through its adapter', async () => {
    // The assertion that matters: the injected `() => import('xlsx')` actually resolves in
    // workerd. If it did not, the adapter would throw and the request would fall back to the
    // generic path, which cannot read a binary OLE workbook at all.
    const res = await post(pbzXls(), 'Izvjesce o transakcijama_HR78.xls', { account: 'PBZ Racun' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.parsedBy).toBe('bank:pbz');
    expect(body.bank).toMatchObject({ id: 'pbz', label: 'PBZ' });
    expect(body.imported).toBe(2);
  });

  it('reads the .xls amounts and signs, and links them to the named account', async () => {
    await post(pbzXls(), 'Izvjesce o transakcijama_HR78.xls', { account: 'PBZ Racun' });
    const rows = await env.DB.prepare(
      `SELECT t.type, t.amount, a.name AS account
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.profile_id = ? ORDER BY t.date`
    )
      .bind(PROFILE_ID)
      .all<{ type: string; amount: number; account: string | null }>();

    expect(rows.results.map((r) => [r.type, r.amount])).toEqual([
      ['expense', 42.5],
      ['income', 2500],
    ]);
    expect(rows.results.every((r) => r.account === 'PBZ Racun')).toBe(true);
  });

  it('re-importing the same workbook adds nothing', async () => {
    await post(pbzXls(), 'Izvjesce o transakcijama_HR78.xls', { account: 'PBZ Racun' });
    const again = await post(pbzXls(), 'Izvjesce o transakcijama_HR78.xls', {
      account: 'PBZ Racun',
    });
    const body = (await again.json()) as Record<string, any>;
    expect(body.imported).toBe(0);
    expect(body.duplicates).toBe(2);
  });
});
