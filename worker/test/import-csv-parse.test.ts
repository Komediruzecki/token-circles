/**
 * The Worker's CSV entry points (published-sheet fetch, uploaded CSV, email-in attachment) all
 * go through parseCsv. It used to split the text into lines before tracking quotes, so a cell
 * containing a newline — which Google Sheets exports for any multi-line cell — was torn into
 * fragments: the real row disappeared and short, column-shifted junk rows took its place, with
 * no error to say so.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/routes/imports';

describe('Worker parseCsv', () => {
  it('keeps a quoted newline inside one record and does not shift the rows after it', () => {
    const { headers, rows } = parseCsv(
      'date,description,amount\n2026-01-01,"two\nlines",5\n2026-01-02,after,6\n'
    );
    expect(headers).toEqual(['date', 'description', 'amount']);
    expect(rows).toEqual([
      ['2026-01-01', 'two\nlines', '5'],
      ['2026-01-02', 'after', '6'],
    ]);
  });

  it('keeps commas inside a quoted cell in one column', () => {
    const { rows } = parseCsv('description,amount\n"CLOUDFLARE 10,46 USD, Dublin",9.45\n');
    expect(rows).toEqual([['CLOUDFLARE 10,46 USD, Dublin', '9.45']]);
  });

  it('unescapes a doubled quote', () => {
    const { rows } = parseCsv('description,amount\n"He said ""hi""",5\n');
    expect(rows).toEqual([['He said "hi"', '5']]);
  });

  it('handles CRLF and skips blank lines', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});
