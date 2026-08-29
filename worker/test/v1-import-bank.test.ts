/**
 * The ingest endpoint routes through the bank adapters before it falls back to generic CSV.
 *
 * This is the property that makes the API accept the same files the Bank Imports tab accepts.
 * The generic path guesses a mapping from row 1's headers, so it can only read a file that is
 * already app-shaped. A real ERSTE export is none of those things: Windows-1250, semicolon-
 * delimited, a bank preamble above the header row, and debit/credit split across two columns
 * (`Isplate`/`Uplate`) rather than one signed amount. Before this routing it was rejected 422.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { signCapability } from '../src/signed-url';

const USER_ID = 9300;
const PROFILE_ID = 9301;
const SECRET = 'test-jwt-secret-not-for-prod';

/**
 * Encode Windows-1250. The point of the fixture is that the file is NOT UTF-8 -- decoding it as
 * UTF-8 mangles the Croatian text, and only the adapter knows to ask for cp1250. Only the
 * characters this fixture actually uses are mapped.
 */
const CP1250: Record<string, number> = { č: 0xe8, ć: 0xe6, ž: 0x9e, š: 0x9a, đ: 0xf0, Ž: 0x8e };
function encodeCp1250(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = CP1250[ch] ?? ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`Unmapped character in fixture: ${ch}`);
    out[i] = code;
  }
  return out;
}

// Two transactions: one debit (Isplate) and one credit (Uplate), European decimals, CRLF.
const ERSTE_CSV = [
  'Izvod prometa po računu HR1210001234567890 Valuta EUR Razdoblje 01.07.2026 - 31.07.2026',
  'Redni broj;Datum valute;Datum izvršenja;Opis plaćanja;Broj računa;Isplate;Uplate;Stanje;PNB platitelja;PNB primatelja;Platitelj/Primatelj;Mjesto;Referenca',
  '1;02.07.2026;02.07.2026;Kupnja - KONZUM;HR1210001234567890;8.330,91;;12.345,67;;;KONZUM PLUS D.O.O.;ZAGREB;REF-88213',
  '2;05.07.2026;05.07.2026;Plaća;HR1210001234567890;;2.500,00;14.845,67;;;POSLODAVAC D.O.O.;ZAGREB;REF-88214',
].join('\r\n');

// App-shaped: header on line 1, one signed amount column, comma-delimited, UTF-8.
const PLAIN_CSV = ['Date,Description,Amount', '2026-07-02,Coffee,-3.50'].join('\n');

async function seed(): Promise<void> {
  await env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare('DELETE FROM import_logs WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'v1bank@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'Bank Profile', ?)"
  )
    .bind(PROFILE_ID, USER_ID)
    .run();
  await env.DB.prepare(
    "INSERT INTO accounts (name, type, currency, balance, profile_id) VALUES ('Erste Current', 'giro', 'EUR', 0, ?)"
  )
    .bind(PROFILE_ID)
    .run();
}

async function post(opts: {
  body: Uint8Array | string;
  filename: string;
  mode?: 'preview' | 'commit';
  query?: Record<string, string>;
}): Promise<Response> {
  const sig = await signCapability(
    { tokenId: 'tok-bank', userId: USER_ID, profileId: PROFILE_ID, purpose: 'import' },
    SECRET
  );
  const form = new FormData();
  form.append('file', new File([opts.body], opts.filename, { type: 'text/csv' }));
  const qs = new URLSearchParams({ sig, mode: opts.mode ?? 'commit', ...(opts.query ?? {}) });
  return SELF.fetch(`https://api.example.com/api/v1/import?${qs}`, { method: 'POST', body: form });
}

const erste = () => encodeCp1250(ERSTE_CSV);

