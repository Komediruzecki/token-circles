/**
 * One circle, opened (design.md 1.8, circles part 2): what it checks, in the method's order, and the
 * person's numbers behind them. Pure, with the money formatter passed in, as the ledger's is.
 *
 * A check is met, not yet met, or not known yet; one not known says what it waits on. The words
 * use the person's own numbers only, rounded as the ledger rounds them (ledger.ts): a check not
 * met never reads as met.
 */
import { DAYS_IN_A_MONTH, monthName } from '../orientation';
import { targetFromSpend } from '../retirement';
import { TRACKED_MONTH_MIN_TRANSACTIONS, YEAR_WINDOW_MONTHS } from '../trackedMonths';
import {
  CIRCLE_NAMES,
  FULL_CUSHION_MONTHS,
  ROOM_TO_CHOOSE_YEARS,
  SOLID_CUSHION_MONTHS,
  SORTED_SHARE,
} from './circles';
import { debtName, gapOf, monthsText, rateText, shareOf } from './ledger';
import { freeMoneyQuestion } from './questions';
import type { FreeMoneyAnswer } from './answers';
import type { Check, CheckId, CircleNumber, CirclePlace } from './circles';
import type { Debt, GuidanceFacts } from './facts';
import type { LedgerWords } from './ledger';

export type CheckState = 'met' | 'not-yet' | 'not-known';

export const CHECK_STATES: Readonly<Record<CheckState, string>> = {
  met: 'Met',
  'not-yet': 'Not yet',
  'not-known': 'Not known yet',
};

/** One check, as the circle view lists it. */
export interface CheckRow {
  id: CheckId;
  title: string;
  /** The person's numbers behind it; null where there are none to show. */
  detail: string | null;
  state: CheckState;
  /** For a check not known: what it waits on. */
  waiting: string | null;
  /** "Needed to reach {name}" for a required check. */
  needed: string | null;
}

export const WAITING_ON_ANSWER = 'Waiting on your answer';
export const WAITING_ON_ACCOUNTS = "Your accounts didn't load";
export const WAITING_ON_MONTHS = 'Known once 3 months are tracked';
export const WAITING_ON_WORK_OPTIONAL = 'Asked once you reach Work optional';
const NO_ACCOUNT = 'None of your accounts is a savings, cash or current account yet.';

/** The checks that wait on an answer, not on the person's data, while they are not known. */
const ASKED: ReadonlySet<CheckId> = new Set([
  'free-money',
  'no-expensive-debt',
  'yearly-bills',
  'enough',
]);

const stateOf = (check: Check): CheckState =>
  check.met === true ? 'met' : check.met === false ? 'not-yet' : 'not-known';

/**
 * How many of its checks a circle needs: "It needs 2 of these, and 3 more are optional.", or,
 * when it needs them all, "It needs this one." and "It needs both of these."
 */
export function checksLine(place: CirclePlace): string {
  const required = place.checks.filter((check) => check.required).length;
  const optional = place.checks.length - required;
  if (optional === 0) {
    if (required === 1) return 'It needs this one.';
    return required === 2 ? 'It needs both of these.' : `It needs all ${required} of these.`;
  }
  return `It needs ${required} of these, and ${optional} more ${optional === 1 ? 'is' : 'are'} optional.`;
}

/** "August 2026" for "2026-08". */
const monthYear = (month: string): string => `${monthName(month)} ${month.slice(0, 4)}`;

/** How a free-money answer reads back, in the words of its chip. */
function freeMoneyAnswerText(region: string, answer: FreeMoneyAnswer): string | null {
  const option = freeMoneyQuestion(region)?.options.find((one) => one.answer === answer);
  return option ? `Your answer: ${option.label}.` : null;
}

