/**
 * The types an import gives the values in a sheet's category and account columns, on both
 * runtimes: the Import page's Map columns, a saved sheet's Sync and the daily cron's sync
 * (worker/src/import-sync.ts). One rule, so a row comes in the same however its sheet is synced.
 */
import { classifyCategory } from './categoryClassifier';

export type ImportValueType = 'income' | 'expense' | 'account';

/** Rows as read from the sheet, and the column each field was matched to. */
type Rows = readonly (readonly (string | undefined)[])[];
type Mapping = Readonly<Record<string, number | undefined>>;

const cell = (row: readonly (string | undefined)[], index: number | undefined): string =>
  index === undefined ? '' : String(row[index] ?? '').trim();

/** Every distinct value of the category column, in the order the rows bring them. */
export function categoryValues(rows: Rows, mapping: Mapping): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const name = cell(row, mapping.category);
    if (name) values.add(name);
  }
  return [...values];
}

/**
 * Every distinct Means of Payment value, and the Category value of every row the sheet calls a
 * transfer. These name accounts, not categories: a transfer's source comes from Means of Payment,
 * and there is no reading of "transfer to Groceries" that makes Groceries a category.
 */
export function accountValues(rows: Rows, mapping: Mapping): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    const means = cell(row, mapping.means_of_payment);
    if (means) names.add(means);
    const destination = cell(row, mapping.category);
    if (destination && cell(row, mapping.type).toLowerCase() === 'transfer') {
      names.add(destination);
    }
  }
  return [...names];
}

/**
 * The types a fresh import gives the rows' values: the keyword guess for every category, then
 * the account-by-construction values as accounts, last so they win over any guess (a Means of
 * Payment value is the account the money moved from, whatever it is called).
 */
export function freshImportTypes(rows: Rows, mapping: Mapping): Record<string, ImportValueType> {
  const types: Record<string, ImportValueType> = {};
  for (const name of categoryValues(rows, mapping)) types[name] = classifyCategory(name);
  for (const name of accountValues(rows, mapping)) types[name] = 'account';
  return types;
}

/**
 * The types a saved sheet's sync gives its rows' values. The saved types win for the values they
 * name; every other value is typed exactly as a fresh import types it, so a category the sheet
 * gained after it was saved does not fall to its amount's sign (an unsigned 12.00 in a new
 * Pharmacy is an expense, as Map columns would have it). Null when there is nothing to type: no
 * saved types and no category column, where each row keeps its Type column or its amount's sign.
 * The daily cron takes it for every sheet saved with types (worker/src/import-sync.ts).
 */
export function syncTypes(
  rows: Rows,
  mapping: Mapping,
  saved: Readonly<Record<string, ImportValueType>> | null | undefined
): Record<string, ImportValueType> | null {
  if (saved && Object.keys(saved).length > 0) {
    return { ...freshImportTypes(rows, mapping), ...saved };
  }
  return mapping.category !== undefined ? freshImportTypes(rows, mapping) : null;
}
