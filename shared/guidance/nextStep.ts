/**
 * Your next step (design.md section 2.1, circles part 2): the one step the circles point to, on
 * Progress and on Dashboard. Pure, with the money and month formatters passed in.
 *
 * - **Less than a year on file**: Getting started's first step (shared/orientation.ts), and "Then:"
 *   its next two. The circles are not firm yet, so they name no step (`Placement.next` is null).
 * - **A year on file**: the current circle's first check not met, in the method's order, and
 *   "Then:" the next two not met, crossing into the circles further out.
 * - **Every circle reached**: says so, with a link to the circles.
 *
 * A check not known is asked or read again, never advised. The `why` uses the person's own numbers
 * only: a circle's How you compare, behind the benchmarks gate, carries the comparisons.
 */
import {
  CIRCLE_NAMES,
  FIRST_CUSHION_MONTHS,
  FULL_CUSHION_MONTHS,
  SOLID_CUSHION_MONTHS,
  SORTED_SHARE,
} from './circles';
import { debtName, gapOf, monthsText, rateText, shareOf } from './ledger';
import {
  ASKED_ONCE,
  CARD_QUESTION,
  ENOUGH_QUESTION,
  freeMoneyQuestion,
  YEARLY_BILLS_QUESTION,
} from './questions';
import { DAYS_IN_A_MONTH, monthName } from '../orientation';
import { TRACKED_MONTH_MIN_TRANSACTIONS, YEAR_WINDOW_MONTHS } from '../trackedMonths';
import type { Check, CircleNumber, Placement } from './circles';
import type { Debt, GuidanceFacts } from './facts';
import type { LedgerWords } from './ledger';
import type { QuestionId } from './questions';
import type { OrientationStep } from '../orientation';

export type NextStepWords = LedgerWords;

/** "August 2026" for "2026-08-14". */
const monthOf = (date: string): string => `${monthName(date.slice(0, 7))} ${date.slice(0, 4)}`;

/** What the step's button does. */
export type StepAction =
  | { kind: 'open'; hash: string; label: string }
  | { kind: 'reload'; label: string }
  | { kind: 'question'; question: QuestionId }
  | { kind: 'circles'; hash: string; label: string };

/** How far along the step's figure is: months as twelve cells, or a bar to its target. */
export type StepMeter =
  | { kind: 'cells'; on: number; left: string; right: string }
  | { kind: 'bar'; share: number; left: string; right: string };

export interface NextStep {
  /** The check, the Getting started step, or `all-reached`. */
  id: string;
  /** The circle it serves, for its chip; null with every circle reached. */
  circle: CircleNumber | null;
  title: string;
  why: string;
  /**
   * The why inside its own circle's view, where Your numbers holds the inputs, the key figure says
   * where the circle stands and the checks say what they need: the step keeps what to do and the
   * gap, and drops the rest. Null for no line there.
   */
  whyHere: string | null;
  action: StepAction | null;
  meter: StepMeter | null;
  /** "Then: set a budget for Groceries, and build a one-month cushion." */
  then: string | null;
  /** Under a question: that it is asked once, and where to change it. */
  fine: string | null;
}

/** One step's words, before the circle and the "Then:" line are added. */
interface StepWords {
  title: string;
  /** How "Then:" names it: lowercase, short. */
  thenText: string;
  why: string;
  /** `NextStep.whyHere`; left out where it is `why` as it is. */
  whyHere?: string | null;
  action: StepAction | null;
  meter: StepMeter | null;
  fine: string | null;
}

const open = (hash: string, page: string): StepAction => ({
  kind: 'open',
  hash,
  label: `Open ${page}`,
});

const RELOAD: StepAction = { kind: 'reload', label: 'Reload' };

/** In a circle's view, a year on file's step: "5 months to go." The check says how a month counts. */
const monthsToGo = (n: number): string => `${12 - n} ${12 - n === 1 ? 'month' : 'months'} to go.`;

/** "Set a budget" as "Then:" lists it. */
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** "Then: a, and b." */
export function thenLine(items: readonly string[]): string | null {
  if (items.length === 0) return null;
  return `Then: ${items.join(', and ')}.`;
}