function debtDetail(facts: GuidanceFacts, check: Check, words: LedgerWords): string | null {
  if (check.unknown === 'unread') return null;
  const owed = (debt: Debt) => words.money(Math.round(debt.owed));
  if (check.met === false) {
    const debt = facts.debts.find((one) => one.expensive === true);
    if (!debt) return null;
    return debt.rate === null
      ? `${debtName(debt)} has no rate set, ${owed(debt)} owed.`
      : `${debtName(debt)} at ${rateText(debt.rate)}%, ${owed(debt)} owed.`;
  }
  if (check.met === null) {
    const card = facts.debts.find((one) => one.expensive === null);
    if (!card) return null;
    return card.since
      ? `${debtName(card)} has been here since ${monthYear(card.since.slice(0, 7))}, too short to show whether you carry its ${owed(card)}.`
      : `${debtName(card)} has too few entries to show whether you carry its ${owed(card)}.`;
  }
  if (facts.debts.length === 0) return 'No loans or cards on file.';
  return 'Your loans and cards are under 10% a year, or carry nothing.';
}

/**
 * What a check not known waits on: the accounts read again, an answer (the circle with the
 * own-number question asks it only once it is the current one), or three tracked months.
 */
function waitingOn(
  check: Check,
  facts: GuidanceFacts,
  current: CircleNumber | null
): string | null {
  if (stateOf(check) !== 'not-known') return null;
  if (check.unknown === 'unread') return WAITING_ON_ACCOUNTS;
  if (check.id === 'enough' && current !== 7) return WAITING_ON_WORK_OPTIONAL;
  if (ASKED.has(check.id)) return WAITING_ON_ANSWER;
  return facts.averaged ? null : WAITING_ON_MONTHS;
}

