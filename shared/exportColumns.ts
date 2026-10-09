/**
 * One kind of row exported on its own (GET /api/export/:type, Settings > Export Household Data):
 * the kinds there are, the columns each one carries, and the file they make, the same from the
 * Worker and from local-first.
 *
 * The two runtimes used to write different files for the same export
 * (docs/plans/2026-10-07-form-errors.md, slice 4b): the Worker chose columns (a transaction's
 * category by name; JSON as a list of rows) and local-first wrote others (the category by id;
 * JSON as every field of each row inside `{ <kind>: [...] }`); local-first quoted every
 * description and guarded no cell against a spreadsheet reading it as a formula; it answered any
 * kind its backup has, and the whole backup for a kind it did not know; and the Worker wrote an
 * empty file, without a header, for a kind with no rows. Now both write the Worker's columns,
 * by these rules:
 *
 * - The kinds are transactions, categories, budgets, accounts, loans and recurring. Any other is
 *   refused with 400.
 * - CSV unless the format is json. A CSV file starts with its header, even with no rows under it.
 * - A cell that starts like a formula (=, +, -, @, a tab or a return) is written after a single
 *   quote, unless it is a plain number; a cell with a comma, a quote or a line break is quoted.
 * - JSON is the list of rows, each with the kind's columns in order; `pretty=true` indents it.
 * - A value a row does not have is null (an empty CSV cell), and a yes or no is 1 or 0, as D1
 *   stores them.
 */

export const EXPORT_KINDS = [
  'transactions',
  'categories',
  'budgets',
  'accounts',
  'loans',
  'recurring',
] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];

/** Each kind's columns, in the order the file has them. */
export const EXPORT_COLUMNS: Record<ExportKind, readonly string[]> = {
  transactions: [
    'date',
    'description',
    'amount',
    'type',
    'currency',
    'means_of_payment',
    'beneficiary',
    'payor',
    'notes',
    'category',
  ],
  categories: ['name', 'color', 'icon', 'type', 'parent_id'],
  budgets: [
    'id',
    'category_id',
    'amount',
    'period',
    'start_date',
    'end_date',
    'rollover_enabled',
    'rollover_amount',
    'rollover_used',
    'created_at',
    'profile_id',
    'category_name',
  ],
  accounts: ['name', 'type', 'currency', 'balance', 'notes'],
  loans: ['name', 'principal', 'interest_rate', 'start_date', 'term_months', 'total_prepaid'],
  recurring: [
    'description',
    'amount',
    'type',
    'frequency',
    'day_of_month',
    'next_date',
    'notes',
    'active',
  ],
};

const FILENAMES: Record<ExportKind, string> = {
  transactions: 'transactions',
  categories: 'categories',
  budgets: 'budgets',
  accounts: 'accounts',
  loans: 'loans',
  recurring: 'recurring_transactions',
};

/** The words for a kind there is no export of. */
export const EXPORT_MESSAGES = {
  kind: 'Choose what to export: transactions, categories, budgets, accounts, loans or recurring.',
} as const;

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === 'string' && (EXPORT_KINDS as readonly string[]).includes(value);
}

function cellValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** The rows as the file carries them: the kind's columns, in order, and nothing else. */
export function exportRecords(
  kind: ExportKind,
  rows: readonly Record<string, unknown>[]
): Record<string, unknown>[] {
  const columns = EXPORT_COLUMNS[kind];
  return rows.map((row) => Object.fromEntries(columns.map((c) => [c, cellValue(row[c])])));
}

/**
 * One CSV cell. Plain numbers (negatives included) are data, not formulas: quoting them turned
 * every negative balance into text like "'-2392.21".
 */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  const isPlainNumber = typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(text);
  if (!isPlainNumber && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The kind's rows as CSV: the header, then a line per row. */
export function exportCsv(kind: ExportKind, rows: readonly Record<string, unknown>[]): string {
  const columns = EXPORT_COLUMNS[kind];
  const lines = exportRecords(kind, rows).map((record) =>
    columns.map((c) => csvCell(record[c])).join(',')
  );
  return [columns.join(','), ...lines].join('\n');
}

/** The file an export answers: its text, its type and the name it suggests. */
export interface ExportFile {
  body: string;
  contentType: string;
  disposition: string;
}

/** The file for these rows of a kind, in the format asked for (CSV unless it is json). */
export function exportFile(
  kind: ExportKind,
  format: string | null | undefined,
  rows: readonly Record<string, unknown>[],
  pretty = false
): ExportFile {
  if (format === 'json') {
    return {
      body: JSON.stringify(exportRecords(kind, rows), null, pretty ? 2 : undefined),
      contentType: 'application/json; charset=utf-8',
      disposition: `attachment; filename="${FILENAMES[kind]}.json"`,
    };
  }
  return {
    body: exportCsv(kind, rows),
    contentType: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${FILENAMES[kind]}.csv"`,
  };
}