/** A bar's share: below 1 while the check is not met, whatever the rounding. */
const barShare = (value: number, target: number, met: boolean): number =>
  target > 0 ? Math.max(0, Math.min(met ? 1 : 0.999, value / target)) : met ? 1 : 0;

function cushionMeter(facts: GuidanceFacts, target: number, met: boolean): StepMeter | null {
  const months = facts.cushionMonths;
  if (months === null || months === Infinity) return null;
  const left =
    months < 1
      ? `${Math.floor(months * DAYS_IN_A_MONTH)} days`
      : `${monthsText(months)} ${monthsText(months) === '1' ? 'month' : 'months'}`;
  return {
    kind: 'bar',
    share: barShare(months, target, met),
    left,
    right: `${target} ${target === 1 ? 'month' : 'months'}`,
  };
}

function moneyMeter(check: Check, words: LedgerWords): StepMeter | null {
  if (check.value === null || check.target === null) return null;
  return {
    kind: 'bar',
    share: barShare(check.value, check.target, check.met === true),
    left: words.money(Math.round(check.value)),
    right: words.money(Math.round(check.target)),
  };
}

const reloadStep = (what: string): StepWords => ({
  title: 'Reload your accounts',
  thenText: 'reload your accounts',
  why: `They didn't load, so ${what} is waiting.`,
  action: RELOAD,
  meter: null,
  fine: null,
});

const NO_ACCOUNT_STEP: StepWords = {
  title: 'Add the accounts your money is in',
  thenText: 'add the accounts your money is in',
  why: 'None of your accounts is a savings, cash or current account yet, so there is no cushion to count.',
  action: open('#accounts', 'Accounts'),
  meter: null,
  fine: null,
};

/** "One yearly bill on Bills comes to €600 a year: about €50 a month." */
function yearlyWhy(facts: GuidanceFacts, words: LedgerWords): string {
  const bills = facts.yearlyBills!;
  const amount = words.money(Math.round(bills.perYear));
  const monthly = words.money(Math.ceil(bills.perMonth));
  return bills.count === 1
    ? `One yearly bill on Bills comes to ${amount} a year: about ${monthly} a month.`
    : `${bills.count} yearly bills on Bills come to ${amount} a year: about ${monthly} a month.`;
}

function debtStep(facts: GuidanceFacts, check: Check, words: NextStepWords): StepWords | null {
  if (check.unknown === 'unread') return reloadStep('the debt check');
  if (check.unknown === 'not-on-file') {
    const card = facts.debts.find((debt) => debt.expensive === null);
    const name = card ? debtName(card) : 'A card';
    const since = card?.since ?? null;
    return {
      title: CARD_QUESTION,
      thenText: 'say whether you carry a card balance',
      why:
        since === null
          ? `${name} has too few entries to show whether you clear it each month. Your answer settles the debt check in Solid ground.`
          : `${name} has been here since ${monthOf(since)}, too short for its entries to show whether you clear it each month. Your answer settles the debt check in Solid ground.`,
      action: { kind: 'question', question: 'card' },
      meter: null,
      fine: ASKED_ONCE,
    };
  }
  const debt: Debt | undefined = facts.debts.find((one) => one.expensive === true);
  if (!debt) return null;
  const name = debtName(debt);
  if (debt.kind === 'loan') {
    return {
      title: `Compare paying ${name} off faster`,
      thenText: `compare paying ${name} off faster`,
      why: `It costs ${rateText(debt.rate ?? 0)}% a year. Solid ground asks for no debt at 10% or more.`,
      // Its rate is on Your numbers' debts, and the circle's line asks for no debt at 10% or more.
      whyHere: null,
      action: open(debt.id === null ? '#loans' : `#loans/${debt.id}/compare`, 'Loans'),
      meter: null,
      fine: null,
    };
  }
  const owed = words.money(Math.round(debt.owed));
  if (debt.rate === null) {
    return {
      title: `${name} carries ${owed}`,
      thenText: `add the rate ${name} charges`,
      why: 'With no rate set, it counts as debt at 10% or more. Add its rate in Accounts.',
      action: open('#accounts', 'Accounts'),
      meter: null,
      fine: null,
    };
  }
  return {
    title: `${name} costs ${rateText(debt.rate)}% a year`,
    thenText: `look at the ${rateText(debt.rate)}% ${name} costs`,
    why: `It carries ${owed}. Solid ground asks for no debt at 10% or more.`,
    // What it carries is on Your numbers' debts; the title has the rate.
    whyHere: null,
    action: open('#accounts', 'Accounts'),
    meter: null,
    fine: null,
  };
}

