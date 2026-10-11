/**
 * Getting started: the next steps a person's own data says are worth taking. Each rule reads a
 * few counts the app already has in both storage modes (OrientationFacts) and either applies or
 * does not. The steps that apply come back in rule order, and the first NEXT_STEPS_SHOWN are the
 * ones shown, on the setup wizard's last step and on Dashboard.
 *
 * Every step says why in the person's own counts and months, never in amounts, and links to the
 * page where it is done. Rules carry stable ids, so a rule added later goes in its place in
 * RULES without moving the others: "cushion" between heavy-month and loan-payoff once essential
 * categories exist, and a first print at the end.
 */
import { addCalendarMonths } from './calendarMonths';
import {
  TRACKED_MONTH_MIN_TRANSACTIONS,
  YEAR_ON_FILE_MONTHS,
  YEAR_WINDOW_MONTHS,
} from './trackedMonths';

export type OrientationStepId =
  | 'import-year'
  | 'review-subscriptions'
  | 'sort-uncategorised'
  | 'budget-top-category'
  | 'heavy-month'
  | 'loan-payoff';

/** What the rules read. The counts are the profile's own; months are 'YYYY-MM'. */
export interface OrientationFacts {
  /** YYYY-MM-DD. The last full month is the one before it. */
  today: string;
  /** Tracked months in the year window that ends this month (trackedMonthsInYearWindow). */
  trackedMonthsInYear: number;
  /** Subscriptions the scan proposes that are not bills yet, low-confidence guesses aside. */
  subscriptionsSpotted: number;
  /**
   * Of those, the ones the scan would add as bills, not subscriptions: regular payments like the
   * rent. The step says "regular payments" while there is one.
   */
  billsSpotted: number;
  /** Entries on file that take a category: everything but transfers. */
  entries: number;
  /** Of those, how many have none. */
  uncategorised: number;
  /** The category spent on most in the last full month with no budget and no bill behind it. */
  topUnbudgeted: { categoryId: number; name: string } | null;
  /** The last full month, when it spent more than it earned. */
  heavyMonth: string | null;
  /** Loans on file. */
  loans: number;
}

export interface OrientationStep {
  id: OrientationStepId;
  title: string;
  /** Why this step, in the person's own counts and months. */
  reason: string;
  /** Where the step is done: a hash route, and the page's name. */
  link: { hash: string; label: string };
}

/** How many steps are shown at once. */
export const NEXT_STEPS_SHOWN = 3;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 'September' for '2026-09'. English, and the same in every runtime and time zone. */
function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** The last full month before `today` (YYYY-MM-DD), as 'YYYY-MM'. */
export function lastFullMonth(today: string): string {
  return addCalendarMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

/**
 * The share of entries without a category, as the whole percent the step shows. The step applies
 * above 10, read from this same number, so its reason never says "10%" for a share that counts as
 * more than one in ten.
 */
const unsortedPercent = (uncategorised: number, entries: number): number =>
  entries > 0 ? Math.round((uncategorised * 100) / entries) : 0;

interface Rule {
  id: OrientationStepId;
  /** The step when the rule applies to these facts, or null. */
  step: (facts: OrientationFacts) => Omit<OrientationStep, 'id'> | null;
}

const RULES: Rule[] = [
  {
    id: 'import-year',
    // A year on file (shared/trackedMonths.ts), and the reason names its window: the badges and
    // the streak count months in a row, so "tracked months" alone would read as their number.
    step: ({ trackedMonthsInYear: n }) => {
      if (n >= YEAR_ON_FILE_MONTHS) return null;
      const counts = `A month counts once it holds ${TRACKED_MONTH_MIN_TRANSACTIONS} entries.`;
      const window = `the last ${YEAR_WINDOW_MONTHS} months`;
      return n === 0
        ? {
            title: 'Import a year of statements',
            reason: `None of ${window} is tracked yet. ${counts}`,
            link: { hash: '#import', label: 'Import' },
          }
        : {
            title: 'Import the rest of your year',
            reason: `${n} of ${window} ${n === 1 ? 'is' : 'are'} tracked. ${counts}`,
            link: { hash: '#import', label: 'Import' },
          };
    },
  },
  {
    id: 'review-subscriptions',
    step: ({ subscriptionsSpotted: n, billsSpotted }) => {
      if (n <= 0) return null;
      // "Subscriptions" only when every find is one; a rent or a co-pay is a regular payment.
      const [one, many] =
        billsSpotted > 0
          ? ['regular payment', 'regular payments']
          : ['subscription', 'subscriptions'];
      return {
        title: n === 1 ? `Review the ${one} we spotted` : `Review the ${n} ${many} we spotted`,
        reason:
          n === 1
            ? "It's in your statements but not on Bills yet."
            : "They're in your statements but not on Bills yet.",
        link: { hash: '#bills?scan=1', label: 'Bills' },
      };
    },
  },
  {
    id: 'sort-uncategorised',
    step: ({ uncategorised: n, entries }) => {
      const share = unsortedPercent(n, entries);
      if (share <= 10) return null;
      return {
        title:
          n === 1
            ? 'Sort the entry without a category'
            : `Sort the ${n} entries without a category`,
        reason: `That's ${share}% of your entries. Budgets and Analytics group spending by category.`,
        link: { hash: '#transactions?uncategorised=1', label: 'Transactions' },
      };
    },
  },
  {
    id: 'budget-top-category',
    step: ({ topUnbudgeted, today }) => {
      if (topUnbudgeted === null) return null;
      const month = monthName(lastFullMonth(today));
      return {
        title: `Set a budget for ${topUnbudgeted.name}`,
        reason: `You spent more on it in ${month} than on any other category with no budget or bill.`,
        link: { hash: '#budgets', label: 'Budgets' },
      };
    },
  },
  {
    id: 'heavy-month',
    step: ({ heavyMonth }) => {
      if (heavyMonth === null) return null;
      const month = monthName(heavyMonth);
      return {
        title: `See what put ${month} in the red`,
        reason: `${month} spent more than it earned.`,
        // Analytics shows a year at a time; Transactions shows the month.
        link: { hash: `#transactions?period=${heavyMonth}`, label: 'Transactions' },
      };
    },
  },
  {
    id: 'loan-payoff',
    step: ({ loans }) => {
      if (loans <= 0) return null;
      return {
        title:
          loans === 1
            ? 'Compare paying your loan off faster'
            : 'Compare paying your loans off faster',
        reason:
          loans === 1
            ? 'You have a loan on file. Loans sets its plan beside a what-if with extra payments.'
            : `You have ${loans} loans on file. Loans sets each plan beside a what-if with extra payments.`,
        link: { hash: '#loans', label: 'Loans' },
      };
    },
  },
];

/** The rule ids, in the order their steps are listed. */
export const ORIENTATION_RULES: readonly OrientationStepId[] = RULES.map((rule) => rule.id);

/** Every step whose rule applies, in rule order. */
export function orientationSteps(facts: OrientationFacts): OrientationStep[] {
  const steps: OrientationStep[] = [];
  for (const rule of RULES) {
    const step = rule.step(facts);
    if (step !== null) steps.push({ id: rule.id, ...step });
  }
  return steps;
}

/** The steps shown: the first NEXT_STEPS_SHOWN that apply. */
export function nextSteps(facts: OrientationFacts): OrientationStep[] {
  return orientationSteps(facts).slice(0, NEXT_STEPS_SHOWN);
}
