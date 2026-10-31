/**
 * YNAB adapter: the CSV YNAB reads, and the register YNAB writes.
 *
 * 1. The import CSV (help.ynab.com "Formatting a CSV File"), header on row 1:
 *      Date,Payee,Category,Memo,Outflow,Inflow   (Category may be absent)
 *      Date,Payee,Memo,Amount                    (signed amount)
 *    This is the de-facto interchange format of the budgeting world: bank2ynab
 *    (github.com/bank2ynab/bank2ynab, MIT) converts 145+ banks' exports into it,
 *    and most "export to YNAB" tools emit it — so accepting it here indirectly
 *    covers every bank those tools support. One file is one account: the user
 *    picks it.
 *
 * 2. The register YNAB exports: the transactions file of "Export Plan", or
 *    "Export # Transactions" from an account register. Its header, from
 *    parse-ynab-export 1.0.6's sample (npm, read 2026-10-31):
 *      Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,
 *      Memo,Outflow,Inflow,Cleared
 *    Text cells are quoted; amounts are bare and carry the plan's currency sign
 *    on either side ("$1,250.00", "kr 30,00", "84,23€"). YNAB writes CSV, or TSV
 *    "for currencies that use a comma" (support.ynab.com "How to Export Plan
 *    Data", updated 2026-08-18), so the delimiter is sniffed from the header.
 *    The file's name is no help: a plan export starts "YNAB Export - ", a
 *    selection "Selected Transactions for ", and people rename files anyway.
 *    Row conventions, each from a source rather than a guess:
 *      - Account names the account of every row, so one file holds a whole plan.
 *      - A transfer's Payee is "Transfer : <other account>", and YNAB writes it
 *        in both registers (parse-ynab-export, csv_to_ynab_json.py, de_ynab;
 *        YNAB "Transfer Transactions": it "will now show up in both account
 *        registers"). The two halves pair on date, accounts and amount and
 *        import as one transfer; a half without its partner still imports as a
 *        transfer, since its Payee already names the other account.
 *      - The Payee "Starting Balance" is the opening balance (YNAB "The Starting
 *        Balance"). It is not income: it goes to `meta.startingBalances`, which
 *        the import offers as each new account's starting balance.
 *      - Income is categorised Inflow: Ready to Assign (csv_to_ynab_json.py,
 *        2026-04-03). That is a YNAB budgeting bucket, not a category, so the
 *        keyword rules categorise those rows instead.
 *      - Split parts are separate rows whose Memo starts "Split (n/m) "
 *        (parse-ynab-export). Each imports as its own row, marker removed.
 *    YNAB 4's register (Check Number, Master Category, Sub Category, Running
 *    Balance) is not claimed, so it is not detected at all.
 *    A category named like an account the file names is not used (the
 *    canonical Category doubles as a transfer's destination), and the file
 *    says so in `meta.warnings`, as it does for rows it skips.
 *
 * Dates pass through normalizeDate (ISO or DD.MM.YYYY / DD/MM/YYYY — day-first,
 * the European convention, when ambiguous), with one order decided per file.
 * A non-empty Category in the file wins over keyword rules — it's the user's
 * explicit categorization; a "Group: Category" value keeps only the category part.
 */
import { buildTxn, transferTxn } from '../classify';
import {
  decodeText,
  indexHeader,
  normalizeDate,
  parseFlexibleNumber,
  splitDelimited,
} from '../parse';
import type { RawTxn } from '../classify';
import type { ParseDeps } from '../xlsx';
import type {
  BankAdapter,
  CanonicalTxn,
  DetectInput,
  ParsedStatement,
  StatementMeta,
  TransformContext,
} from '../types';

type Delimiter = ',' | ';' | '\t';

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? '';
}

/** The separator the header uses most: YNAB writes ',' or tabs; Excel may resave with ';'. */
function sniffDelimiter(headerLine: string): Delimiter {
  const count = (d: string) => headerLine.split(d).length - 1;
  const ranked = (['\t', ';', ','] as const).map((d) => ({ d, n: count(d) }));
  ranked.sort((a, b) => b.n - a.n);
  return ranked[0].n > 0 ? ranked[0].d : ',';
}

