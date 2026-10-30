/**
 * The seven circles (guidance.md section 3.2): where a person's own numbers put them, what each
 * circle checks, and the next step.
 *
 * Each circle is reached when the circle inside it is and its own required checks are met, so the
 * current circle is the first one not reached. They are worked out again from the facts each time
 * (facts.ts), so a hard month can move a person inward. A check is met (true), not met (false), or
 * not known yet (null), and a check not known says why (`unknown`): the accounts could not be read
 * (`'unread'`: read them again), or nothing on file says yet (`'not-on-file'`: too few months, no
 * account money could be in, a question not answered). A check not known is never a step to
 * take: it is asked about or read again.
 *
 * Until a year is on file the placement is provisional ("Circles firm up once a full year is
 * here"), and the next step is Getting started's (shared/orientation.ts). After that it is the
 * current circle's first check not met, in the order the circle lists them, which for Solid
 * ground is the method's: free money, expensive debt, then the cushion; the step says when its
 * check is not known. A required check not known leaves the placement provisional too: the person
 * is placed at the circles that could be read, and may be further out.
 *
 * Four decisions live here, each in one place (guidance.md section 7):
 *
 * - **D1, the structure**: `CIRCLES`, seven circles in order, each with the checks that reach it.
 * - **D2, the names**: `CIRCLE_NAMES`.
 * - **D10, a year for the first circle**: `CLEAR_PICTURE_MONTHS`.
 * - **D11, no default for the seventh**: `MORE_THAN_ENOUGH_DEFAULT`, which is null, so the circle
 *   has no target until the person names one.
 *
 * Pure: the caller works out the facts.
 */
import { targetFromSpend } from '../retirement';
import { YEAR_ON_FILE_MONTHS } from '../trackedMonths';
import type { FreeMoney, GuidanceFacts } from './facts';
import type { Region } from './region';

export type CircleNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** D2: what each circle is called. */
export const CIRCLE_NAMES: Readonly<Record<CircleNumber, string>> = {
  1: 'Clear picture',
  2: 'Paying your way',
  3: 'Breathing room',
  4: 'Solid ground',
  5: 'Room to choose',
  6: 'Work optional',
  7: 'More than enough',
};

/** D10: the tracked months of the last thirteen that the first circle needs. */
export const CLEAR_PICTURE_MONTHS = YEAR_ON_FILE_MONTHS;

/** The share of a year's spending, by amount, that the first circle needs sorted, in percent. */
export const SORTED_SHARE = 90;

/**
 * The cushions, in months of essential spending: one for Breathing room, three for Solid ground,
 * and six, the top of the three-to-six convention, on Solid ground's checklist. One and six are
 * also `cushion.months`' band edges in every region (benchmarks.json, which a test holds them to).
 */
export const FIRST_CUSHION_MONTHS = 1;
export const SOLID_CUSHION_MONTHS = 3;
export const FULL_CUSHION_MONTHS = 6;

/** Room to choose: years of spending invested, with liquid money beyond six months. */
export const ROOM_TO_CHOOSE_YEARS = 2;

/** D11: the yearly cost of more than enough when the person has named none. None. */
export const MORE_THAN_ENOUGH_DEFAULT: number | null = null;

/**
 * The regions with free money from an employer or the state to check (guidance.md 4.4.11): a
 * company pension in Germany, the state's top-up in Croatia, a workplace pension in the UK and an
 * employer's match in the US. The EU average has no one scheme to ask about.
 */
export const FREE_MONEY_REGIONS: ReadonlySet<Region> = new Set<Region>(['DE', 'HR', 'UK', 'US']);

export type CheckId =
  | 'year-on-file'
  | 'sorted'
  | 'own-income'
  | 'first-cushion'
  | 'free-money'
  | 'no-expensive-debt'
  | 'solid-cushion'
  | 'full-cushion'
  | 'two-years'
  | 'work-optional'
  | 'enough';

/**
 * Why a check is not known: what it reads could not be read (`'unread'`, the accounts), or nothing
 * on file says yet (`'not-on-file'`).
 */
export type Unknown = 'unread' | 'not-on-file';