/** The words for a check that is not met, or not known. Null for one with nothing to say. */
function stepFor(
  check: Check,
  facts: GuidanceFacts,
  current: CircleNumber,
  words: NextStepWords
): StepWords | null {
  const met = check.met === true;
  switch (check.id) {
    case 'year-on-file': {
      // Getting started's words for the same step (shared/orientation.ts, `import-year`).
      const n = Math.min(facts.monthsInYear, 12);
      const counts = `A month counts once it holds ${TRACKED_MONTH_MIN_TRANSACTIONS} entries.`;
      const window = `the last ${YEAR_WINDOW_MONTHS} months`;
      return {
        title: n === 0 ? 'Import a year of statements' : 'Import the rest of your year',
        thenText: n === 0 ? 'import a year of statements' : 'import the rest of your year',
        why:
          n === 0
            ? `None of ${window} is tracked yet. ${counts}`
            : `${n} of ${window} ${n === 1 ? 'is' : 'are'} tracked. ${counts}`,
        whyHere: monthsToGo(n),
        action: open('#import', 'Import'),
        meter: {
          kind: 'cells',
          on: Math.min(facts.monthsInYear, 12),
          left: `${Math.min(facts.monthsInYear, 12)} of 12 months on file`,
          right: 'A year',
        },
        fine: null,
      };
    }
    case 'sorted': {
      const share = facts.sortedShare ?? 0;
      return {
        title: 'Sort the entries without a category',
        thenText: 'sort the entries without a category',
        why: `${shareOf(share, 100, false)}% of your spending has a category; Clear picture needs ${SORTED_SHARE}%.`,
        whyHere: `Another ${SORTED_SHARE - shareOf(share, 100, false)}% of your spending to sort.`,
        action: open('#transactions?uncategorised=1', 'Transactions'),
        meter: {
          kind: 'bar',
          share: barShare(share, SORTED_SHARE, met),
          left: `${shareOf(share, 100, false)}% sorted`,
          right: `${SORTED_SHARE}%`,
        },
        fine: null,
      };
    }
    case 'own-income': {
      // Short on own income, with the accounts that might cover it unread: read them first.
      if (check.unknown === 'unread') return reloadStep('the income check');
      if (check.value === null || check.target === null) return null;
      const gap = words.money(gapOf(check.target, check.value));
      const support = facts.income !== null && facts.income - check.value >= 0.5;
      return {
        title: `Close the ${gap} a month gap`,
        thenText: `close the ${gap} a month gap`,
        why: support
          ? `Over your last ${facts.months.length} tracked months, ${gap} a month more went out than your own income brought in.`
          : `Over your last ${facts.months.length} tracked months, ${gap} a month more went out than came in.`,
        // The title says the gap; Your numbers, what came in and went out.
        whyHere: support
          ? `Over your last ${facts.months.length} tracked months, more went out than your own income brought in.`
          : `Over your last ${facts.months.length} tracked months, more went out than came in.`,
        action: open('#budgets', 'Budgets'),
        meter: {
          kind: 'bar',
          share: barShare(Math.max(0, check.value), check.target, met),
          left: `${words.money(Math.round(Math.max(0, check.value)))} in`,
          right: `${words.money(Math.round(check.target))} out`,
        },
        fine: null,
      };
    }
    case 'first-cushion': {
      if (check.unknown === 'unread') return reloadStep('the cushion check');
      if (check.unknown === 'not-on-file') return NO_ACCOUNT_STEP;
      const days = Math.floor((facts.cushionMonths ?? 0) * DAYS_IN_A_MONTH);
      const what = facts.unsure.all ? 'what you spend' : 'what you need';
      return {
        title: 'Build a one-month cushion',
        thenText: 'build a one-month cushion',
        why:
          days === 0
            ? `The money you can reach doesn't cover a day of ${what}.`
            : `The money you can reach covers ${days} ${days === 1 ? 'day' : 'days'} of ${what}.`,
        // The days are the key figure over it; the gap is what to put by.
        whyHere:
          facts.liquid === null || facts.essentials === null
            ? undefined
            : `${words.money(gapOf(FIRST_CUSHION_MONTHS * facts.essentials, facts.liquid))} to go.`,
        action: open('#goals', 'Goals'),
        meter: cushionMeter(facts, FIRST_CUSHION_MONTHS, met),
        fine: null,
      };
    }
    case 'free-money': {
      const question = freeMoneyQuestion(facts.region);
      if (!question) return null;
      return {
        title: question.title,
        thenText: lowerFirst(question.title),
        why: question.question,
        action: { kind: 'question', question: 'free-money' },
        meter: null,
        fine: ASKED_ONCE,
      };
    }
    case 'no-expensive-debt':
      return debtStep(facts, check, words);
    case 'yearly-bills': {
      if (!facts.yearlyBills) return null;
      if (check.met === null) {
        return {
          title: YEARLY_BILLS_QUESTION,
          thenText: 'say whether you set yearly bills aside',
          why: yearlyWhy(facts, words),
          action: { kind: 'question', question: 'yearly-bills' },
          meter: null,
          fine: ASKED_ONCE,
        };
      }
      const monthly = words.money(Math.ceil(facts.yearlyBills.perMonth));
      return {
        title: `Set aside ${monthly} a month for yearly bills`,
        thenText: `set aside ${monthly} a month for yearly bills`,
        why: yearlyWhy(facts, words),
        action: open('#goals', 'Goals'),
        meter: null,
        fine: null,
      };
    }
    case 'solid-cushion':
    case 'full-cushion': {
      if (check.unknown === 'unread') return reloadStep('the cushion check');
      if (check.unknown === 'not-on-file') return NO_ACCOUNT_STEP;
      if (facts.liquid === null || facts.essentials === null) return null;
      const target = check.id === 'solid-cushion' ? SOLID_CUSHION_MONTHS : FULL_CUSHION_MONTHS;
      const gap = words.money(gapOf(target * facts.essentials, facts.liquid));
      return check.id === 'solid-cushion'
        ? {
            title: 'Grow your cushion to three months',
            thenText: 'grow your cushion to three months',
            why: `${gap} to go: ${words.money(Math.round(facts.liquid))} you can reach, against ${words.money(Math.round(facts.essentials))} needed a month.`,
            whyHere: `${gap} to go.`,
            action: open('#goals', 'Goals'),
            meter: cushionMeter(facts, target, met),
            fine: null,
          }
        : {
            title: 'Grow your cushion to six months',
            thenText: 'grow your cushion to six months',
            why: `${gap} to go. Six months is where most guides stop.`,
            action: open('#goals', 'Goals'),
            meter: cushionMeter(facts, target, met),
            fine: null,
          };
    }
    case 'two-years': {
      if (check.unknown === 'unread') return reloadStep('this check');
      if (check.value === null || check.target === null) return null;
      const gap = words.money(gapOf(check.target, check.value));
      const onePoint = facts.income !== null && facts.income > 0 ? facts.income / 100 : null;
      return {
        title: 'Raise your savings rate by one point',
        thenText: 'raise your savings rate by one point',
        why:
          onePoint === null
            ? `${gap} to two years of spending.`
            : `One more point is ${words.money(Math.max(1, Math.ceil(onePoint)))} a month. ${gap} to two years of spending.`,
        action: open('#goals', 'Goals'),
        meter: moneyMeter(check, words),
        fine: null,
      };
    }
    case 'work-optional': {
      if (check.unknown === 'unread') return reloadStep('this check');
      if (check.value === null || check.target === null) return null;
      return {
        title: 'Check the withdrawal rate you plan with',
        thenText: 'check the withdrawal rate you plan with',
        why: `At ${rateText(facts.withdrawalRatePct)}% a year, ${words.money(Math.round(check.target))} would cover what you spend. You're at ${words.money(Math.round(check.value))}.`,
        // Both figures are the key figure; the rate is on Your numbers, with its link.
        whyHere: 'A lower rate needs more invested; a higher one, less.',
        action: open('#retirement', 'Retirement'),
        meter: moneyMeter(check, words),
        fine: null,
      };
    }
    case 'enough': {
      if (facts.enoughPerYear === null) {
        // Asked once Work optional is reached, as the ledger's row says; not listed before.
        if (current !== 7) return null;
        return {
          title: ENOUGH_QUESTION,
          thenText: 'name your own number for more than enough',
          why: 'Work optional is reached. Your own number decides the last circle; there is no default.',
          action: { kind: 'question', question: 'enough' },
          meter: null,
          fine: ASKED_ONCE,
        };
      }
      if (check.unknown === 'unread') return reloadStep('this check');
      if (check.value === null || check.target === null) return null;
      const target = words.money(Math.round(check.target));
      return {
        title: `Your own number: ${target}`,
        thenText: `reach your own number, ${target}`,
        why: `You're at ${words.money(Math.round(check.value))}. At ${rateText(facts.withdrawalRatePct)}% a year, ${target} pays for a year of more than enough.`,
        whyHere: `${words.money(gapOf(check.target, check.value))} to go.`,
        action: open('#retirement', 'Retirement'),
        meter: moneyMeter(check, words),
        fine: null,
      };
    }
  }
}