/** Column names lowercased with quotes and spaces removed, as indexHeader keys them. */
function columnNames(header: string[]): string[] {
  return header.map((c) => c.toLowerCase().replace(/["\s]/g, ''));
}

function headerNames(text: string): string[] {
  const line = firstLine(text);
  return columnNames(splitDelimited(line, sniffDelimiter(line))[0] ?? []);
}

/**
 * YNAB 4's register (Check Number, Master Category, Sub Category, Running Balance; de_ynab,
 * beancount.io). Not claimed, so not read: it goes to manual column mapping.
 */
function isYnab4(names: string[]): boolean {
  return ['checknumber', 'mastercategory', 'subcategory', 'runningbalance'].some((n) =>
    names.includes(n)
  );
}

/**
 * The register YNAB exports. Required: the columns every row is read from. Plus one column the
 * import CSV never has, so a five-column import file is not mistaken for it.
 */
function isRegister(names: string[]): boolean {
  if (isYnab4(names)) return false;
  const has = (n: string) => names.includes(n);
  const reads = ['date', 'payee', 'outflow', 'inflow'].every(has);
  const registerOnly = ['account', 'flag', 'cleared', 'categorygroup/category'].some(has);
  return reads && registerOnly;
}

const NO_TRANSFER_RULES = { ownAccounts: [], keywords: [], counterparts: {} };
const TRANSFER_PAYEE = /^Transfer : (.+)$/;
const STARTING_BALANCE = 'Starting Balance';
const SPLIT_MARKER = /^Split \(\d+\/\d+\)\s*/;
const INFLOW_GROUP = 'inflow';

export const ynabAdapter: BankAdapter = {
  id: 'ynab',
  label: 'YNAB',
  accept: ['csv', 'tsv'],

  detect(input: DetectInput): number {
    const names = headerNames(input.textPreview);
    if (isYnab4(names)) return 0;
    if (isRegister(names)) return 0.97;
    const head = names.join(',');
    if (head === 'date,payee,category,memo,outflow,inflow') return 0.97;
    if (head === 'date,payee,memo,outflow,inflow') return 0.95;
    if (head === 'date,payee,memo,amount') return 0.85;
    if (/ynab/i.test(input.filename)) return 0.6;
    return 0;
  },

  async parse(bytes: Uint8Array, _filename: string, deps?: ParseDeps): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8');
    const delimiter = sniffDelimiter(firstLine(text));
    const matrix = splitDelimited(text, delimiter);
    // Keep the header as row 0 — transform() resolves columns from it, so the
    // Category-less, signed-Amount and register variants all work.
    const rows = matrix.filter((r) => r.some((c) => c));
    return { rows, meta: readFile(rows, deps?.knownAccounts)?.meta ?? {} };
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const file = readFile(parsed.rows, ctx.knownAccounts);
    if (!file) return [];
    if (file.register) return transformRegister(file, ctx);
    const out: CanonicalTxn[] = [];
    for (const row of file.rows) {
      const raw: RawTxn = {
        date: row.date,
        amount: row.amount,
        // YNAB files carry no currency; leave it empty and let the import
        // pipeline fall back to the app default.
        currency: '',
        description: row.memo || row.payee,
        counterparty: row.payee,
        // The format carries no time/balance/reference, so two genuinely
        // distinct same-day/payee/amount rows collide — the preview flags
        // them as duplicates (deselected) for the user to re-check.
        dedupKey: row.cells.join('\x01'),
      };
      const txn = buildTxn(raw, ctx);
      // The file's own Category (minus a "Group: " prefix) beats keyword rules, unless it is an
      // account's name: the import would book the row against that account.
      if (
        txn.type !== 'Transfer' &&
        row.category &&
        !file.accountNames.has(row.category.toLowerCase())
      ) {
        txn.category = row.category;
      }
      out.push(txn);
    }
    return out;
  },
};

/** One data row, read: its account (register only), date, signed amount and text. */
interface ReadRow {
  cells: string[];
  /** '' when the file has no Account column: the row belongs to the file's target account. */
  account: string;
  date: string;
  /** Signed, as seen from `account`: negative = out, positive = in. */
  amount: number;
  payee: string;
  memo: string;
  category: string;
  group: string;
}

interface ReadFile {
  register: boolean;
  rows: ReadRow[];
  /**
   * Lowercased names of accounts: the ones the file names (its Account values and transfer
   * payees) and the ones the profile already has.
   */
  accountNames: Set<string>;
  meta: StatementMeta;
}

/**
 * Read either shape into rows, plus what the import needs to know about the file. Pure, so
 * parse() (for the metadata) and transform() (for the rows) read the same thing.
 */
function readFile(matrix: string[][], knownAccounts: string[] = []): ReadFile | null {
  const [header, ...data] = matrix;
  if (!header) return null;
  const names = columnNames(header);
  const register = isRegister(names);
  const col = indexHeader(header);
  const cell = (r: string[], name: string) => (r[col[name] ?? -1] || '').trim();

  // A row with more cells than the header has its columns shifted: an unquoted "$1,250.00" in
  // a comma file is the usual cause. Reading it would book the wrong amount, so skip it. Extra
  // cells that are all empty are a trailing separator, and the row is read.
  const fits = data.filter(
    (r) => r.length <= header.length || r.slice(header.length).every((c) => !c.trim())
  );
  const tooWide = data.length - fits.length;

  const amountColumns = ['outflow', 'inflow', 'amount'].filter((n) => col[n] !== undefined);
  const toAmount = makeAmountReader(fits.flatMap((r) => amountColumns.map((n) => cell(r, n))));
  const toDate = makeDateNormalizer(fits.map((r) => cell(r, 'date')));
  const hasSplitAmounts = col.outflow !== undefined || col.inflow !== undefined;

  const rows: ReadRow[] = [];
  let undated = 0;
  for (const r of fits) {
    const date = toDate(cell(r, 'date'));
    if (!date) {
      undated++;
      continue;
    }
    const amount = register
      ? // Both columns are written on every row, the unused one as zero: net them.
        roundAmount(toAmount(cell(r, 'inflow')) - toAmount(cell(r, 'outflow')))
      : hasSplitAmounts
        ? toAmount(cell(r, 'inflow')) - Math.abs(toAmount(cell(r, 'outflow')))
        : toAmount(cell(r, 'amount') || '0');
    rows.push({
      cells: r,
      account: register ? cell(r, 'account') : '',
      date,
      amount,
      payee: cell(r, 'payee'),
      memo: register ? cell(r, 'memo').replace(SPLIT_MARKER, '').trim() : cell(r, 'memo'),
      category: register
        ? cell(r, 'category')
        : (cell(r, 'category').split(':').pop()?.trim() ?? ''),
      group: register ? cell(r, 'categorygroup') : '',
    });
  }

  const warnings: string[] = [];
  if (tooWide > 0) {
    warnings.push(
      tooWide === 1
        ? '1 row was skipped because it has more cells than the header: an amount with a comma that is not in quotes is the usual cause.'
        : `${tooWide} rows were skipped because they have more cells than the header: an amount with a comma that is not in quotes is the usual cause.`
    );
  }
  if (undated > 0) {
    warnings.push(
      undated === 1
        ? '1 row was skipped because its date could not be read.'
        : `${undated} rows were skipped because their date could not be read.`
    );
  }

  const accountNames = new Set(knownAccounts.map((a) => a.toLowerCase()));
  const accounts: string[] = [];
  if (register) {
    for (const row of rows) {
      if (row.account && !accounts.includes(row.account)) accounts.push(row.account);
      if (row.account) accountNames.add(row.account.toLowerCase());
      const other = row.payee.match(TRANSFER_PAYEE)?.[1]?.trim();
      if (other) accountNames.add(other.toLowerCase());
    }
  }

  // A category with an account's name would make the import book its rows against that account,
  // or read them as transfers into it (the canonical Category doubles as a transfer's destination).
  const clashes: string[] = [];
  for (const row of rows) {
    if (!usesFileCategory(row) || !accountNames.has(row.category.toLowerCase())) continue;
    if (!clashes.some((c) => c.toLowerCase() === row.category.toLowerCase())) {
      clashes.push(row.category);
    }
  }
  if (clashes.length === 1) {
    warnings.push(
      `The category ${clashes[0]} has the name of an account, so its rows were categorized by your rules instead.`
    );
  } else if (clashes.length > 1) {
    warnings.push(
      `The categories ${listed(clashes)} have the names of accounts, so their rows were categorized by your rules instead.`
    );
  }
  if (!register) {
    return { register, rows, accountNames, meta: warnings.length ? { warnings } : {} };
  }

  // Keyed by account; '' is the file's own account when it has no Account column, which
  // processFiles resolves to the account chosen for the file.
  const startingBalances: Record<string, { amount: number; date: string }> = {};
  for (const row of rows) {
    if (row.payee !== STARTING_BALANCE) continue;
    // One per account in YNAB; should someone have made a second, both count, from the first date.
    const prior = startingBalances[row.account];
    startingBalances[row.account] = prior
      ? {
          amount: roundAmount(prior.amount + row.amount),
          date: prior.date < row.date ? prior.date : row.date,
        }
      : { amount: row.amount, date: row.date };
  }

  const meta: StatementMeta = {};
  if (accounts.length > 0) meta.accounts = accounts;
  if (Object.keys(startingBalances).length > 0 || accounts.length > 0) {
    meta.startingBalances = startingBalances;
  }
  if (warnings.length > 0) meta.warnings = warnings;
  return { register, rows, accountNames, meta };
}

/** A register row whose own Category is used: not Ready to Assign, and not an account's name. */
function usesFileCategory(row: ReadRow): boolean {
  return Boolean(row.category) && row.group.toLowerCase() !== INFLOW_GROUP;
}

function listed(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function transformRegister(file: ReadFile, ctx: TransformContext): CanonicalTxn[] {
  const out: CanonicalTxn[] = [];
  // Transfer halves already imported whose mirror has not come yet: key → how many.
  const awaitingMirror = new Map<string, number>();
  // How many times each identical row has been emitted: the nth copy gets its own duplicate key,
  // so two same-day $3 coffees are two rows, while a second read of the file matches one for one.
  const emitted = new Map<string, number>();
  const dedupKey = (cells: string[]) => {
    const base = cells.join('\x01');
    const nth = emitted.get(base) ?? 0;
    emitted.set(base, nth + 1);
    return `${base}\x01#${nth}`;
  };

  for (const row of file.rows) {
    if (row.payee === STARTING_BALANCE) continue;
    if (row.amount === 0) continue;
    const account = row.account || ctx.targetAccount;
    const rowCtx: TransformContext = { ...ctx, targetAccount: account };
    const raw: RawTxn = {
      date: row.date,
      amount: row.amount,
      // The register carries a currency sign, not a code; the import falls back to the app's.
      currency: '',
      description: row.memo || row.payee,
      counterparty: row.payee,
    };

    const other = row.payee.match(TRANSFER_PAYEE)?.[1]?.trim();
    if (other && other.toLowerCase() !== account.toLowerCase()) {
      // A half's mirror has the accounts swapped and the sign flipped.
      const mine = transferKey(row.date, account, other, row.amount);
      const waiting = awaitingMirror.get(mine) ?? 0;
      if (waiting > 0) {
        awaitingMirror.set(mine, waiting - 1);
        continue;
      }
      const mirror = transferKey(row.date, other, account, -row.amount);
      awaitingMirror.set(mirror, (awaitingMirror.get(mirror) ?? 0) + 1);
      const txn = transferTxn({ ...raw, dedupKey: dedupKey(row.cells) }, rowCtx, other);
      if (!row.memo) txn.description = `Transfer to ${txn.category}`;
      out.push(txn);
      continue;
    }

    // YNAB already said this row is not a transfer: no keyword may turn it into one.
    const txn = buildTxn(
      { ...raw, dedupKey: dedupKey(row.cells) },
      { ...rowCtx, transferRules: NO_TRANSFER_RULES }
    );
    if (usesFileCategory(row) && !file.accountNames.has(row.category.toLowerCase())) {
      txn.category = row.category;
    }
    out.push(txn);
  }
  return out;
}

function transferKey(date: string, from: string, to: string, amount: number): string {
  return [date, from.toLowerCase(), to.toLowerCase(), amount.toFixed(6)].join('\x01');
}

/** Drop the float noise of adding amounts ("0.1 + 0.2"), keeping a three-decimal currency's mills. */
function roundAmount(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const SLASHED_DATE = /^(\d{1,2})([./-])(\d{1,2})[./-](\d{4})/;

/**
 * Decide the file's date order ONCE and apply it to every row — per-row
 * guessing would interpret "06/22/2026" and "06/07/2026" from the same US
 * export under two different conventions. Any date whose second segment can't
 * be a month proves month-first (US YNAB examples); any whose first can't
 * proves day-first and wins outright. Ambiguous files default to day-first
 * (the European convention, as documented in the header).
 */
function makeDateNormalizer(dateCells: string[]): (value: string) => string {
  let monthFirst = false;
  for (const cell of dateCells) {
    const m = cell.trim().match(SLASHED_DATE);
    if (!m) continue;
    const first = parseInt(m[1], 10);
    const second = parseInt(m[3], 10);
    if (first > 12 && second <= 12) {
      monthFirst = false;
      break;
    }
    if (second > 12 && first <= 12) monthFirst = true;
  }
  return (value: string) => {
    const trimmed = value.trim();
    if (monthFirst) {
      const m = trimmed.match(SLASHED_DATE);
      // Rewrite MM?DD?YYYY as day-first and let normalizeDate validate it.
      if (m) return normalizeDate(`${m[3]}${m[2]}${m[1]}${m[2]}${m[4]}`);
    }
    return normalizeDate(trimmed);
  };
}

/**
 * The number in an amount cell: from a separator just before the first digit (".50") to the
 * last digit, with currency signs, codes, spaces and apostrophes dropped. So "kr." does not lend
 * its dot, and "1 234,56 €", "CHF 1'234.50" and "₹1,23,456.78" keep only digits and separators.
 */
function numberSpan(value: string): string {
  return (value.match(/[.,]?\d(?:.*\d)?/)?.[0] ?? '').replace(/[^0-9.,]/g, '');
}

/** Which separator a number proves is its decimal point, if any. */
function decimalEvidence(s: string): '.' | ',' | null {
  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  if (dots > 0 && commas > 0) return s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  const sep = dots > 0 ? '.' : commas > 0 ? ',' : null;
  if (!sep) return null;
  // Leading (".50"): a decimal point. Repeated ("1.234.567"): thousands, so the other one is.
  if (s.startsWith(sep)) return sep;
  if (dots + commas > 1) return sep === '.' ? ',' : '.';
  // A thousands group never starts at a whole part of "0" or after more than three digits, so
  // "0.500" and "1234,567" are decimals.
  const whole = s.slice(0, s.indexOf(sep));
  if (whole === '0' || whole.length > 3) return sep;
  // One separator before exactly three digits ("1,234", "1.234") could be either.
  return s.length - s.indexOf(sep) - 1 === 3 ? null : sep;
}

/**
 * Decide the file's decimal separator ONCE from every amount cell, the way the date order is
 * decided: "1,234" is 1234 in a file whose other amounts read "5.50". A file of a currency without
 * decimals ("¥1,234", "1.234 kr.") proves it by its zeros, which the register writes with a
 * currency sign and no separator ("¥0", "0 kr."). A file that proves nothing reads a dot as a
 * decimal point and a comma as a thousands separator, so "12.345" dinars stay 12.345 and "2,000"
 * dollars stay 2000. A file whose cells prove both separators reads each cell on its own.
 */
function makeAmountReader(cells: string[]): (value: string) => number {
  let dot = false;
  let comma = false;
  let wholeZero = false;
  for (const c of cells) {
    const span = numberSpan(c);
    const evidence = decimalEvidence(span);
    if (evidence === '.') dot = true;
    if (evidence === ',') comma = true;
    if (/^0+$/.test(span) && /[^\d\s+-]/.test(c)) wholeZero = true;
  }
  const decimal = dot && comma ? 'mixed' : comma ? ',' : dot ? '.' : wholeZero ? 'none' : '.';
  return (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const negative = /^\(.*\)$/.test(trimmed) || /^[^0-9]*-/.test(trimmed);
    const s = numberSpan(trimmed);
    let n: number;
    if (decimal === '.') n = parseFloat(s.replace(/,/g, ''));
    else if (decimal === ',') n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    else if (decimal === 'none') n = parseFloat(s.replace(/[.,]/g, ''));
    else n = parseFlexibleNumber(s);
    n = Number.isFinite(n) ? Math.abs(n) : 0;
    return negative ? -n : n;
  };
}
