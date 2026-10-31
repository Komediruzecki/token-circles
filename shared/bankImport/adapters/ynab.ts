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
 *    YNAB 4's thirteen-column register (Check Number, Master Category, Running
 *    Balance) is not a goal here and is not tested.
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
 * The register YNAB exports. Required: the columns every row is read from. Plus one column the
 * import CSV never has, so a five-column import file is not mistaken for it.
 */
function isRegister(names: string[]): boolean {
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
    if (isRegister(names)) return 0.97;
    const head = names.join(',');
    if (head === 'date,payee,category,memo,outflow,inflow') return 0.97;
    if (head === 'date,payee,memo,outflow,inflow') return 0.95;
    if (head === 'date,payee,memo,amount') return 0.85;
    if (/ynab/i.test(input.filename)) return 0.6;
    return 0;
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8');
    const delimiter = sniffDelimiter(firstLine(text));
    const matrix = splitDelimited(text, delimiter);
    // Keep the header as row 0 — transform() resolves columns from it, so the
    // Category-less, signed-Amount and register variants all work.
    const rows = matrix.filter((r) => r.some((c) => c));
    return { rows, meta: registerMeta(rows) };
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows;
    if (!header) return [];
    if (isRegister(columnNames(header))) return transformRegister(header, data, ctx);
    const col = indexHeader(header);
    const toDate = makeDateNormalizer(data.map((r) => r[col.date ?? -1] || ''));
    const out: CanonicalTxn[] = [];
    for (const r of data) {
      const date = toDate(r[col.date ?? -1] || '');
      if (!date) continue;
      const outflow = parseYnabAmount(r[col.outflow ?? -1] || '');
      const inflow = parseYnabAmount(r[col.inflow ?? -1] || '');
      const amount =
        col.outflow !== undefined || col.inflow !== undefined
          ? inflow - Math.abs(outflow)
          : parseYnabAmount(r[col.amount ?? -1] || '0');
      const payee = r[col.payee ?? -1] || '';
      const memo = r[col.memo ?? -1] || '';
      const raw: RawTxn = {
        date,
        amount,
        // YNAB files carry no currency; leave it empty and let the import
        // pipeline fall back to the app default.
        currency: '',
        description: memo || payee,
        counterparty: payee,
        // The format carries no time/balance/reference, so two genuinely
        // distinct same-day/payee/amount rows collide — the preview flags
        // them as duplicates (deselected) for the user to re-check.
        dedupKey: r.join('\x01'),
      };
      const txn = buildTxn(raw, ctx);
      // The file's own Category (minus a "Group: " prefix) beats keyword rules.
      const fileCategory = (r[col.category ?? -1] || '').split(':').pop()?.trim();
      if (txn.type !== 'Transfer' && fileCategory) txn.category = fileCategory;
      out.push(txn);
    }
    return out;
  },
};

/** One register row, read: its account, date, signed amount and text. */
interface RegisterRow {
  cells: string[];
  account: string;
  date: string;
  /** Signed, as seen from `account`: negative = out, positive = in. */
  amount: number;
  payee: string;
  memo: string;
  category: string;
  group: string;
}

function readRegister(header: string[], data: string[][], fallbackAccount: string): RegisterRow[] {
  const col = indexHeader(header);
  const cell = (r: string[], name: string) => (r[col[name] ?? -1] || '').trim();
  const toDate = makeDateNormalizer(data.map((r) => cell(r, 'date')));
  const rows: RegisterRow[] = [];
  for (const r of data) {
    const date = toDate(cell(r, 'date'));
    if (!date) continue;
    rows.push({
      cells: r,
      account: cell(r, 'account') || fallbackAccount,
      date,
      // Both columns are written on every row, the unused one as zero: net them.
      amount: round2(parseYnabAmount(cell(r, 'inflow')) - parseYnabAmount(cell(r, 'outflow'))),
      payee: cell(r, 'payee'),
      memo: cell(r, 'memo').replace(SPLIT_MARKER, '').trim(),
      category: cell(r, 'category'),
      group: cell(r, 'categorygroup'),
    });
  }
  return rows;
}

