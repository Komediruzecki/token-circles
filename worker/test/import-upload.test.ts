/**
 * POST /api/import/upload reads a file as local-first does (shared/importUpload.ts), and refuses
 * it in the same words, at the `file` field the Import page sends it in.
 *
 * Before, the Worker said "No file uploaded" and "File too large (max 10MB)" where local-first said
 * "File too large (max 10 MB)", neither named the field, and a file that is not a workbook at all
 * (a broken .xlsx) was a 500. A workbook's cells came back as they were stored, so an amount was
 * a number and a date its serial number (46082), where the page and the import read text: the
 * preview stopped at the first number. Now every cell is text and a date cell is its day. The
 * twin is frontend/src/core/storage/__tests__/importUpload.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_UPLOAD_MESSAGES as M } from '../../shared/importUpload';
import { sessionCookie } from './helpers/session';

let cookie = '';

beforeEach(async () => {
  for (const table of ['rate_limits', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (98, 'upload@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (980, 98, 'Main')"),
  ]);
  cookie = (await sessionCookie(98, 'password', env)).split(';')[0];
});

async function upload(
  file: File | null,
  sheetName?: string
): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  if (file) form.append('file', file);
  if (sheetName) form.append('sheetName', sheetName);
  const res = await SELF.fetch('https://example.com/api/import/upload', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

function workbook(): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new();
  const march = XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount'],
    ['2026-03-01', 'Rent', -900.5],
  ]);
  // A date as Excel keeps one: the day's serial number, shown in a date format.
  march.A2 = { t: 'n', v: 46082, z: 'yyyy-mm-dd' };
  XLSX.utils.book_append_sheet(book, march, 'March');
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Datum', 'Omschrijving', 'Bedrag'],
      ['2026-04-01', 'Huur', -900],
    ]),
    'April'
  );
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('POST /api/import/upload', () => {
  it('refuses no file, and a file over 10 MB, at the file', async () => {
    expect(await upload(null)).toEqual({
      status: 400,
      body: { error: M.file, fields: { file: M.file } },
    });
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.csv', { type: 'text/csv' });
    expect(await upload(big)).toEqual({
      status: 413,
      body: { error: M.tooLarge, fields: { file: M.tooLarge } },
    });
  });

  it('refuses a workbook it cannot open at the file, rather than failing', async () => {
    // The first bytes of a zip, as an .xlsx file starts, and then nothing a zip has.
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0]);
    expect(await upload(new File([broken], 'statement.xlsx'))).toEqual({
      status: 400,
      body: { error: M.unreadable, fields: { file: M.unreadable } },
    });
  });

  it("answers a workbook's cells as text, a date cell as its day", async () => {
    // As numbers, the preview's duplicate check called trim() on them and stopped, and the
    // import read a date's serial number as no date at all.
    expect(await upload(new File([workbook()], 'statement.xlsx'))).toEqual({
      status: 200,
      body: {
        headers: ['Date', 'Description', 'Amount'],
        rows: [['2026-03-01', 'Rent', '-900.5']],
        selectedSheet: 'March',
        sheetNames: ['March', 'April'],
      },
    });
  });

  it('answers the sheet an upload names, with every sheet listed', async () => {
    expect(await upload(new File([workbook()], 'statement.xlsx'), 'April')).toEqual({
      status: 200,
      body: {
        headers: ['Datum', 'Omschrijving', 'Bedrag'],
        rows: [['2026-04-01', 'Huur', '-900']],
        selectedSheet: 'April',
        sheetNames: ['March', 'April'],
      },
    });
  });

  it('refuses a workbook cut short at the file', async () => {
    const whole = workbook();
    expect(await upload(new File([whole.slice(0, whole.length - 30)], 'statement.xlsx'))).toEqual({
      status: 400,
      body: { error: M.unreadable, fields: { file: M.unreadable } },
    });
  });
});