/** The words for one check. */
function rowFor(
  check: Check,
  facts: GuidanceFacts,
  words: LedgerWords,
  current: CircleNumber | null
): CheckRow {
  const state = stateOf(check);
  const base = {
    id: check.id,
    state,
    waiting: waitingOn(check, facts, current),
    needed: null as string | null,
  };
  const money = (amount: number) => words.money(Math.round(amount));
  /**
   * Two figures that read the same beside Not yet ("€2,000 in, €2,000 out") say nothing about
   * why: the row says the gap instead, which is never €0.
   */
  const readTheSame = (a: number, b: number) => check.met === false && money(a) === money(b);
  const gap = (target: number, value: number) => words.money(gapOf(target, value));
  const essentials = facts.essentials;
  const liquid = facts.liquid;
  switch (check.id) {
    case 'year-on-file': {
      const n = Math.min(facts.monthsInYear, 12);
      const counts = `A month counts once it holds ${TRACKED_MONTH_MIN_TRANSACTIONS} entries.`;
      const window = `the last ${YEAR_WINDOW_MONTHS} months`;
      return {
        ...base,
        title: 'A year on file',
        detail:
          n === 0
            ? `None of ${window} is tracked yet. ${counts}`
            : `${n} of ${window} ${n === 1 ? 'is' : 'are'} tracked. ${counts}`,
      };
    }
    case 'sorted':
      return {
        ...base,
        title: 'Spending sorted',
        detail:
          facts.sortedShare === null
            ? null
            : `${shareOf(facts.sortedShare, 100, check.met === true)}% of your spending has a category; ${SORTED_SHARE}% is needed.`,
      };
    case 'own-income':
      return {
        ...base,
        title: 'Own income covers spending',
        detail:
          check.via === 'work-optional'
            ? 'Your investments could cover what you spend, which counts as paying your way.'
            : facts.income === null || facts.spending === null
              ? null
              : readTheSame(facts.ownIncome ?? facts.income, facts.spending)
                ? `${gap(facts.spending, facts.ownIncome ?? facts.income)} a month short of covering what you spend.`
                : `${money(facts.ownIncome ?? facts.income)} in, ${money(facts.spending)} out a month.`,
      };
    case 'first-cushion': {
      let detail: string | null = null;
      if (facts.cushionMonths === Number.POSITIVE_INFINITY) {
        detail = 'Nothing is marked as needed every month.';
      } else if (facts.cushionMonths !== null && liquid !== null && essentials !== null) {
        const days = Math.floor(facts.cushionMonths * DAYS_IN_A_MONTH);
        const counted = `${days} ${days === 1 ? 'day' : 'days'}`;
        detail = readTheSame(liquid, essentials)
          ? `${counted}: ${gap(essentials, liquid)} to a month of essentials.`
          : `${counted}: ${money(liquid)} you can reach, against ${money(essentials)} needed a month.`;
      } else if (facts.accountsKnown && liquid === null) {
        detail = NO_ACCOUNT;
      }
      return { ...base, title: 'A month of essentials', detail };
    }
    case 'free-money': {
      const question = freeMoneyQuestion(facts.region);
      return {
        ...base,
        title: question?.check ?? 'Free money',
        detail:
          facts.freeMoney === null ? null : freeMoneyAnswerText(facts.region, facts.freeMoney),
      };
    }
    case 'no-expensive-debt':
      return {
        ...base,
        title: 'No debt at 10% or more',
        detail: debtDetail(facts, check, words),
      };
    case 'yearly-bills': {
      const bills = facts.yearlyBills;
      return {
        ...base,
        title: 'Yearly bills set aside',
        detail: !bills
          ? null
          : bills.count === 1
            ? `One yearly bill on Bills comes to ${money(bills.perYear)} a year: about ${words.money(Math.ceil(bills.perMonth))} a month.`
            : `${bills.count} yearly bills on Bills come to ${money(bills.perYear)} a year: about ${words.money(Math.ceil(bills.perMonth))} a month.`,
      };
    }
    case 'solid-cushion':
    case 'full-cushion': {
      const solid = check.id === 'solid-cushion';
      const target = solid ? SOLID_CUSHION_MONTHS : FULL_CUSHION_MONTHS;
      let detail: string | null = null;
      if (facts.cushionMonths === Number.POSITIVE_INFINITY) {
        detail = 'Nothing is marked as needed every month.';
      } else if (facts.cushionMonths !== null && liquid !== null && essentials !== null) {
        const gap = money(gapOf(target * essentials, liquid));
        const months = monthsText(facts.cushionMonths);
        const put = `${months} ${months === '1' ? 'month' : 'months'}`;
        if (solid) {
          detail =
            check.met === true
              ? `${put}: ${money(liquid)} against ${money(essentials)} a month.`
              : `${put}: ${money(liquid)} against ${money(essentials)} a month. ${gap} to go.`;
        } else {
          detail =
            check.met === true
              ? `${put} put by.`
              : `${money(target * essentials)} would be six months: ${gap} to go. Six is where most guides stop.`;
        }
      } else if (facts.accountsKnown && liquid === null) {
        detail = NO_ACCOUNT;
      }
      return {
        ...base,
        title: solid ? 'Three months of essentials' : 'Six months of essentials',
        detail,
      };
    }
    case 'two-years':
      return {
        ...base,
        title: 'Two years of spending set aside',
        detail:
          check.value === null || check.target === null
            ? null
            : `${readTheSame(check.value, check.target) ? `${gap(check.target, check.value)} to go` : `${money(check.value)} of ${money(check.target)}`}: invested, plus money in reach beyond six months of essentials.`,
      };
    case 'work-optional':
      return {
        ...base,
        title: 'Investments that could cover your spending',
        detail:
          check.value === null || check.target === null
            ? null
            : `${readTheSame(check.value, check.target) ? `${gap(check.target, check.value)} to go` : `${money(check.value)} of ${money(check.target)}`}. At ${rateText(facts.withdrawalRatePct)}% a year, ${money(check.target)} covers what you spend.`,
      };
    case 'enough':
      return {
        ...base,
        title: 'Your own number',
        detail:
          check.value === null || check.target === null
            ? null
            : readTheSame(check.value, check.target)
              ? `${gap(check.target, check.value)} to go.`
              : `${money(check.value)} of ${money(check.target)}.`,
      };
  }
}

/** The circle's checks, in the method's order. `current` is the circle being worked on. */
export function checkRows(
  place: CirclePlace,
  facts: GuidanceFacts,
  words: LedgerWords,
  current: CircleNumber | null
): CheckRow[] {
  const name = CIRCLE_NAMES[place.circle];
  return place.checks.map((check) => ({
    ...rowFor(check, facts, words, current),
    needed: check.required ? `Needed to reach ${name}` : null,
  }));
}