describe('POST /api/v1/import - bank adapters first', () => {
  beforeEach(seed);

  it('imports an ERSTE statement through its adapter, not the generic CSV path', async () => {
    const res = await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Current' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.parsedBy).toBe('bank:erste');
    expect(body.bank).toMatchObject({ id: 'erste', label: 'Erste' });
    expect(body.bank.confidence).toBeGreaterThanOrEqual(0.9);
    expect(body.imported).toBe(2);
    // The adapter emits the app's canonical headers, so the mapping is exact rather than guessed.
    expect(body.headers).toContain('Means of Payment');
  });

  it('reads the split debit/credit columns and European decimals correctly', async () => {
    await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Current' },
    });
    const rows = await env.DB.prepare(
      'SELECT type, amount, description FROM transactions WHERE profile_id = ? ORDER BY date'
    )
      .bind(PROFILE_ID)
      .all<{ type: string; amount: number; description: string }>();

    // Isplate 8.330,91 is money out; Uplate 2.500,00 is money in. Read as US decimals both
    // would have been ~8.33 and ~2.50 -- the failure this asserts against.
    expect(rows.results.map((r) => [r.type, r.amount])).toEqual([
      ['expense', 8330.91],
      ['income', 2500],
    ]);
  });

  it('links the rows to the account named by ?account=', async () => {
    await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Current' },
    });
    const linked = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transactions t
         JOIN accounts a ON a.id = t.account_id
        WHERE t.profile_id = ? AND a.name = 'Erste Current'`
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(linked?.n).toBe(2);
  });

  it('creates and links the target account when the profile has none yet', async () => {
    // The bug this covers: executeImport only creates accounts the caller marks as accounts, and
    // the endpoint marked none. Every row imported with account_id NULL -- a clean-looking
    // import of transactions belonging to no account, which no balance or report would show.
    await env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE_ID).run();

    const res = await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Novi' },
    });
    const body = (await res.json()) as Record<string, any>;
    expect(body.accountsCreated).toBe(1);

    const unlinked = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ? AND account_id IS NULL'
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(unlinked?.n).toBe(0);

    const linked = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transactions t
         JOIN accounts a ON a.id = t.account_id
        WHERE t.profile_id = ? AND a.name = 'Erste Novi'`
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(linked?.n).toBe(2);
  });

  it('records which parser ran in the import log', async () => {
    await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Current' },
    });
    const log = await env.DB.prepare(
      'SELECT details FROM import_logs WHERE profile_id = ? ORDER BY id DESC LIMIT 1'
    )
      .bind(PROFILE_ID)
      .first<{ details: string }>();
    expect(JSON.parse(log!.details)).toMatchObject({ parsedBy: 'bank:erste', bank: 'erste' });
  });

  it('still falls back to generic CSV for an app-shaped file no adapter claims', async () => {
    const res = await post({ body: PLAIN_CSV, filename: 'plain.csv' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.parsedBy).toBe('generic-csv');
    expect(body.bank).toBeNull();
    expect(body.imported).toBe(1);
  });

  it('honours ?bank= as an override and rejects an unknown id', async () => {
    const forced = await post({
      body: erste(),
      filename: 'unhelpful-name.csv',
      query: { bank: 'erste', account: 'Erste Current' },
    });
    expect(forced.status).toBe(200);
    const body = (await forced.json()) as Record<string, any>;
    expect(body.parsedBy).toBe('bank:erste');
    expect(body.bank.confidence).toBe(1);

    const unknown = await post({ body: erste(), filename: 'x.csv', query: { bank: 'nosuchbank' } });
    expect(unknown.status).toBe(400);
  });

  it('warns instead of guessing when no target account was given', async () => {
    const res = await post({ body: erste(), filename: 'ERSTE_Izvadak.csv' });
    const body = (await res.json()) as Record<string, any>;
    expect(body.targetAccount).toBe('Erste');
    expect(body.warnings.join(' ')).toMatch(/no target account chosen/i);
  });

  it('re-importing the same statement adds nothing and reports duplicates', async () => {
    await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Current' },
    });
    const again = await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      query: { account: 'Erste Current' },
    });
    const body = (await again.json()) as Record<string, any>;
    expect(body.imported).toBe(0);
    expect(body.duplicates).toBe(2);

    const total = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ?'
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(total?.n).toBe(2);
  });

  it('a preview writes nothing', async () => {
    const res = await post({
      body: erste(),
      filename: 'ERSTE_Izvadak.csv',
      mode: 'preview',
      query: { account: 'Erste Current' },
    });
    expect(res.status).toBe(200);
    const total = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ?'
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(total?.n).toBe(0);
  });
});
