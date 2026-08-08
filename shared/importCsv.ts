/**
 * CSV parsing for imports.
 *
 * Both runtimes had their own hand-rolled copy (worker/src/routes/imports.ts and the IndexedDB
 * handler), and both carried the same defect: they split the text into lines FIRST and only then
 * tracked quotes. A quoted cell is allowed to contain a newline — Google Sheets exports any
 * multi-line cell that way — so such a record was torn into fragments, each parsed as its own
 * short row. The result was silent corruption: a row that never appeared, plus one or two junk
 * rows with the columns shifted.
 *
 * This is a single scanner over the whole text that tracks quote state across newlines, so a
 * record ends only at a newline that is genuinely outside quotes. It also handles the RFC 4180
 * escape for a literal quote (`""` inside a quoted field), which the old copies dropped.
 *
 * Lives in shared/ so the Worker and the frontend cannot drift apart again.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Parse RFC 4180-ish CSV: comma-delimited, `"`-quoted fields, `""` for a literal quote inside a
 * quoted field, and CR/LF or LF record separators. Unquoted cells are trimmed (sheet exports pad
 * them); quoted cells are preserved verbatim, since the quotes are how a sheet says "this
 * whitespace is mine".
 */
export function parseImportCsv(input: string): ParsedCsv {
  // Strip a leading byte-order mark. Spreadsheet exports (Excel especially) routinely prefix one,
  // and it would otherwise ride along inside the first header — silently breaking a saved
  // header→column mapping, which matches header names exactly. The line-splitting parsers this
  // replaced got this for free from `text.trim()`, since U+FEFF counts as whitespace to trim().
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false; // this cell is a quoted field
  let inQuotes = false; // currently inside the quotes

  const endCell = () => {
    row.push(quoted ? cell : cell.trim());
    cell = '';
    quoted = false;
  };
  const endRow = () => {
    endCell();
    records.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !quoted && cell.trim() === '') {
      // A quote opens a quoted field only at the start of a cell — anywhere else it is content,
      // so `12" pipe` keeps its inch mark. Padding ahead of the quote is tolerated and dropped
      // (`a, "b"` → `b`): strict RFC 4180 says such a field is unquoted, but producers emit it
      // and the parsers this replaced accepted it by stripping the outer quotes after trimming.
      inQuotes = true;
      quoted = true;
      cell = '';
      continue;
    }
    if (ch === ',') {
      endCell();
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    if (ch === '\n') {
      endRow();
      continue;
    }
    cell += ch;
  }
  // Trailing cell/record — unless the text ended exactly on a record separator.
  if (cell !== '' || row.length > 0 || quoted) endRow();

  // Drop wholly empty records (trailing blank lines, and the blank rows sheets like to export).
  const all = records.filter((r) => r.some((c) => c !== ''));
  const headers = all[0] || [];
  return { headers, rows: all.slice(1) };
}