/** The checks not met from the current circle out, in order, each with its circle. */
function unmetFrom(placement: Placement): { circle: CircleNumber; check: Check }[] {
  const out: { circle: CircleNumber; check: Check }[] = [];
  for (const place of placement.circles) {
    if (placement.current === null || place.circle < placement.current) continue;
    for (const check of place.checks) {
      if (check.met !== true) out.push({ circle: place.circle, check });
    }
  }
  return out;
}

export interface NextStepInput {
  placement: Placement;
  facts: GuidanceFacts;
  /** Getting started's steps: read while less than a year is on file. */
  orientation: readonly OrientationStep[] | null;
  words: NextStepWords;
}

const ALL_REACHED: NextStep = {
  id: 'all-reached',
  circle: null,
  title: "You've reached all seven circles.",
  why: 'Every check the circles hold is met, from a year on file to your own number.',
  whyHere: 'Every check the circles hold is met, from a year on file to your own number.',
  action: { kind: 'circles', hash: '#progress', label: 'See all seven circles' },
  meter: null,
  then: null,
  fine: null,
};

/** The step the circles point to now. */
export function nextStepOf({ placement, facts, orientation, words }: NextStepInput): NextStep {
  const current = placement.current;
  if (current === null) return ALL_REACHED;
  if (!facts.firm && orientation && orientation.length > 0) {
    const [first, ...rest] = orientation;
    return {
      id: first.id,
      circle: current,
      title: first.title,
      why: first.reason,
      // A year on file's check says how a month counts, and the key figure the months there are.
      whyHere:
        first.id === 'import-year' ? monthsToGo(Math.min(facts.monthsInYear, 12)) : first.reason,
      action: open(first.link.hash, first.link.label),
      meter:
        first.id === 'import-year'
          ? {
              kind: 'cells',
              on: Math.min(facts.monthsInYear, 12),
              left: `${Math.min(facts.monthsInYear, 12)} of 12 months on file`,
              right: 'A year',
            }
          : null,
      then: thenLine(rest.slice(0, 2).map((step) => lowerFirst(step.title))),
      fine: null,
    };
  }
  const steps = unmetFrom(placement)
    .map(({ circle, check }) => ({ circle, check, words: stepFor(check, facts, current, words) }))
    .filter(
      (step): step is { circle: CircleNumber; check: Check; words: StepWords } =>
        step.words !== null
    );
  const [first, ...rest] = steps;
  if (!first) return ALL_REACHED;
  // Checks that wait on the same thing (accounts that didn't load, an account to add) are one step.
  const later: string[] = [];
  for (const step of rest) {
    const text = step.words.thenText;
    if (text !== first.words.thenText && !later.includes(text)) later.push(text);
    if (later.length === 2) break;
  }
  return {
    id: first.check.id,
    circle: first.circle,
    title: first.words.title,
    why: first.words.why,
    whyHere: first.words.whyHere === undefined ? first.words.why : first.words.whyHere,
    action: first.words.action,
    meter: first.words.meter,
    then: thenLine(later),
    fine: first.words.fine,
  };
}

/** The circle's name for the step's chip. */
export const stepCircleName = (step: NextStep): string | null =>
  step.circle === null ? null : CIRCLE_NAMES[step.circle];
