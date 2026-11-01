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

/** A non-fatal note about the import as a whole, not about one row: it has no `index`. */
export interface ImportNote {
  reason: string;
}

/**
 * What an import does with a starting balance it was given for an account that ALREADY exists
 * (a YNAB register's "Starting Balance", offered in the mapping step). An account nobody has
 * used yet (starting balance 0, no transactions) takes it; one in use keeps its own, and the
 * import says so. The same amount as the account already has is nothing to apply or report.
 */
export function existingAccountStartingBalance(
  account: { startingBalance: number | null; hasTransactions: boolean },
  offered: number
): 'apply' | 'keep' | 'same' {
  const current = account.startingBalance ?? 0;
  if (Math.abs(current - offered) < 0.005) return 'same';
  return current === 0 && !account.hasTransactions ? 'apply' : 'keep';
}

export function startingBalanceKeptNote(name: string, amount: number): string {
  return `${name} already has a starting balance or transactions, so the starting balance of ${amount.toFixed(2)} in this import was not applied to it.`;
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * One note per value the mapping step set to Account but that rows with a Means of Payment use as
 * their category. Those rows book from their Means of Payment, so the value only names their
 * category, and the note says how to get what was probably meant. It does not say who set the
 * value: classifyCategory sets some ("ib" in Library) before anyone looks.
 *
 * Its advice for moving the money into the account is to make the rows transfers, and that only
 * for expenses: a transfer takes the money out of the paying account, which an income never came
 * from. After an import the rows are already stored, and a re-import with another Type is not a
 * duplicate of them, so the advice is to delete the import first ("Delete import" under Recent
 * Imports, in both modes).
 */
export function markedAccountUsedAsCategoryNote(found: {
  /** The value as the sheet spells it. */
  name: string;
  rows: number;
  /** The accounts the rows were booked to, by their Means of Payment, as the accounts are named. */
  paidFrom: string[];
  /** Means of Payment values on the rows that name no account, as the sheet spells them. */
  notAccounts: string[];
  /**
   * Whether the rows got the value as their category (a gated import may leave it unmade). A
   * preview passes true: it offers the category for the import to make.
   */
  categorised: boolean;
  /** The rows' types. */
  types: string[];
  /** A dry run: nothing is stored yet, so the rows can still be changed before importing. */
  preview: boolean;
}): string {
  const { name, rows, paidFrom, notAccounts, categorised, preview } = found;
  const one = rows === 1;
  const kinds = new Set(found.types);
  const onlyExpenses = kinds.size === 1 && kinds.has('expense');
  const onlyIncomes = kinds.size === 1 && kinds.has('income');
  const from = listNames(paidFrom);
  // A preview says what the import will do; after it, what it did.
  const was = preview ? 'will be' : one ? 'was' : 'were';
  const moved = onlyExpenses
    ? `${preview ? 'will come' : 'came'} off ${from}`
    : onlyIncomes
      ? `${preview ? 'will go' : 'went'} into ${from}`
      : `${was} booked to ${from}`;
  const category = `in the ${name} category`;
  const noAccount = `${listNames(notAccounts)} ${notAccounts.length === 1 ? 'is not an account' : 'are not accounts'}`;

  const head = one
    ? `"${name}" is set to Account in the mapping step, but its row has ${listNames([...paidFrom, ...notAccounts])} as its Means of Payment`
    : `"${name}" is set to Account in the mapping step, but its ${rows} rows have ${listNames([...paidFrom, ...notAccounts])} as their Means of Payment`;
  let what: string;
  if (notAccounts.length === 0) {
    what = `${head}, so ${one ? 'it' : 'they'} ${moved} ${categorised ? category : 'with no category'}.`;
  } else if (paidFrom.length === 0) {
    what = `${head}. ${noAccount}, so ${one ? 'it' : 'they'} ${was} left with no account${categorised ? `, ${category}` : ' and no category'}.`;
  } else {
    const rowsWere = preview ? 'will be' : 'were';
    what = `${head}. The rows with ${from} ${rowsWere} booked to ${paidFrom.length === 1 ? 'it' : 'those accounts'}, and the rest ${rowsWere} left with no account because ${noAccount}. ${categorised ? `All of them ${preview ? 'will be' : 'are'} ${category}` : 'None of them has a category'}.`;
  }

  const setTo = onlyIncomes ? 'Income' : kinds.has('income') ? 'Expense or Income' : 'Expense';
  const rowsType = one ? "this row's Type" : "these rows' Type";
  const transfer = !onlyExpenses
    ? ''
    : preview
      ? ` To move the money into ${name} instead, change ${rowsType} to Transfer before you import.`
      : ` To move the money into ${name} instead, delete this import under Recent Imports, change ${rowsType} to Transfer, and import again.`;
  return `${what} Set ${name} to ${setTo}.${transfer}`;
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