export interface Check {
  id: CheckId;
  /** Met, not met, or not known yet. */
  met: boolean | null;
  /** Why `met` is null; null when the check is known. */
  unknown: Unknown | null;
  /**
   * The check that meets this one when its own figures do not: own income by work optional, as
   * living off investments is paying one's way. Absent otherwise.
   */
  via?: CheckId;
  /** Whether the circle needs it to be reached. The others are on its checklist. */
  required: boolean;
  /** Read from the averages of less than a year: it may move as the year fills in. */
  provisional: boolean;
  /** The person's figure, in the unit of `target`; null when not known. */
  value: number | null;
  /** What the check asks for; null when there is nothing to reach yet. */
  target: number | null;
}

export interface CirclePlace {
  circle: CircleNumber;
  name: string;
  /** Every circle inside it is reached, and so is every required check of its own. */
  reached: boolean;
  checks: Check[];
}

export interface Placement {
  /** The first circle not reached; null once all seven are. */
  current: CircleNumber | null;
  circles: CirclePlace[];
  /**
   * The current circle's first check not met, and why it is not known when it is not
   * (`unknown`): then it is asked about or read again, not advised. Null while less than a year is
   * on file, when Getting started's steps lead, and once every circle is reached.
   */
  next: { circle: CircleNumber; check: CheckId; unknown: Unknown | null } | null;
  /**
   * Less than a year on file, or a required check of the current circle not known: the person
   * may be further out than `current`.
   */
  provisional: boolean;
}

/**
 * A check from a value and a target, met when the value reaches it. `unread` says the value needs
 * the accounts and they could not be read: what was read without them can only grow once they
 * are, so a value that reaches the target is met, and one below it is not known.
 */
function reaching(
  id: CheckId,
  value: number | null,
  target: number | null,
  options: { required?: boolean; provisional?: boolean; unread?: boolean } = {}
): Check {
  const met = value === null || target === null ? null : value >= target;
  const unread = options.unread === true && met !== true;
  return {
    id,
    met: unread ? null : met,
    unknown: unread ? 'unread' : met === null ? 'not-on-file' : null,
    required: options.required ?? true,
    provisional: options.provisional ?? false,
    value,
    target,
  };
}

/**
 * No debt at EXPENSIVE_DEBT_RATE or more. A card or an overdraft is only known of when the accounts
 * are (`'unread'`), and a card whose entries cannot say whether its balance is carried leaves it
 * not known until the person answers the card question (`'not-on-file'`). One expensive debt is
 * enough to know it is not met.
 */
function noExpensiveDebt(facts: GuidanceFacts): Check {
  const expensive = facts.debts.map((debt) => debt.expensive);
  const unknown: Unknown | null = expensive.includes(true)
    ? null
    : !facts.accountsKnown
      ? 'unread'
      : expensive.includes(null)
        ? 'not-on-file'
        : null;
  return {
    id: 'no-expensive-debt',
    met: expensive.includes(true) ? false : unknown === null ? true : null,
    unknown,
    required: true,
    provisional: false,
    value: expensive.filter((one) => one === true).length,
    target: 0,
  };
}

/** Work optional: invested money could pay for today's spending at the withdrawal rate. */
function workOptional(facts: GuidanceFacts): Check {
  return reaching(
    'work-optional',
    facts.invested,
    facts.spending === null ? null : targetFromSpend(facts.spending, facts.withdrawalRatePct),
    { provisional: !facts.firm, unread: !facts.accountsKnown }
  );
}

/**
 * Own income covers spending, over the window. Invested money that covers it at the withdrawal
 * rate, work optional's check, meets it too (`via`): living off investments is paying one's way.
 * Short on its own figures while the investments could not be read, it is not known.
 */
function ownIncome(facts: GuidanceFacts): Check {
  const own = reaching('own-income', facts.ownIncome, facts.spending, { provisional: !facts.firm });
  if (own.met !== false) return own;
  const invested = workOptional(facts);
  if (invested.met === true) return { ...own, met: true, via: 'work-optional' };
  if (invested.unknown === 'unread') return { ...own, met: null, unknown: 'unread' };
  return own;
}

/**
 * Free money: taken, or none on offer. Taken in part, not taken, or not sure, is the step still to
 * take.
 */
function freeMoneyMet(answer: FreeMoney | null): boolean | null {
  if (answer === null) return null;
  return answer === 'taken' || answer === 'not-offered';
}