/** The accounts the register names and its starting balances; nothing for the import CSV. */
function registerMeta(rows: string[][]): StatementMeta {
  const [header, ...data] = rows;
  if (!header) return {};
  const names = columnNames(header);
  if (!isRegister(names) || !names.includes('account')) return {};
  const accounts: string[] = [];
  const startingBalances: Record<string, { amount: number; date: string }> = {};
  for (const row of readRegister(header, data, '')) {
    if (row.account && !accounts.includes(row.account)) accounts.push(row.account);
    if (row.payee !== STARTING_BALANCE || !row.account) continue;
    // One per account in YNAB; should someone have made a second, both count, from the first date.
    const prior = startingBalances[row.account];
    startingBalances[row.account] = prior
      ? {
          amount: round2(prior.amount + row.amount),
          date: prior.date < row.date ? prior.date : row.date,
        }
      : { amount: row.amount, date: row.date };
  }
  return accounts.length > 0 ? { accounts, startingBalances } : {};
}

function transformRegister(
  header: string[],
  data: string[][],
  ctx: TransformContext
): CanonicalTxn[] {
  const out: CanonicalTxn[] = [];
  // Transfer halves already imported whose mirror has not come yet: key → how many.
  const awaitingMirror = new Map<string, number>();
  for (const row of readRegister(header, data, ctx.targetAccount)) {
    if (row.payee === STARTING_BALANCE) continue;
    if (row.amount === 0) continue;
    const rowCtx: TransformContext = { ...ctx, targetAccount: row.account };
    const raw: RawTxn = {
      date: row.date,
      amount: row.amount,
      // The register carries a currency sign, not a code; the import falls back to the app's.
      currency: '',
      description: row.memo || row.payee,
      counterparty: row.payee,
      dedupKey: row.cells.join('\x01'),
    };

    const other = row.payee.match(TRANSFER_PAYEE)?.[1]?.trim();
    if (other && other.toLowerCase() !== row.account.toLowerCase()) {
      // A half's mirror has the accounts swapped and the sign flipped.
      const mine = transferKey(row.date, row.account, other, row.amount);
      const waiting = awaitingMirror.get(mine) ?? 0;
      if (waiting > 0) {
        awaitingMirror.set(mine, waiting - 1);
        continue;
      }
      const mirror = transferKey(row.date, other, row.account, -row.amount);
      awaitingMirror.set(mirror, (awaitingMirror.get(mirror) ?? 0) + 1);
      const txn = transferTxn(raw, rowCtx, other);
      if (!row.memo) txn.description = `Transfer to ${txn.category}`;
      out.push(txn);
      continue;
    }

    // YNAB already said this row is not a transfer: no keyword may turn it into one.
    const txn = buildTxn(raw, { ...rowCtx, transferRules: NO_TRANSFER_RULES });
    if (row.category && row.group.toLowerCase() !== INFLOW_GROUP) txn.category = row.category;
    out.push(txn);
  }
  return out;
}

function transferKey(date: string, from: string, to: string, amount: number): string {
  return [date, from.toLowerCase(), to.toLowerCase(), amount.toFixed(2)].join('\x01');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
 * Tolerate currency symbols and codes on either side ("$4.50", "4,50 €",
 * "4.50 EUR", "kr 30,00", "1.234,56 kr.") and accounting negatives ("(4.50)")
 * instead of silently parsing them as 0. Only the span from the first digit to
 * the last is the number, so an abbreviation's dot ("kr.") is not read as a
 * decimal point.
 */
function parseYnabAmount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const negative = /^\(.*\)$/.test(trimmed) || /^[^0-9]*-/.test(trimmed);
  const digits = trimmed.match(/\d(?:.*\d)?/)?.[0] ?? '';
  const n = Math.abs(parseFlexibleNumber(digits.replace(/[^0-9.,]/g, '')));
  return negative ? -n : n;
}
