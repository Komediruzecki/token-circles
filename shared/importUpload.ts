/**
 * A file uploaded on the Import page, read the same way by the Worker and by local-first.
 *
 * `POST /api/import/upload` answers the file's header row, the rows under it as lists of cells,
 * and the workbook's sheets, so the page can go on to the mapping step and switch sheets by
 * uploading again with a `sheetName`. The Worker has answered that since it replaced the Express
 * server; local-first kept the older answer (an upload session, and each row as an object keyed by
 * its column), so the page, which reads `sheetNames`, stopped at the upload step in local-first
 * with "Cannot read properties of undefined (reading '0')" (docs/plans/2026-10-07-form-errors.md,
 * slice 4b). Now both read the file here.
 *
 * SheetJS is passed in rather than imported: the Worker bundles it, local-first loads it only when
 * a file is uploaded.
 */
import { parseImportCsv } from './importCsv';
import type { Checked, FieldErrors } from './refusal';

/** The largest file either runtime reads in memory. */
export const IMPORT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** The words for each refusal, at the form's `file` field. */
export const IMPORT_UPLOAD_MESSAGES = {
  file: 'Choose a CSV or Excel file to upload.',
  tooLarge: 'That file is over 10 MB. Split it into smaller files and upload each one.',
  noSheets: 'That spreadsheet has no sheets. Choose another file.',
  unreadable: "That file couldn't be read. Upload a CSV or Excel file.",
  tooSlow:
    'That file took too long to read. Upload it as a CSV file, or split it into smaller files.',
} as const;

/**
 * What an upload answers. A CSV file is one sheet, called "CSV". Every cell is text, as a pasted
 * CSV's and a Google Sheet's are: the mapping step and the import read text.
 */
export interface UploadedSheet {
  headers: string[];
  rows: string[][];
  selectedSheet: string;
  sheetNames: string[];
}

/** The part of SheetJS this reads with. */
export interface SheetReader {
  read(
    data: Uint8Array,
    options: { type: 'array'; cellDates: true }
  ): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json<T>(sheet: never, options: { header: 1; blankrows: false; defval: string }): T[];
  };
}

/** The file as either runtime holds it once the form is read. */
export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

/**
 * Why the file is not read at all, at `file`, with the status to answer: 400 for no file, 413 for
 * one over the size cap, which is checked before anything is parsed. Null when it can be read.
 */
export function uploadRefusal(
  file: { size: number } | null
): { status: 400 | 413; fields: FieldErrors } | null {
  if (!file) return { status: 400, fields: { file: IMPORT_UPLOAD_MESSAGES.file } };
  if (file.size > IMPORT_UPLOAD_MAX_BYTES) {
    return { status: 413, fields: { file: IMPORT_UPLOAD_MESSAGES.tooLarge } };
  }
  return null;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * A workbook cell as text. A number is written out plainly ("-900.5"), not in the cell's display
 * format, which could add a currency sign or thousands separators. A date cell is its calendar
 * day, yyyy-mm-dd: read with `cellDates`, SheetJS puts it at midnight of that day in the local
 * time zone, so the local parts are the day wherever this runs. Read as a number instead, a date
 * was its serial (46082), which neither runtime's import reads as a date.
 */
export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return '';
    return `${cell.getFullYear()}-${pad2(cell.getMonth() + 1)}-${pad2(cell.getDate())}`;
  }
  return String(cell);
}

/**
 * Whether `bytes` are a complete zip, which a workbook saved as .xlsx is: a zip is read from the
 * end-of-central-directory record at its end (22 bytes, then a comment of up to 65535), and one
 * without it is not a whole file. Anything that does not start as a zip passes.
 */
export function isCompleteUpload(bytes: Uint8Array): boolean {
  const startsAsZip =
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2]! < 9 && bytes[3]! < 9;
  if (!startsAsZip) return true;
  const last = bytes.length - 22;
  for (let at = last; at >= 0 && at >= last - 0xffff; at--) {
    if (
      bytes[at] === 0x50 &&
      bytes[at + 1] === 0x4b &&
      bytes[at + 2] === 5 &&
      bytes[at + 3] === 6
    ) {
      return true;
    }
  }
  return false;
}

/** Whether the file is read as CSV text rather than as a workbook. */
export function isCsvUpload(file: { name: string; type: string }): boolean {
  return /\.csv$/i.test(file.name) || file.type === 'text/csv';
}

/**
 * The sheet `requested` names, or the first, as its header row and the rows under it. A blank row
 * is left out. Refused at `file` when the file is not a complete one, a workbook has no sheets, or
 * it is not a workbook at all.
 */
export function readUploadedSheet(
  xlsx: SheetReader,
  file: UploadedFile,
  requested?: string
): Checked<UploadedSheet> {
  if (isCsvUpload(file)) {
    const { headers, rows } = parseImportCsv(new TextDecoder().decode(file.bytes));
    return { ok: true, value: { headers, rows, selectedSheet: 'CSV', sheetNames: ['CSV'] } };
  }
  if (!isCompleteUpload(file.bytes)) {
    return { ok: false, fields: { file: IMPORT_UPLOAD_MESSAGES.unreadable } };
  }
  let workbook: ReturnType<SheetReader['read']>;
  try {
    workbook = xlsx.read(file.bytes, { type: 'array', cellDates: true });
  } catch {
    return { ok: false, fields: { file: IMPORT_UPLOAD_MESSAGES.unreadable } };
  }
  const sheetNames = workbook.SheetNames;
  const selected = requested && sheetNames.includes(requested) ? requested : sheetNames[0];
  if (!selected) return { ok: false, fields: { file: IMPORT_UPLOAD_MESSAGES.noSheets } };
  const matrix = xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[selected] as never, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  const headers = (matrix[0] ?? []).map(cellText);
  const rows = matrix
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => cell !== '' && cell != null))
    .map((row) => row.map(cellText));
  return { ok: true, value: { headers, rows, selectedSheet: selected, sheetNames } };
}