/**
 * D1: the seven circles in order, each with its checks, in the order its next step takes them.
 * guidance.md 3.2 says what each circle checks; 5.4 how it reads.
 */
export const CIRCLES: ReadonlyArray<{
  circle: CircleNumber;
  checks: (facts: GuidanceFacts) => Check[];
}> = [
  {
    // A year of statements, sorted.
    circle: 1,
    checks: (facts) => [
      reaching('year-on-file', facts.monthsInYear, CLEAR_PICTURE_MONTHS),
      reaching('sorted', facts.sortedShare, SORTED_SHARE, { provisional: !facts.firm }),
    ],
  },
  {
    // Own income covers spending, over the window, or invested money does (circle 6's check).
    circle: 2,
    checks: (facts) => [ownIncome(facts)],
  },
  {
    // A month of essentials the person can reach. Today's balances, so never provisional.
    circle: 3,
    checks: (facts) => [
      reaching('first-cushion', facts.cushionMonths, FIRST_CUSHION_MONTHS, {
        unread: !facts.accountsKnown,
      }),
    ],
  },
  {
    // The method's order: free money, then debt at the line or above, then the cushion.
    circle: 4,
    checks: (facts) => [
      ...(FREE_MONEY_REGIONS.has(facts.region)
        ? [
            {
              id: 'free-money' as const,
              met: freeMoneyMet(facts.freeMoney),
              unknown: freeMoneyMet(facts.freeMoney) === null ? ('not-on-file' as const) : null,
              required: false,
              provisional: false,
              value: null,
              target: null,
            },
          ]
        : []),
      noExpensiveDebt(facts),
      reaching('solid-cushion', facts.cushionMonths, SOLID_CUSHION_MONTHS, {
        unread: !facts.accountsKnown,
      }),
      reaching('full-cushion', facts.cushionMonths, FULL_CUSHION_MONTHS, {
        required: false,
        unread: !facts.accountsKnown,
      }),
    ],
  },
  {
    // Two years of spending set aside: invested money, and liquid money beyond six months.
    circle: 5,
    checks: (facts) => {
      const beyond =
        facts.liquid !== null && facts.essentials !== null
          ? Math.max(0, facts.liquid - FULL_CUSHION_MONTHS * facts.essentials)
          : 0;
      const target =
        facts.annualSpending === null ? null : ROOM_TO_CHOOSE_YEARS * facts.annualSpending;
      return [
        reaching('two-years', facts.invested + beyond, target, {
          provisional: !facts.firm,
          unread: !facts.accountsKnown,
        }),
      ];
    },
  },
  {
    // Invested money could pay for today's spending at the person's withdrawal rate.
    circle: 6,
    checks: (facts) => [workOptional(facts)],
  },
  {
    // The person's own number for more than enough, at the same rate. No default (D11).
    circle: 7,
    checks: (facts) => {
      const perYear = facts.enoughPerYear ?? MORE_THAN_ENOUGH_DEFAULT;
      const target =
        perYear === null ? null : targetFromSpend(perYear / 12, facts.withdrawalRatePct);
      return [reaching('enough', facts.invested, target, { unread: !facts.accountsKnown })];
    },
  },
];

/** Where the facts put a person in the seven circles, and their next step. */
export function placeCircle(facts: GuidanceFacts): Placement {
  const circles: CirclePlace[] = [];
  let inside = true;
  for (const { circle, checks: checksOf } of CIRCLES) {
    const checks = checksOf(facts);
    const reached: boolean =
      inside && checks.every((check) => !check.required || check.met === true);
    circles.push({ circle, name: CIRCLE_NAMES[circle], reached, checks });
    inside = reached;
  }
  const current = circles.find((place) => !place.reached) ?? null;
  // A required check not known stops the placement here without saying the circle is not reached.
  const notKnown = current !== null && current.checks.some((c) => c.required && c.met === null);
  const check =
    current === null || !facts.firm ? undefined : current.checks.find((c) => c.met !== true);
  return {
    current: current?.circle ?? null,
    circles,
    next:
      current !== null && check !== undefined
        ? { circle: current.circle, check: check.id, unknown: check.unknown }
        : null,
    provisional: !facts.firm || notKnown,
  };
}
