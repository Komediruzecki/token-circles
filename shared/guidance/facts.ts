/**
 * The person's own numbers, as the seven circles (circles.ts) and Getting started read them:
 * worked out on the device from what the app already holds, the same way in both storage modes
 * (guidance.md section 3.1).
 *
 * - **The window**: the last twelve tracked months before this one, or all of them when there are
 *   fewer. This month is left out while it is under way, because half a month would pull every
 *   average down. A tracked month is the badges' (shared/trackedMonths.ts), and an average needs
 *   MIN_MONTHS_FOR_AVERAGES of them, as the retirement averages do.
 * - **Spending** is expenses and **income** is income less deductions (flows.ts), a month on
 *   average over the window, in the base currency. **Own income** leaves out the categories the
 *   person marks as support they expect to stop.
 * - **Essential spending** is spending in the categories needed every month (kinds.ts
 *   `essentialOf`: the person's choice, else the kind, else needed). Spending with no category
 *   counts as needed too: like a category with no kind, it errs towards a larger cushion, and
 *   `unsure` says how much was counted that way.
 * - **Liquid money**, the money a person can reach: savings and cash balances, and the lowest
 *   total the current accounts ended a day on in the last 30 days, read back together as one pool
 *   from their balances through the entries since (guidance.md 3.1, "the lowest current-account
 *   balance"). So a move between two current accounts hides nothing. None of it counts below zero,
 *   and one account's overdraft takes nothing from another.
 * - **Invested** (`investedOf`): investment accounts or the portfolio, whichever holds more, and
 *   savings the person says are held elsewhere.
 * - **Debts** (`debtsOf`, design section 5): loans with a balance left, at the rate charged now,
 *   and credit cards and current accounts below zero.
 *
 * Pure, with no I/O: the caller passes what it read.
 */
import { storedAccountType } from '../accountSchema';
import { addCalendarMonths, addDays } from '../calendarMonths';
import { amortize, loanStatus, rateStretches } from '../loanSchedule';
import { nextPaymentMonth } from '../loanScenarios';
import { DEFAULT_SETTINGS, MIN_MONTHS_FOR_AVERAGES } from '../retirementSettings';
import { trackedMonthsInYearWindow, trackedMonthsOf, YEAR_ON_FILE_MONTHS } from '../trackedMonths';
import { flowsOf } from './flows';
import { categoryLookup, essentialOf } from './kinds';
import type { LoanInput } from '../loanSchedule';
import type { KindedCategory } from './kinds';
import type { Region } from './region';

/** How many tracked months the averages run over, at most: a year. */
export const WINDOW_MONTHS = YEAR_ON_FILE_MONTHS;

/** The days the current accounts' low point is looked for in: today and the 29 before it. */
export const LOW_POINT_DAYS = 30;

/**
 * The rate from which a debt is expensive, in percent a year: the high edge of `debt.rate` in
 * every region (benchmarks.json, which a test holds this to). A card or overdraft balance is
 * expensive unless its rate is set below it, because a carried balance is where the money goes
 * first (guidance.md 3.1).
 */
export const EXPENSIVE_DEBT_RATE = 10;

/** The full months a card's payment is averaged over: the transfers into it. */
export const CARD_PAYMENT_MONTHS = 3;

/**
 * D6: loan principal repaid counts as saving in the savings rate, as it does in the national
 * figures the rate is set beside. Both rates are worked out either way (`savings`); this says
 * which one is the person's.
 */
export const LOAN_PRINCIPAL_IS_SAVING = true;

/** An entry as the facts read it: the fields both runtimes store. */
export interface FactsEntry {
  /** YYYY-MM-DD; anything after the day is ignored. */
  date: string;
  type: string;
  amount: number;
  /** The amount in the base currency, when the entry was in another. */
  amount_local?: number | null;
  category_id?: number | null;
  account_id?: number | null;
  /** A transfer's other account. */
  transfer_account_id?: number | null;
}