/** One of the person's numbers. */
export interface NumberRow {
  label: string;
  value: string;
  /** Under it: what it is made of, or how it is counted. */
  note?: string;
  /** Where it is set, as a link under it. */
  link?: { hash: string; label: string };
}

export interface CircleNumbers {
  /** "Averages over August 2025 to July 2026. Balances as of today." */
  lead: string;
  rows: NumberRow[];
}

/** The note on money in reach: where it is. */
function partsNote(facts: GuidanceFacts, words: LedgerWords): string | undefined {
  const parts = facts.liquidParts;
  if (!parts) return undefined;
  const money = (amount: number) => words.money(Math.round(amount));
  const out: string[] = [];
  if (parts.savings > 0) out.push(`savings ${money(parts.savings)}`);
  if (parts.current > 0) {
    out.push(`current accounts at their lowest in the last 30 days ${money(parts.current)}`);
  }
  if (parts.cash > 0) out.push(`cash ${money(parts.cash)}`);
  if (out.length === 0) return undefined;
  // One part holds it all: its figure is the row's, so it is not said twice. Current accounts
  // still say how they are counted, which the row's figure alone does not.
  if (out.length === 1) {
    return parts.current > 0
      ? 'Your current accounts at their lowest in the last 30 days.'
      : undefined;
  }
  const text = out.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The person's numbers behind one circle's checks. */
export function circleNumbers(
  circle: CircleNumber,
  facts: GuidanceFacts,
  words: LedgerWords,
  extra: { holdings: number | null; kindsAsked: boolean }
): CircleNumbers {
  const money = (amount: number) => words.money(Math.round(amount));
  const unknown = 'Not known yet';
  const first = facts.months[0];
  const last = facts.months[facts.months.length - 1];
  const lead =
    facts.averaged && first && last
      ? `Averages over ${monthYear(first)} to ${monthYear(last)}. Balances as of today.`
      : 'Averages appear once 3 months are tracked. Balances as of today.';
  const avg = (value: number | null) => (value === null ? unknown : money(value));
  const invested: NumberRow = {
    label: 'Invested',
    value: money(facts.invested),
    note:
      extra.holdings !== null && extra.holdings > 0
        ? 'Holdings at what you paid for them.'
        : undefined,
  };
  switch (circle) {
    case 1:
      return {
        lead,
        rows: [
          { label: 'Months on file', value: `${Math.min(facts.monthsInYear, 12)} of 12` },
          {
            label: 'Spending sorted',
            value:
              facts.sortedShare === null
                ? unknown
                : `${shareOf(facts.sortedShare, 100, facts.sortedShare >= 100)}%`,
          },
          { label: 'Entries without a category', value: String(facts.uncategorisedEntries ?? 0) },
        ],
      };
    case 2: {
      const support =
        facts.income !== null && facts.ownIncome !== null ? facts.income - facts.ownIncome : 0;
      return {
        lead,
        rows: [
          { label: 'Income a month', value: avg(facts.income) },
          {
            label: 'Own income a month',
            value: avg(facts.ownIncome),
            note:
              support >= 0.5
                ? `Without the ${money(support)} a month you marked as support.`
                : undefined,
          },
          { label: 'Spending a month', value: avg(facts.spending) },
        ],
      };
    }
    case 3:
    case 4: {
      const unsure =
        facts.unsure.categories > 0 && !extra.kindsAsked
          ? `${facts.unsure.categories} ${facts.unsure.categories === 1 ? 'category counts' : 'categories count'} as needed because nothing says otherwise. Choose what you need every month.`
          : undefined;
      const debts = facts.debts.filter((debt) => debt.owed > 0);
      return {
        lead,
        rows: [
          {
            label: 'Money you can reach',
            value: !facts.accountsKnown
              ? "Couldn't read your accounts"
              : facts.liquid === null
                ? 'No account to count yet'
                : money(facts.liquid),
            note: partsNote(facts, words),
          },
          { label: 'Needed every month', value: avg(facts.essentials), note: unsure },
          {
            label: 'Debts',
            value: !facts.accountsKnown
              ? "Couldn't read your accounts"
              : debts.length === 0
                ? 'None'
                : money(debts.reduce((sum, debt) => sum + debt.owed, 0)),
            note:
              debts.length === 0
                ? undefined
                : `${debts
                    .map(
                      (debt) =>
                        `${debtName(debt)} ${money(debt.owed)}${debt.rate === null ? '' : ` at ${rateText(debt.rate)}%`}`
                    )
                    .join(', ')}.`,
          },
        ],
      };
    }
    case 5: {
      const beyond =
        facts.liquid !== null && facts.essentials !== null
          ? Math.max(0, facts.liquid - FULL_CUSHION_MONTHS * facts.essentials)
          : null;
      return {
        lead,
        rows: [
          invested,
          { label: 'Money in reach beyond six months', value: avg(beyond) },
          {
            label: 'Two years of spending',
            value:
              facts.annualSpending === null
                ? unknown
                : money(ROOM_TO_CHOOSE_YEARS * facts.annualSpending),
          },
        ],
      };
    }
    case 6:
      return {
        lead,
        rows: [
          invested,
          { label: 'A year of spending', value: avg(facts.annualSpending) },
          {
            label: 'Withdrawal rate',
            value: `${rateText(facts.withdrawalRatePct)}%`,
            link: { hash: '#retirement', label: 'Change it on Retirement' },
          },
        ],
      };
    case 7: {
      const target =
        facts.enoughPerYear === null
          ? null
          : targetFromSpend(facts.enoughPerYear / 12, facts.withdrawalRatePct);
      return {
        lead,
        rows: [
          invested,
          {
            label: 'Your number',
            value:
              facts.enoughPerYear === null ? 'Not set' : `${money(facts.enoughPerYear)} a year`,
          },
          { label: 'Target', value: target === null ? 'Not set' : money(target) },
        ],
      };
    }
  }
}

/** A question a circle's view asks (design.md 1.8, guidance.md 5.5). */
export type CircleQuestion =
  'support' | 'essentials' | 'card' | 'yearly-bills' | 'free-money' | 'saved-elsewhere' | 'enough';

/**
 * The questions circle `circle`'s view asks, each where its answer is first needed: support in
 * Paying your way while there is income to tick; essentials in the cushion circles while some
 * spending counts as needed only because nothing says otherwise; the card question while a card or
 * an overdraft is below zero; yearly bills while Bills holds one; free money while the gate is open
 * and the region has a scheme; savings held elsewhere in Room to choose; the own number once More
 * than enough is the circle being worked on.
 */
export function circleQuestions(
  circle: CircleNumber,
  facts: GuidanceFacts,
  at: { kindsAsked: boolean; current: CircleNumber | null; gate: boolean }
): CircleQuestion[] {
  const categories = facts.windowCategories ?? [];
  const essentials =
    facts.unsure.categories > 0 &&
    !at.kindsAsked &&
    categories.some((category) => category.type === 'expense');
  switch (circle) {
    case 1:
    case 6:
      return [];
    case 2:
      return categories.some((category) => category.type === 'income') ? ['support'] : [];
    case 3:
      return essentials ? ['essentials'] : [];
    case 4: {
      const out: CircleQuestion[] = [];
      if (at.gate && freeMoneyQuestion(facts.region)) out.push('free-money');
      if ((facts.belowZero ?? 0) > 0) out.push('card');
      if (facts.yearlyBills) out.push('yearly-bills');
      if (essentials) out.push('essentials');
      return out;
    }
    case 5:
      return ['saved-elsewhere'];
    case 7:
      return at.current === 7 ? ['enough'] : [];
  }
}

/**
 * The circles whose view has a How you compare part (guidance.md 3.3; cards.ts `circleCards`).
 * Here, not in cards.ts, so the view can tell without loading the benchmarks.
 */
export const CARD_CIRCLES: ReadonlySet<CircleNumber> = new Set<CircleNumber>([2, 3, 4, 5]);
