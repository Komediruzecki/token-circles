import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { handleIngestEmail, parseAttachment } from '../src/import-email';

// Email-in (Ask 3) turns a forwarded bank-statement attachment into { headers, rows } that feed
// the shared executeImport. parseAttachment is that step; the auth/dedup/insert around it are
// covered by the secret-tag check and the existing /api/import/execute suite.

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A one-sheet workbook of these rows, after an empty sheet when `emptyFirst`. */
function workbook(rows: unknown[][], emptyFirst = false): Uint8Array {
  const wb = XLSX.utils.book_new();
  if (emptyFirst) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Notes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Statement');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

describe('parseAttachment', () => {
  it('parses a CSV attachment into headers + rows', () => {
    const csv = 'Date,Description,Amount\n2026-07-01,Coffee,-4.50\n2026-07-02,Salary,1000\n';
    const table = parseAttachment('statement.csv', 'text/csv', new TextEncoder().encode(csv));
    expect(table).not.toBeNull();
    expect(table!.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(table!.rows).toHaveLength(2);
    expect(table!.rows[0]).toEqual(['2026-07-01', 'Coffee', '-4.50']);
  });

  it('parses an XLSX attachment into headers + rows', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      ['2026-07-01', 'Coffee', -4.5],
      ['2026-07-02', 'Salary', 1000],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const table = parseAttachment(
      'statement.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes
    );
    expect(table).not.toBeNull();
    expect(table!.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(table!.rows).toHaveLength(2);
    expect(table!.rows[0][0]).toBe('2026-07-01');
    expect(table!.rows[1][1]).toBe('Salary');
  });

  it('reads a date cell as its day, as an uploaded file is read', () => {
    const table = parseAttachment(
      'statement.xlsx',
      XLSX_TYPE,
      workbook([
        ['Date', 'Description', 'Amount'],
        [new Date(Date.UTC(2026, 6, 1)), 'Coffee', -4.5],
      ])
    );
    expect(table?.rows).toEqual([['2026-07-01', 'Coffee', '-4.5']]);
  });

  it('reads the first sheet that has a header row', () => {
    const table = parseAttachment(
      'statement.xlsx',
      XLSX_TYPE,
      workbook(
        [
          ['Date', 'Description', 'Amount'],
          ['2026-07-02', 'Salary', 1000],
        ],
        true
      )
    );
    expect(table).toEqual({
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-07-02', 'Salary', '1000']],
    });
  });

  it('returns null for a workbook that is not a complete file', () => {
    const whole = workbook([
      ['Date', 'Description', 'Amount'],
      ['2026-07-01', 'Coffee', -4.5],
    ]);
    expect(
      parseAttachment('statement.xlsx', XLSX_TYPE, whole.slice(0, whole.length - 30))
    ).toBeNull();
  });

  it('returns null for a non-tabular attachment (e.g. a PDF)', () => {
    expect(
      parseAttachment('statement.pdf', 'application/pdf', new Uint8Array([1, 2, 3]))
    ).toBeNull();
  });
});

// The whole email-in path: a raw message goes through PostalMime.parse, its CSV attachment comes
// back as bytes (ArrayBuffer by default, whatever the transfer encoding), and those rows reach the
// importer. A postal-mime upgrade that changes the attachment's content type or its bytes lands
// here as "No importable CSV/XLSX attachment found" and no transactions.

const INGEST_USER = 9310;
const INGEST_PROFILE = 93100;
const SECRET = 'ingest-test-secret';

const CSV_LINES = [
  'Date,Description,Amount',
  '2026-07-01,Corner bakery,-4.50',
  '2026-07-02,Example payroll,1000.00',
];

/** A multipart message with a short text part and statement.csv sent in this transfer encoding. */
function rawMessage(encoding: 'base64' | '7bit'): string {
  const csv = CSV_LINES.join('\r\n') + '\r\n';
  const body = encoding === 'base64' ? btoa(csv).replace(/.{76}/g, '$&\r\n') : csv;
  return [
    'From: Statements <statements@bank.example>',
    `To: ingest+${SECRET}@ledger.example`,
    'Subject: Your July statement',
    'Date: Fri, 03 Jul 2026 09:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="tc-boundary"',
    '',
    '--tc-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Your statement is attached.',
    '--tc-boundary',
    'Content-Type: text/csv; name="statement.csv"',
    'Content-Disposition: attachment; filename="statement.csv"',
    `Content-Transfer-Encoding: ${encoding}`,
    '',
    body,
    '--tc-boundary--',
    '',
  ].join('\r\n');
}

/** The parts of a ForwardableEmailMessage that handleIngestEmail reads, with the raw bytes. */
function forwarded(raw: string) {
  const rejected: string[] = [];
  const bytes = new TextEncoder().encode(raw);
  const message = {
    from: 'statements@bank.example',
    to: `ingest+${SECRET}@ledger.example`,
    raw: new Blob([bytes]).stream(),
    rawSize: bytes.length,
    headers: new Headers(),
    setReject: (reason: string) => void rejected.push(reason),
  } as unknown as ForwardableEmailMessage;
  return { message, rejected };
}

describe('handleIngestEmail', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?')
      .bind(INGEST_PROFILE)
      .run();
    await env.DB.prepare('DELETE FROM import_logs WHERE profile_id = ?').bind(INGEST_PROFILE).run();
    await env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(INGEST_PROFILE).run();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(INGEST_USER).run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'email-in@example.com', 'password', 1)"
      ).bind(INGEST_USER),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
        INGEST_PROFILE,
        INGEST_USER
      ),
    ]);
  });

  it.each(['base64', '7bit'] as const)(
    'imports the rows of a %s CSV attachment',
    async (encoding) => {
      const { message, rejected } = forwarded(rawMessage(encoding));
      await handleIngestEmail(message, {
        ...env,
        EMAIL_INGEST_SECRET: SECRET,
        EMAIL_INGEST_PROFILE_ID: String(INGEST_PROFILE),
      });
      expect(rejected).toEqual([]);
      const { results } = await env.DB.prepare(
        'SELECT date, description, amount, type FROM transactions WHERE profile_id = ? ORDER BY date'
      )
        .bind(INGEST_PROFILE)
        .all();
      expect(results).toEqual([
        { date: '2026-07-01', description: 'Corner bakery', amount: 4.5, type: 'expense' },
        { date: '2026-07-02', description: 'Example payroll', amount: 1000, type: 'income' },
      ]);
      const log = await env.DB.prepare(
        'SELECT source, imported FROM import_logs WHERE profile_id = ?'
      )
        .bind(INGEST_PROFILE)
        .first();
      expect(log).toEqual({ source: 'Email import (statement.csv)', imported: 2 });
    }
  );
});