/** An account as the facts read it. */
export interface FactsAccount {
  id: number;
  type: string;
  /** Now, in the base currency. Money owed is below zero. */
  balance: number;
  name?: string | null;
  /** A credit card's or an overdraft's yearly rate, in percent; null for none given. */
  credit_rate?: number | null;
}

/** A loan as Loans holds it, with its rate periods and extra payments. */
export interface FactsLoan extends LoanInput {
  id?: number | null;
  name?: string | null;
}

/** The answer to the free-money question (guidance.md 5.5). */
export type FreeMoney = 'taken' | 'not-taken' | 'not-offered' | 'not-sure';

/**
 * The questions the circles ask once, each when it is first needed (guidance.md 5.5). Absent or
 * null is not answered yet. The answers record holds none of them yet.
 */
export interface FactsAnswers {
  /** Categories whose income is support the person expects to stop (circle 2). */
  supportCategoryIds?: readonly number[] | null;
  /** "Do you carry a balance on a credit card or overdraft?" No leaves both out of the debts. */
  carriesCardBalance?: boolean | null;
  /** Whether the employer's or the state's free money is taken (circle 4). */
  freeMoney?: FreeMoney | null;
  /** Pension and investment savings held outside the app, in the base currency (circle 5). */
  savedElsewhere?: number | null;
  /** What a year of more than enough would cost, in the base currency (circle 7). */
  enoughPerYear?: number | null;
}

export interface GuidanceInput {
  /** YYYY-MM-DD. */
  today: string;
  region: Region;
  transactions: readonly FactsEntry[];
  categories: readonly KindedCategory[];
  /** Null when they could not be read: what they hold is then unknown, not nothing. */
  accounts: readonly FactsAccount[] | null;
  loans?: readonly FactsLoan[];
  /** The portfolio's value now, in the base currency. */
  holdings?: number | null;
  /** The retirement settings' safe withdrawal rate, in percent; their default when none. */
  withdrawalRatePct?: number | null;
  answers?: FactsAnswers;
}

/** A debt the person carries. */
export interface Debt {
  /** A loan on Loans, a credit card, or a current account below zero. */
  kind: 'loan' | 'card' | 'overdraft';
  /** The loan's or the account's id; null when the row gives none. */
  id: number | null;
  name: string | null;
  /** Still owed now, above zero. */
  owed: number;
  /** The yearly rate charged now, in percent; null for a card or overdraft with none given. */
  rate: number | null;
  /**
   * A month's payment: a loan's next installment, or what went into a card on average over the
   * last CARD_PAYMENT_MONTHS full months. Null when nothing says.
   */
  payment: number | null;
  /** At EXPENSIVE_DEBT_RATE or more; a card or overdraft unless its rate is set below it. */
  expensive: boolean;
}

/** The money a person can reach against a month of what they need. */
export interface Cushion {
  /** Liquid money now; null when no account it could be in is on file. */
  liquid: number | null;
  /** Essential spending, a month on average; null with too few months. */
  essentials: number | null;
  /** Liquid money in months of essential spending; null when either is unknown. */
  months: number | null;
}

