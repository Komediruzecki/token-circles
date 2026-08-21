/**
 * Per-row validation for imports — the numeric fields and the date.
 *
 * Shared because the two runtimes disagreeing here is not hypothetical: the IndexedDB path used to
 * reject rows with no description while the Worker accepted them, so the same sheet imported clean
 * in the cloud and silently lost 291 rows locally. One implementation, both runtimes.
 *
 * A row is REJECTED only when a value cannot be read at all. Anything that can be read but might
 * not be what the user meant — a rounded amount, a date we had to invent — imports and raises a
 * warning, so the row lands in the ledger and the user is told what to look at.
 */
import { describeImportNumberFlags, parseImportNumberDetailed } from './importNumber';

/** A non-fatal note about a row that was imported. */
export interface ImportRowWarning {
  index: number;
  reason: string;
  label?: string;
}

export interface ImportRowNumbers {
  amount: number | null;
  amountLocal: number | null;
  exchangeRate: number | null;
  /** Field names that could not be read at all — a non-empty list means reject the row. */
  invalidFields: string[];
  /** Sentences to show the user for a row that still imports. */
  warnings: string[];
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || String(value).trim() === '';

/**
 * Read a row's three financial fields.
 *
 * `amount_local` falls back to `amount` and `exchange_rate` to 1 when blank — a sheet that keeps
 * one currency leaves both empty on nearly every row.
 */
export function checkImportRowNumbers(raw: {
  amount: unknown;
  amountLocal: unknown;
  exchangeRate: unknown;
}): ImportRowNumbers {
  const invalidFields: string[] = [];
  const warnings: string[] = [];

  const collect = (field: string, source: unknown) => {
    const result = parseImportNumberDetailed(source);
    const note = describeImportNumberFlags(field, String(source), result.flags);
    if (note) warnings.push(note);
    return result.value;
  };

  const amount = collect('amount', raw.amount);
  const amountLocal = isBlank(raw.amountLocal) ? amount : collect('amount_local', raw.amountLocal);
  const exchangeRate = isBlank(raw.exchangeRate) ? 1 : collect('exchange_rate', raw.exchangeRate);

  if (amount === null) invalidFields.push('amount');
  if (amountLocal === null) invalidFields.push('amount_local');
  if (exchangeRate === null || exchangeRate <= 0) invalidFields.push('exchange_rate');

  return { amount, amountLocal, exchangeRate, invalidFields, warnings };
}

/** The message shown for a row whose date the sheet did not supply. */
export const MISSING_DATE_WARNING =
  "No date in this row — imported with today's date. Open the transaction to set the real one.";

/** The reason string for a row whose numbers could not be read. */
export function unreadableNumbersReason(invalidFields: string[]): string {
  return `Could not read ${invalidFields.join(', ')} — check the number format`;
}
