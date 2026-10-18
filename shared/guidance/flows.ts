/**
 * Money in and money out, as the badges, the year in review and the guidance read a set of entries.
 *
 * Four entry types move money: income, expense, transfer and deduction. A deduction is part of pay
 * that never reaches an account, like tax or a pension contribution taken at source: it lowers
 * income, it is never spending, and it moves no balance. So:
 *
 * - `income` is income less deductions: what reached an account;
 * - `spending` is expenses, and only expenses;
 * - a transfer is neither, as it only moves money between accounts.
 *
 * The balances and the emergency fund calculator already read a deduction this way. The research
 * behind the guidance counted it as spending; it is not, as no cushion pays withheld tax. No form
 * creates a deduction: only the API, the MCP and older data hold any.
 *
 * Pure, with no amounts of its own: the caller says how much each entry is worth (the app counts
 * the base-currency amount), and this adds them up.
 */

export interface Flows {
  /** Income less deductions: what reached an account. */
  income: number;
  /** The deductions: pay that never reached an account. */
  deductions: number;
  /** Expenses: what was spent. A deduction is never spending, and a transfer is neither. */
  spending: number;
}

/** An entry as the sums read it: its type, and the month it falls in by its date. */
export interface FlowEntry {
  type: string;
  date: string;
}

const NONE: Flows = { income: 0, deductions: 0, spending: 0 };

/** The flows of a set of entries. `amount` gives each entry's size; its sign is ignored. */
export function flowsOf<T extends Pick<FlowEntry, 'type'>>(
  entries: Iterable<T>,
  amount: (entry: T) => number
): Flows {
  let booked = 0;
  let deductions = 0;
  let spending = 0;
  for (const entry of entries) {
    if (entry.type === 'income') booked += Math.abs(amount(entry));
    else if (entry.type === 'deduction') deductions += Math.abs(amount(entry));
    else if (entry.type === 'expense') spending += Math.abs(amount(entry));
  }
  return { income: booked - deductions, deductions, spending };
}

/** The flows of each month the entries fall in, by `YYYY-MM`. */
export function flowsByMonth<T extends FlowEntry>(
  entries: Iterable<T>,
  amount: (entry: T) => number
): Map<string, Flows> {
  const byMonth = new Map<string, T[]>();
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    const list = byMonth.get(month);
    if (list) list.push(entry);
    else byMonth.set(month, [entry]);
  }
  const flows = new Map<string, Flows>();
  for (const [month, list] of byMonth) flows.set(month, flowsOf(list, amount));
  return flows;
}

/** What a month or a year kept: income less spending. Below zero for one in the red. */
export function savedOf(flows: Flows = NONE): number {
  return flows.income - flows.spending;
}