export interface GuidanceFacts {
  today: string;
  region: Region;
  /** The window's tracked months, oldest first. */
  months: string[];
  /** Tracked months in the year window that ends this month: a year is on file at twelve. */
  monthsInYear: number;
  /** A year is on file. Until then whatever comes from the averages may still move. */
  firm: boolean;
  /** The window has the months an average needs. */
  averaged: boolean;
  /** Of the window's spending, the share filed under a category, in percent; null with none. */
  sortedShare: number | null;
  /** Income less deductions, a month on average; null with too few months, as are the rest. */
  income: number | null;
  /** Income without what the person marks as support. */
  ownIncome: number | null;
  spending: number | null;
  /** A year of spending: twelve times the month. */
  annualSpending: number | null;
  essentials: number | null;
  /**
   * What was counted as needed because nothing said otherwise: the categories with no kind that
   * were spent in, and the spending with no category, a month on average.
   */
  unsure: { categories: number; uncategorised: number | null };
  liquid: number | null;
  /** Liquid money in months of essential spending. */
  cushionMonths: number | null;
  invested: number;
  debts: Debt[];
  /** Whether the accounts were read: without them, a card or an overdraft is not known of. */
  accountsKnown: boolean;
  /** Loan principal repaid, a month on average over the window. */
  principalRepaid: number | null;
  /**
   * What was kept, in percent of income: `cash` is income less spending, `withPrincipal` adds the
   * loan principal repaid back, and `rate` is the one LOAN_PRINCIPAL_IS_SAVING picks (D6).
   */
  savings: { rate: number | null; cash: number | null; withPrincipal: number | null };
  withdrawalRatePct: number;
  /** What a year of more than enough would cost; null until the person says (D11). */
  enoughPerYear: number | null;
  freeMoney: FreeMoney | null;
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const monthOf = (date: string): string => date.slice(0, 7);

/** An entry's amount in the base currency, with the sign it was stored with. */
function baseAmount(entry: FactsEntry): number {
  if (finite(entry.amount_local)) return entry.amount_local;
  return finite(entry.amount) ? entry.amount : 0;
}

/**
 * What an entry does to the balances of the accounts it names, as local-first books it
 * (`computeBalanceDeltas` in frontend/src/core/storage/idb.ts, which a test holds this to): an
 * expense takes from its account and income adds to it, a transfer moves money from its account
 * to the other one, and income or a transfer with no account of its own adds to the other one. A
 * deduction moves nothing.
 *
 * The Worker books one case differently: a transfer from an account with no account to go to,
 * which local-first leaves out and the Worker takes from the account it names
 * (worker/src/recompute-balances.ts). Only older data holds one, as both runtimes refuse a new
 * transfer without both accounts (shared/transactionSchema.ts); for those, the read-back follows
 * local-first, so signed in it starts from a balance the Worker booked the other way.
 */
export function balanceMoves(entry: FactsEntry): Array<{ account: number; delta: number }> {
  const value = baseAmount(entry);
  const from = entry.account_id;
  const to = entry.transfer_account_id;
  if (isId(from)) {
    if (entry.type === 'transfer') {
      return isId(to)
        ? [
            { account: from, delta: -value },
            { account: to, delta: value },
          ]
        : [];
    }
    if (entry.type === 'income') return [{ account: from, delta: value }];
    if (entry.type === 'expense') return [{ account: from, delta: -value }];
    return [];
  }
  if (isId(to) && (entry.type === 'income' || entry.type === 'transfer')) {
    return [{ account: to, delta: value }];
  }
  return [];
}

/** The window: the last WINDOW_MONTHS tracked months before `today`'s month, oldest first. */
export function windowMonths(transactions: readonly FactsEntry[], today: string): string[] {
  const current = monthOf(today);
  const tracked = trackedMonthsOf(transactions.map((entry) => entry.date));
  return tracked.filter((month) => month < current).slice(-WINDOW_MONTHS);
}

interface WindowSums {
  months: number;
  income: number;
  support: number;
  spending: number;
  sorted: number;
  essentials: number;
  uncategorised: number;
  /** Categories with no kind that the window spent in. */
  noKind: Set<number>;
}

/** The window's money, added up. */
function sumWindow(
  input: Pick<GuidanceInput, 'transactions' | 'categories' | 'answers'>,
  months: readonly string[]
): WindowSums {
  const inWindow = new Set(months);
  const entries = input.transactions.filter((entry) => inWindow.has(monthOf(entry.date)));
  const amount = (entry: FactsEntry) => baseAmount(entry);
  const flows = flowsOf(entries, amount);
  const lookup = categoryLookup(input.categories);
  const support = new Set(input.answers?.supportCategoryIds ?? []);
  const verdicts = new Map<number, ReturnType<typeof essentialOf> | null>();
  const sums: WindowSums = {
    months: months.length,
    income: flows.income,
    support: 0,
    spending: flows.spending,
    sorted: 0,
    essentials: 0,
    uncategorised: 0,
    noKind: new Set(),
  };
  for (const entry of entries) {
    const id = entry.category_id;
    if (entry.type === 'income') {
      if (isId(id) && support.has(id)) sums.support += Math.abs(amount(entry));
      continue;
    }
    if (entry.type !== 'expense') continue;
    const spent = Math.abs(amount(entry));
    if (!isId(id)) {
      sums.uncategorised += spent;
      sums.essentials += spent;
      continue;
    }
    sums.sorted += spent;
    if (!verdicts.has(id)) {
      const category = lookup(id);
      verdicts.set(id, category ? essentialOf(category, lookup) : null);
    }
    const verdict = verdicts.get(id);
    // A category the profile no longer has says nothing about its kind: needed, as no kind is.
    if (!verdict || verdict.essential) sums.essentials += spent;
    if (!verdict || verdict.via === 'no-kind') sums.noKind.add(id);
  }
  return sums;
}

/**
 * The current accounts' low point: the lowest total they ended a day on in the last
 * LOW_POINT_DAYS days, today and the days before it, read back together from their balances
 * through the entries since. Each account counts from zero up on each day, so one account's
 * overdraft takes nothing from another, and a move between two of them changes neither the total
 * nor its low point. An entry dated after today is undone first: it has not happened yet.
 */
function currentAccountsLow(
  giros: readonly FactsAccount[],
  transactions: readonly FactsEntry[],
  today: string
): number {
  const ids = new Set(giros.map((account) => account.id));
  // The first of the days read: its end-of-day balance already holds its own entries.
  const first = addDays(today, -(LOW_POINT_DAYS - 1));
  const later = new Map<number, number>();
  const byDay = new Map<string, Array<{ account: number; delta: number }>>();
  for (const entry of transactions) {
    const day = entry.date.slice(0, 10);
    if (day <= first) continue;
    for (const move of balanceMoves(entry)) {
      if (!ids.has(move.account)) continue;
      if (day > today) {
        later.set(move.account, (later.get(move.account) ?? 0) + move.delta);
      } else {
        const moves = byDay.get(day);
        if (moves) moves.push(move);
        else byDay.set(day, [move]);
      }
    }
  }
  const balances = new Map(
    giros.map((account) => [account.id, account.balance - (later.get(account.id) ?? 0)])
  );
  const pooled = (): number => {
    let total = 0;
    for (const balance of balances.values()) if (balance > 0) total += balance;
    return total;
  };
  // The end of today, then the end of each day before one that moved them.
  let low = pooled();
  for (const day of [...byDay.keys()].sort().reverse()) {
    for (const move of byDay.get(day) ?? []) {
      balances.set(move.account, (balances.get(move.account) ?? 0) - move.delta);
    }
    low = Math.min(low, pooled());
  }
  return low;
}

/** The account types money can be reached in: savings, cash and current accounts. */
const LIQUID_TYPES: ReadonlySet<string> = new Set(['savings', 'cash', 'giro']);

/**
 * Liquid money: savings and cash balances, and the current accounts' low point, read as one pool
 * (`currentAccountsLow`), none of it below zero. Null when the accounts are unknown or none of them
 * is one money can be reached in.
 */
export function liquidOf(
  accounts: readonly FactsAccount[] | null,
  transactions: readonly FactsEntry[],
  today: string
): number | null {
  if (accounts === null) return null;
  const reachable = accounts.filter((account) => LIQUID_TYPES.has(storedAccountType(account.type)));
  if (reachable.length === 0) return null;
  const counted = reachable.filter((account) => finite(account.balance));
  const giros = counted.filter((account) => storedAccountType(account.type) === 'giro');
  let total = giros.length > 0 ? currentAccountsLow(giros, transactions, today) : 0;
  for (const account of counted) {
    if (storedAccountType(account.type) !== 'giro' && account.balance > 0) total += account.balance;
  }
  return total;
}

/** Liquid money in months of essential spending; with no essential spending, any money covers it. */
function cushionMonthsOf(liquid: number | null, essentials: number | null): number | null {
  if (liquid === null || essentials === null) return null;
  return essentials > 0 ? liquid / essentials : Number.POSITIVE_INFINITY;
}

/**
 * The cushion alone, for Getting started: the same window, essentials and liquid money as
 * `guidanceFacts`, without the rest.
 */
export function cushionOf(
  input: Pick<GuidanceInput, 'today' | 'transactions' | 'categories' | 'accounts'>
): Cushion {
  const months = windowMonths(input.transactions, input.today);
  const liquid = liquidOf(input.accounts, input.transactions, input.today);
  if (months.length < MIN_MONTHS_FOR_AVERAGES) return { liquid, essentials: null, months: null };
  const essentials = sumWindow(input, months).essentials / months.length;
  return { liquid, essentials, months: cushionMonthsOf(liquid, essentials) };
}

/**
 * Invested money: the investment accounts' balances or the portfolio, whichever holds more, and
 * the savings held elsewhere. The app cannot tell which holdings an investment account's balance
 * already counts, so it never adds the two: counting both could place someone a circle further
 * out than their money is.
 */
export function investedOf(
  accounts: readonly FactsAccount[] | null,
  holdings: number | null | undefined,
  savedElsewhere: number | null | undefined
): number {
  let accountsHold = 0;
  for (const account of accounts ?? []) {
    if (
      storedAccountType(account.type) === 'ib' &&
      finite(account.balance) &&
      account.balance > 0
    ) {
      accountsHold += account.balance;
    }
  }
  const portfolio = finite(holdings) && holdings > 0 ? holdings : 0;
  const elsewhere = finite(savedElsewhere) && savedElsewhere > 0 ? savedElsewhere : 0;
  return Math.max(accountsHold, portfolio) + elsewhere;
}

/** The full months before `today`'s month, the latest first. */
function fullMonthsBefore(today: string, count: number): string[] {
  const first = `${monthOf(today)}-01`;
  return Array.from({ length: count }, (_, i) => monthOf(addCalendarMonths(first, -(i + 1))));
}

/** What went into a card on average over the last CARD_PAYMENT_MONTHS full months, or null. */
function cardPayment(
  id: number,
  transactions: readonly FactsEntry[],
  today: string
): number | null {
  const months = new Set(fullMonthsBefore(today, CARD_PAYMENT_MONTHS));
  let paid = 0;
  for (const entry of transactions) {
    if (entry.type !== 'transfer' || !months.has(monthOf(entry.date))) continue;
    for (const move of balanceMoves(entry)) {
      if (move.account === id && move.delta > 0) paid += move.delta;
    }
  }
  return paid > 0 ? paid / CARD_PAYMENT_MONTHS : null;
}

/** Whether a debt at `rate` is expensive: a loan from the line up, a card or overdraft unless set below it. */
export function isExpensive(kind: Debt['kind'], rate: number | null): boolean {
  if (kind === 'loan') return rate !== null && rate >= EXPENSIVE_DEBT_RATE;
  return rate === null || rate >= EXPENSIVE_DEBT_RATE;
}

/**
 * The debts: each loan with a balance left on `today`, at the rate its schedule charges for the
 * next payment, and each credit card and current account below zero, unless the person said they
 * carry no balance on either.
 */
export function debtsOf(
  input: Pick<GuidanceInput, 'today' | 'transactions' | 'accounts' | 'loans' | 'answers'>
): Debt[] {
  const debts: Debt[] = [];
  for (const loan of input.loans ?? []) {
    const status = loanStatus(loan, input.today);
    if (!(status.remaining_balance > 0)) continue;
    const month = nextPaymentMonth(loan, input.today) ?? 1;
    const rate = rateStretches(loan, month)[0]?.rate ?? 0;
    debts.push({
      kind: 'loan',
      id: isId(loan.id) ? loan.id : null,
      name: loan.name ?? null,
      owed: status.remaining_balance,
      rate,
      payment: status.monthly_payment > 0 ? status.monthly_payment : null,
      expensive: isExpensive('loan', rate),
    });
  }
  if (input.answers?.carriesCardBalance === false) return debts;
  for (const account of input.accounts ?? []) {
    const type = storedAccountType(account.type);
    if ((type !== 'credit' && type !== 'giro') || !(account.balance < 0)) continue;
    const kind = type === 'credit' ? 'card' : 'overdraft';
    const rate = finite(account.credit_rate) ? account.credit_rate : null;
    debts.push({
      kind,
      id: account.id,
      name: account.name ?? null,
      owed: -account.balance,
      rate,
      payment: kind === 'card' ? cardPayment(account.id, input.transactions, input.today) : null,
      expensive: isExpensive(kind, rate),
    });
  }
  return debts;
}

/** Loan principal repaid in the window's months: the installments' principal and extra payments. */
function principalIn(loans: readonly FactsLoan[], months: readonly string[]): number {
  const inWindow = new Set(months);
  let repaid = 0;
  for (const loan of loans) {
    for (const row of amortize(loan)) {
      if (inWindow.has(monthOf(row.date))) repaid += row.principal + row.prepayment;
    }
  }
  return repaid;
}

const percentOf = (part: number, whole: number): number | null =>
  whole > 0 ? (part / whole) * 100 : null;

/** Everything the circles read, from what the app holds. */
export function guidanceFacts(input: GuidanceInput): GuidanceFacts {
  const { today } = input;
  const months = windowMonths(input.transactions, today);
  const monthsInYear = trackedMonthsInYearWindow(
    trackedMonthsOf(input.transactions.map((entry) => entry.date)),
    today
  );
  const averaged = months.length >= MIN_MONTHS_FOR_AVERAGES;
  const sums = sumWindow(input, months);
  const perMonth = (total: number): number | null => (averaged ? total / months.length : null);
  const income = perMonth(sums.income);
  const spending = perMonth(sums.spending);
  const essentials = perMonth(sums.essentials);
  const liquid = liquidOf(input.accounts, input.transactions, today);
  const principalRepaid = perMonth(principalIn(input.loans ?? [], months));
  const kept = income !== null && spending !== null ? income - spending : null;
  const cash = kept === null || income === null ? null : percentOf(kept, income);
  const withPrincipal =
    kept === null || income === null || principalRepaid === null
      ? null
      : percentOf(kept + principalRepaid, income);
  const swr = input.withdrawalRatePct;
  const enough = input.answers?.enoughPerYear;
  return {
    today,
    region: input.region,
    months,
    monthsInYear,
    firm: monthsInYear >= YEAR_ON_FILE_MONTHS,
    averaged,
    sortedShare: sums.spending > 0 ? (sums.sorted / sums.spending) * 100 : null,
    income,
    ownIncome: perMonth(sums.income - sums.support),
    spending,
    annualSpending: spending === null ? null : spending * 12,
    essentials,
    unsure: { categories: sums.noKind.size, uncategorised: perMonth(sums.uncategorised) },
    liquid,
    cushionMonths: cushionMonthsOf(liquid, essentials),
    invested: investedOf(input.accounts, input.holdings, input.answers?.savedElsewhere),
    debts: debtsOf(input),
    accountsKnown: input.accounts !== null,
    principalRepaid,
    savings: {
      rate: LOAN_PRINCIPAL_IS_SAVING ? withPrincipal : cash,
      cash,
      withPrincipal,
    },
    withdrawalRatePct: finite(swr) && swr > 0 ? swr : DEFAULT_SETTINGS.safeWithdrawalRatePct,
    enoughPerYear: finite(enough) && enough > 0 ? enough : null,
    freeMoney: input.answers?.freeMoney ?? null,
  };
}
