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
 *   average over the window, in the base currency. An expense filed under a category that holds
 *   transfers (kinds.ts `holdsTransfers`) is money moved, not spent, and counts nowhere here: not
 *   as spending, not as needed (guidance.md 3.1, "transfers excluded"). **Own income** leaves out
 *   the categories the person marks as support they expect to stop.
 * - **Essential spending** is spending in the categories needed every month (kinds.ts
 *   `essentialOf`: the person's choice, else the kind, else needed). Spending with no category
 *   counts as needed too: like a category with no kind, it errs towards a larger cushion, and
 *   `unsure` says how much was counted that way. When all of it was, the needed spending is what
 *   is spent, and the cushion says so (`Cushion.against`; guidance.md 3.1, "all spending, labelled
 *   as such").
 * - **Balances** are read as they stand today (`accountsToday`): the stored balance holds every
 *   entry, those dated after today included, so what those moved is taken back out. Every account
 *   below is read that way.
 * - **Liquid money**, the money a person can reach: savings and cash at their balance today, and
 *   the lowest total the current accounts ended a day on in the last 30 days, read back together
 *   as one pool from their balances today through the entries since (guidance.md 3.1, "the lowest
 *   current-account balance"). So a move between two current accounts hides nothing. None of it
 *   counts below zero, and one account's overdraft takes nothing from another.
 * - **Invested** (`investedOf`): investment accounts or the portfolio, whichever holds more, and
 *   savings the person says are held elsewhere.
 * - **Debts** (`debtsOf`, design section 5): loans with a balance left, at the rate charged now,
 *   and credit cards and current accounts below zero whose balance is carried (guidance.md 3.1, "a
 *   carried card or overdraft balance"). A card cleared each month carries none (`cardCarried`).
 *
 * Pure, with no I/O: the caller passes what it read.
 */
import { storedAccountType } from '../accountSchema';
import { addCalendarMonths, addDays } from '../calendarMonths';
import { amortize, loanStatus, rateStretches } from '../loanSchedule';
import { nextPaymentMonth } from '../loanScenarios';
import { DEFAULT_SETTINGS, MIN_MONTHS_FOR_AVERAGES } from '../retirementSettings';
import { trackedMonthsInYearWindow, trackedMonthsOf, YEAR_ON_FILE_MONTHS } from '../trackedMonths';
import { CLEAR_PICTURE_MONTHS } from './circles';
import { flowsOf } from './flows';
import { categoryLookup, essentialOf, holdsTransfers } from './kinds';
import type { LoanInput } from '../loanSchedule';
import type { FreeMoneyAnswer } from './answers';
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

/**
 * The full months a card's payment is averaged over: the transfers into it. A card whose payment
 * covers what it owes is cleared each month, and carries no balance (`cardCarried`).
 */
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
  /**
   * The stored balance, in the base currency: the starting balance and every entry, those dated
   * after today included. The facts read it as it stands today (`accountsToday`). Money owed is
   * below zero.
   */
  balance: number;
  name?: string | null;
  /** A credit card's or an overdraft's yearly rate, in percent; null for none given. */
  credit_rate?: number | null;
}

/** A bill or subscription as Bills holds it: what the yearly-bills check reads. */
export interface FactsBill {
  /** What one payment costs, in the base currency. */
  amount: number;
  /** weekly, biweekly, monthly or yearly; blank reads as monthly, as Bills does. */
  frequency?: string | null;
  /** 0 or false when paused; absent reads as active, as Bills does. */
  is_active?: number | boolean | null;
}

/** The yearly entries on Bills, active ones of both types: what setting money aside covers. */
export interface YearlyBills {
  count: number;
  /** Their amounts added up: a year of them. */
  perYear: number;
  /** A year of them over 12: what to set aside each month. */
  perMonth: number;
}

/** A loan as Loans holds it, with its rate periods and extra payments. */
export interface FactsLoan extends LoanInput {
  id?: number | null;
  name?: string | null;
}

/**
 * The answer to the free-money question (guidance.md 5.5): taken in full, in part (the US match,
 * "some of it"), not taken, none on offer, or not sure. The answers record lists them
 * (answers.ts `FREE_MONEY_ANSWERS`).
 */
export type FreeMoney = FreeMoneyAnswer;

/**
 * The questions the circles ask once, each when it is first needed (guidance.md 5.5). Absent or
 * null is not answered yet. The app reads them from the answers record (answers.ts
 * `factsAnswersOf`), each only while it still applies.
 */
export interface FactsAnswers {
  /** Categories whose income is support the person expects to stop (circle 2). */
  supportCategoryIds?: readonly number[] | null;
  /**
   * "Do you carry a balance on a credit card or overdraft?" No leaves both out of the debts; yes
   * counts every card below zero as carried. Either beats what a card's entries suggest.
   */
  carriesCardBalance?: boolean | null;
  /** Whether the employer's or the state's free money is taken (circle 4). */
  freeMoney?: FreeMoney | null;
  /** Pension and investment savings held outside the app, in the base currency (circle 5). */
  savedElsewhere?: number | null;
  /** What a year of more than enough would cost, in the base currency (circle 7). */
  enoughPerYear?: number | null;
  /** "Do you set this aside each month?", about the yearly bills on Bills (circle 4). */
  setsAsideYearly?: boolean | null;
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
  /** The profile's entries on Bills, bills and subscriptions both. */
  bills?: readonly FactsBill[];
}

/** A debt the person carries. */
export interface Debt {
  /** A loan on Loans, a credit card, or a current account below zero. */
  kind: 'loan' | 'card' | 'overdraft';
  /** The loan's or the account's id; null when the row gives none. */
  id: number | null;
  name: string | null;
  /** Still owed today, above zero. */
  owed: number;
  /** The yearly rate charged now, in percent; null for a card or overdraft with none given. */
  rate: number | null;
  /**
   * A month's payment: a loan's next installment, or what went into a card on average over the
   * last CARD_PAYMENT_MONTHS full months. Null when nothing says.
   */
  payment: number | null;
  /**
   * The balance is carried from month to month: a loan's and an overdraft's always, a card's as its
   * entries show (`cardCarried`) or as the person says. Null for a card whose entries are too few
   * to say and the person has not said.
   */
  carried: boolean | null;
  /**
   * At EXPENSIVE_DEBT_RATE or more; a card or overdraft unless its rate is set below it. Null for a
   * card not known to be carried, unless its rate is below the line, which it is either way.
   */
  expensive: boolean | null;
  /**
   * A card's or an overdraft's first entry on file, YYYY-MM-DD: how long its entries have had to
   * show whether its balance is carried. Null with none, and for a loan. Absent reads as null.
   */
  since?: string | null;
}

/** The money a person can reach against a month of what they need. */
export interface Cushion {
  /** Liquid money today; null when no account it could be in is on file. */
  liquid: number | null;
  /** Essential spending, a month on average; null with too few months. */
  essentials: number | null;
  /** Liquid money in months of essential spending; null when either is unknown. */
  months: number | null;
  /**
   * What `months` is in: months of what is needed, or of what is spent when everything counted as
   * needed was counted only because nothing said otherwise (`unsure.all`).
   */
  against: 'needs' | 'spending';
}

export interface GuidanceFacts {
  today: string;
  region: Region;
  /** The window's tracked months, oldest first. */
  months: string[];
  /** Tracked months in the year window that ends this month: a year is on file at twelve. */
  monthsInYear: number;
  /**
   * The months the first circle needs are on file (D10, CLEAR_PICTURE_MONTHS in circles.ts). Until
   * then whatever comes from the averages may still move.
   */
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
   * were spent in, and the spending with no category, a month on average. `all` when that is
   * everything counted as needed, so the needed spending is only what is spent; false with none,
   * and with too few months.
   */
  unsure: { categories: number; uncategorised: number | null; all: boolean };
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
  /** The yearly entries on Bills; null with none. Absent reads as none. */
  yearlyBills?: YearlyBills | null;
  /** Whether the person sets the yearly bills aside each month; null until they say. */
  setsAsideYearly?: boolean | null;
  /** Money in reach by where it is; null as `liquid` is. Absent reads as not broken down. */
  liquidParts?: LiquidParts | null;
  /**
   * The categories the window took in or spent in, a month on average, the most first: what the
   * circle views list for the support and essentials questions. Empty with too few months.
   */
  windowCategories?: WindowCategory[];
  /** Expenses in the window with no category. */
  uncategorisedEntries?: number;
  /**
   * Credit cards and current accounts below zero today, whatever the card answer says (`debts`
   * leaves them out after a "No"): circle 4's view asks the card question while there is one.
   */
  belowZero?: number;
}

/** A category the window took in or spent in. */
export interface WindowCategory {
  id: number;
  name: string;
  type: 'income' | 'expense';
  /** A month on average over the window. */
  perMonth: number;
  /** Expenses only: whether it counts as needed every month, and why (`essentialOf`). */
  essential: boolean;
  via: 'chosen' | 'kind' | 'no-kind' | null;
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
  /** Of `essentials`, what was counted as needed only because nothing said otherwise. */
  unsureSpent: number;
  /** What each category took in or spent over the window. */
  byCategory: Map<number, number>;
  /** Expenses with no category, counted. */
  uncategorisedEntries: number;
}

/** The window's money, added up, without the expenses that only moved money (`holdsTransfers`). */
function sumWindow(
  input: Pick<GuidanceInput, 'transactions' | 'categories' | 'answers'>,
  months: readonly string[]
): WindowSums {
  const inWindow = new Set(months);
  const lookup = categoryLookup(input.categories);
  const held = new Map<number, boolean>();
  const moved = (entry: FactsEntry): boolean => {
    const id = entry.category_id;
    if (entry.type !== 'expense' || !isId(id)) return false;
    let holds = held.get(id);
    if (holds === undefined) {
      holds = holdsTransfers(lookup(id), lookup);
      held.set(id, holds);
    }
    return holds;
  };
  const entries = input.transactions.filter(
    (entry) => inWindow.has(monthOf(entry.date)) && !moved(entry)
  );
  const amount = (entry: FactsEntry) => baseAmount(entry);
  const flows = flowsOf(entries, amount);
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
    unsureSpent: 0,
    byCategory: new Map(),
    uncategorisedEntries: 0,
  };
  const add = (id: number, value: number) => {
    sums.byCategory.set(id, (sums.byCategory.get(id) ?? 0) + value);
  };
  for (const entry of entries) {
    const id = entry.category_id;
    if (entry.type === 'income') {
      if (isId(id)) add(id, Math.abs(amount(entry)));
      if (isId(id) && support.has(id)) sums.support += Math.abs(amount(entry));
      continue;
    }
    if (entry.type !== 'expense') continue;
    const spent = Math.abs(amount(entry));
    if (!isId(id)) {
      sums.uncategorisedEntries += 1;
      sums.uncategorised += spent;
      sums.essentials += spent;
      sums.unsureSpent += spent;
      continue;
    }
    sums.sorted += spent;
    add(id, spent);
    if (!verdicts.has(id)) {
      const category = lookup(id);
      verdicts.set(id, category ? essentialOf(category, lookup) : null);
    }
    const verdict = verdicts.get(id);
    // A category the profile no longer has says nothing about its kind: needed, as no kind is.
    if (!verdict || verdict.essential) sums.essentials += spent;
    if (!verdict || verdict.via === 'no-kind') {
      sums.noKind.add(id);
      sums.unsureSpent += spent;
    }
  }
  return sums;
}

/** Whether all the window counted as needed was counted so only because nothing said otherwise. */
function neededIsUnsure(sums: WindowSums): boolean {
  return sums.essentials > 0 && sums.unsureSpent >= sums.essentials;
}

/**
 * The accounts as they stand at the end of today. A stored balance is the starting balance and
 * every entry, those dated after today included, as both runtimes book an entry when it is saved;
 * what the entries dated after today moved is taken back out, as it has not happened yet. Every
 * balance the facts read goes through here: savings, cash, current accounts, cards and
 * investment accounts alike.
 */
function accountsToday(
  accounts: readonly FactsAccount[],
  transactions: readonly FactsEntry[],
  today: string
): FactsAccount[] {
  const later = new Map<number, number>();
  for (const entry of transactions) {
    if (entry.date.slice(0, 10) <= today) continue;
    for (const move of balanceMoves(entry)) {
      later.set(move.account, (later.get(move.account) ?? 0) + move.delta);
    }
  }
  return accounts.map((account) => {
    const moved = later.get(account.id);
    return moved === undefined ? account : { ...account, balance: account.balance - moved };
  });
}

/**
 * The current accounts' low point: the lowest total they ended a day on in the last
 * LOW_POINT_DAYS days, today and the days before it, read back together from their balances
 * today (`accountsToday`) through the entries since. Each account counts from zero up on each
 * day, so one account's overdraft takes nothing from another, and a move between two of them
 * changes neither the total nor its low point.
 */
function currentAccountsLow(
  giros: readonly FactsAccount[],
  transactions: readonly FactsEntry[],
  today: string
): number {
  const ids = new Set(giros.map((account) => account.id));
  // The first of the days read: its end-of-day balance already holds its own entries.
  const first = addDays(today, -(LOW_POINT_DAYS - 1));
  const byDay = new Map<string, Array<{ account: number; delta: number }>>();
  for (const entry of transactions) {
    const day = entry.date.slice(0, 10);
    if (day <= first || day > today) continue;
    for (const move of balanceMoves(entry)) {
      if (!ids.has(move.account)) continue;
      const moves = byDay.get(day);
      if (moves) moves.push(move);
      else byDay.set(day, [move]);
    }
  }
  const balances = new Map(giros.map((account) => [account.id, account.balance]));
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

/** Money in reach, by where it is: what `liquidOf` adds up. */
export interface LiquidParts {
  /** Savings accounts at their balance today. */
  savings: number;
  /** The current accounts' low point over the last LOW_POINT_DAYS days. */
  current: number;
  /** Cash at its balance today. */
  cash: number;
}

/**
 * Liquid money by where it is (`liquidOf`): savings and cash at their balance today, and the
 * current accounts' low point, read as one pool (`currentAccountsLow`), none of it below zero.
 * Null when the accounts are unknown or none of them is one money can be reached in.
 */
export function liquidPartsOf(
  accounts: readonly FactsAccount[] | null,
  transactions: readonly FactsEntry[],
  today: string
): LiquidParts | null {
  if (accounts === null) return null;
  const reachable = accounts.filter((account) => LIQUID_TYPES.has(storedAccountType(account.type)));
  if (reachable.length === 0) return null;
  const counted = accountsToday(reachable, transactions, today).filter((account) =>
    finite(account.balance)
  );
  const giros = counted.filter((account) => storedAccountType(account.type) === 'giro');
  const parts: LiquidParts = {
    savings: 0,
    current: giros.length > 0 ? currentAccountsLow(giros, transactions, today) : 0,
    cash: 0,
  };
  for (const account of counted) {
    const type = storedAccountType(account.type);
    if (type === 'giro' || account.balance <= 0) continue;
    if (type === 'cash') parts.cash += account.balance;
    else parts.savings += account.balance;
  }
  return parts;
}

/**
 * Liquid money: savings and cash at their balance today, and the current accounts' low point,
 * read as one pool (`currentAccountsLow`), none of it below zero. Null when the accounts are
 * unknown or none of them is one money can be reached in.
 */
export function liquidOf(
  accounts: readonly FactsAccount[] | null,
  transactions: readonly FactsEntry[],
  today: string
): number | null {
  const parts = liquidPartsOf(accounts, transactions, today);
  return parts === null ? null : parts.savings + parts.current + parts.cash;
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
  if (months.length < MIN_MONTHS_FOR_AVERAGES) {
    return { liquid, essentials: null, months: null, against: 'needs' };
  }
  const sums = sumWindow(input, months);
  const essentials = sums.essentials / months.length;
  return {
    liquid,
    essentials,
    months: cushionMonthsOf(liquid, essentials),
    against: neededIsUnsure(sums) ? 'spending' : 'needs',
  };
}

/**
 * Invested money: the investment accounts' balances or the portfolio, whichever holds more, and
 * the savings held elsewhere. The app cannot tell which holdings an investment account's balance
 * already counts, so it never adds the two: counting both could place someone a circle further
 * out than their money is. The balances are taken as given: `guidanceFacts` passes them as they
 * stand today (`accountsToday`).
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

/**
 * Whether a card's balance is carried, as its entries show. Not when what went into it, a month on
 * average over the last CARD_PAYMENT_MONTHS full months, covers what it owes today: it is cleared
 * each month. Carried when its entries go back to the first of those months and that does not
 * cover it. Null when they do not go back that far: too little history to say.
 */
function cardCarried(
  id: number,
  owed: number,
  payment: number | null,
  transactions: readonly FactsEntry[],
  today: string
): boolean | null {
  if (payment !== null && payment >= owed) return false;
  const first = `${fullMonthsBefore(today, CARD_PAYMENT_MONTHS)[CARD_PAYMENT_MONTHS - 1]}-01`;
  const since = transactions.some(
    (entry) =>
      entry.date.slice(0, 10) <= first && balanceMoves(entry).some((move) => move.account === id)
  );
  return since ? true : null;
}

/** The first entry that moves account `id`, YYYY-MM-DD, or null with none. */
function firstEntryOn(id: number, transactions: readonly FactsEntry[]): string | null {
  let first: string | null = null;
  for (const entry of transactions) {
    const date = entry.date.slice(0, 10);
    if (first !== null && date >= first) continue;
    if (balanceMoves(entry).some((move) => move.account === id)) first = date;
  }
  return first;
}

/** Whether a debt at `rate` is expensive: a loan from the line up, a card or overdraft unless set below it. */
export function isExpensive(kind: Debt['kind'], rate: number | null): boolean {
  if (kind === 'loan') return rate !== null && rate >= EXPENSIVE_DEBT_RATE;
  return rate === null || rate >= EXPENSIVE_DEBT_RATE;
}

/**
 * The debts: each loan with a balance left on `today`, at the rate its schedule charges for the
 * next payment, and each credit card and current account below zero, unless the person said they
 * carry no balance on either. A card cleared each month is left out (`cardCarried`), unless the
 * person said they carry a balance.
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
      carried: true,
      expensive: isExpensive('loan', rate),
    });
  }
  const answer = input.answers?.carriesCardBalance;
  if (answer === false) return debts;
  for (const account of accountsToday(input.accounts ?? [], input.transactions, input.today)) {
    const type = storedAccountType(account.type);
    if ((type !== 'credit' && type !== 'giro') || !(account.balance < 0)) continue;
    const kind = type === 'credit' ? 'card' : 'overdraft';
    const owed = -account.balance;
    const rate = finite(account.credit_rate) ? account.credit_rate : null;
    const payment =
      kind === 'card' ? cardPayment(account.id, input.transactions, input.today) : null;
    const carried =
      kind === 'card' && answer !== true
        ? cardCarried(account.id, owed, payment, input.transactions, input.today)
        : true;
    if (carried === false) continue;
    debts.push({
      kind,
      id: account.id,
      name: account.name ?? null,
      owed,
      rate,
      payment,
      carried,
      expensive: !isExpensive(kind, rate) ? false : carried ? true : null,
      since: firstEntryOn(account.id, input.transactions),
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
  const accountsNow =
    input.accounts === null ? null : accountsToday(input.accounts, input.transactions, today);
  return {
    today,
    region: input.region,
    months,
    monthsInYear,
    firm: monthsInYear >= CLEAR_PICTURE_MONTHS,
    averaged,
    sortedShare: sums.spending > 0 ? (sums.sorted / sums.spending) * 100 : null,
    income,
    ownIncome: perMonth(sums.income - sums.support),
    spending,
    annualSpending: spending === null ? null : spending * 12,
    essentials,
    unsure: {
      categories: sums.noKind.size,
      uncategorised: perMonth(sums.uncategorised),
      all: averaged && neededIsUnsure(sums),
    },
    liquid,
    cushionMonths: cushionMonthsOf(liquid, essentials),
    invested: investedOf(accountsNow, input.holdings, input.answers?.savedElsewhere),
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
    yearlyBills: yearlyBillsOf(input.bills ?? []),
    setsAsideYearly: input.answers?.setsAsideYearly ?? null,
    liquidParts: liquidPartsOf(input.accounts, input.transactions, today),
    windowCategories: averaged ? windowCategoriesOf(input.categories, sums, months.length) : [],
    uncategorisedEntries: sums.uncategorisedEntries,
    belowZero: belowZeroOf(accountsNow),
  };
}

/** Credit cards and current accounts below zero, as `accountsToday` gives them. */
function belowZeroOf(accounts: readonly FactsAccount[] | null): number {
  let count = 0;
  for (const account of accounts ?? []) {
    const type = storedAccountType(account.type);
    if ((type === 'credit' || type === 'giro') && account.balance < 0) count += 1;
  }
  return count;
}

/** The window's categories with what each took in or spent a month, the most first. */
function windowCategoriesOf(
  categories: readonly KindedCategory[],
  sums: WindowSums,
  months: number
): WindowCategory[] {
  const lookup = categoryLookup(categories);
  const out: WindowCategory[] = [];
  for (const [id, total] of sums.byCategory) {
    const category = lookup(id);
    if (!category || total <= 0) continue;
    const income = category.type === 'income';
    const verdict = income ? null : essentialOf(category, lookup);
    out.push({
      id,
      name: typeof category.name === 'string' ? category.name : '',
      type: income ? 'income' : 'expense',
      perMonth: total / months,
      essential: verdict?.essential ?? false,
      via: verdict?.via ?? null,
    });
  }
  return out.sort((a, b) => b.perMonth - a.perMonth);
}

/**
 * The active entries on Bills that come once a year, bills and subscriptions both (a yearly
 * subscription needs setting aside as much as a yearly bill): how many, a year of them, and that
 * over 12. Null with none.
 */
export function yearlyBillsOf(bills: readonly FactsBill[]): YearlyBills | null {
  const yearly = bills.filter(
    (bill) =>
      bill.frequency === 'yearly' &&
      bill.is_active !== 0 &&
      bill.is_active !== false &&
      finite(bill.amount) &&
      bill.amount > 0
  );
  if (yearly.length === 0) return null;
  const perYear = yearly.reduce((sum, bill) => sum + bill.amount, 0);
  return { count: yearly.length, perYear, perMonth: perYear / 12 };
}
