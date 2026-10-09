import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseAttachment } from '../src/import-email';

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
