/**
 * The seven circles as Progress lists them: a status line over the list, and one row per circle
 * with the person's own figure (design.md section 1, circles part 2). Pure: the placement and the
 * facts come from circles.ts and facts.ts, and the money formatter is passed in, as the advice's
 * is, so the words are the same in both storage modes and in a test.
 *
 * **Rounding never shows a check as met early**:
 *
 * - A share of a target is floored while the check is not met, so it never reads 100%; a met one
 *   rounds.
 * - A gap is rounded up to the next whole unit, so "€0 to go" never shows beside a check not met.
 * - Months floor to one decimal ("2.9"); days floor to whole days, 30 to a month.
 * - Nothing marked as needed every month (a cushion of Infinity) has words of its own.
 */
import { DAYS_IN_A_MONTH } from '../orientation';
import { CIRCLE_NAMES, FIRST_CUSHION_MONTHS, SORTED_SHARE, SOLID_CUSHION_MONTHS } from './circles';
import type { Check, CheckId, CircleNumber, CirclePlace, Placement } from './circles';
import type { Debt, GuidanceFacts } from './facts';

/** How the ledger writes an amount: whole units in the app's format ("€1,000"). */
export interface LedgerWords {
  money: (amount: number) => string;
}

/** guidance.md 5.4: what each circle is, in one line. */
export const CIRCLE_LINES: Readonly<Record<CircleNumber, string>> = {
  1: 'A full year of your money, sorted.',
  2: 'Your own income covers what you spend.',
  3: "A month of essentials in cash, so payday isn't a deadline.",
  4: 'Three to six months put by, and no debt at 10% or more.',
  5: 'Two years of spending set aside: room to change jobs, move or take time off.',
  6: "What you've invested could cover what you spend.",
  7: 'Your own number for more than enough.',
};

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'] as const;

export type RowState = 'reached' | 'current' | 'later';

export const PILLS: Readonly<Record<RowState, string>> = {
  reached: 'Reached',
  current: "You're here",
  later: 'Later',
};

/** One circle's row. */
export interface LedgerRow {
  circle: CircleNumber;
  name: string;
  /** guidance.md 5.4's one-liner. */
  line: string;
  state: RowState;
  pill: string;
  /** The person's own figure; null where there is none to show yet. */
  key: string | null;
  detail: string | null;
  /** How far the ring is drawn, 0 to 1; null when the figure is not known. */
  measure: number | null;
  /** Circle 1 short of a year: the months on file, drawn as twelve segments. */
  months: number | null;
  /** The row link's name: the glyph is hidden, so this carries it. */
  label: string;
}

/** The lines over the rows. */
export interface LedgerStatus {
  /** "Circle 4 of 7"; "For now: 7 of 12 months" before a year is on file; "All seven reached". */
  meta: string;
  /** "You're in the fourth circle: Solid ground." */
  line: string;
  /** What stands between the person and the circle they are in, or why it is not known yet. */
  sub: string | null;
  /** Under the rows, until three months give averages: "Your figures appear once ...". */
  waiting: string | null;
}

/** Floored to one decimal: "2.9", and "3" for 3.0. */
export function monthsText(months: number): string {
  const floored = Math.floor(months * 10) / 10;
  return Number.isInteger(floored) ? String(floored) : floored.toFixed(1);
}

/** A share of a target in percent: floored and below 100 while not met, rounded once met. */
export function shareOf(value: number, target: number, met: boolean): number {
  if (!(target > 0)) return met ? 100 : 0;
  const share = (value / target) * 100;
  return met ? Math.round(share) : Math.max(0, Math.min(99, Math.floor(share)));
}

/** A gap in whole units, rounded up, never below 1 while there is one. */
export function gapOf(target: number, value: number): number {
  return Math.max(1, Math.ceil(target - value));
}

/** A rate as written: "19.9", "4". */
export function rateText(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}

const checkOf = (place: CirclePlace, id: CheckId): Check | undefined =>
  place.checks.find((check) => check.id === id);

const stateOf = (place: CirclePlace, placement: Placement): RowState =>
  place.reached ? 'reached' : place.circle === placement.current ? 'current' : 'later';

/** The first debt at the line or above, as the debt check names it. */
export function firstExpensive(facts: GuidanceFacts): Debt | undefined {
  return facts.debts.find((debt) => debt.expensive === true);
}

/** What a debt is called: its own name, else what it is. */
export function debtName(debt: Debt): string {
  if (debt.name) return debt.name;
  return debt.kind === 'loan' ? 'A loan' : debt.kind === 'card' ? 'A card' : 'An overdraft';
}

/** "Couldn't read your accounts", for a figure that reads them while they did not load. */
const UNREAD = "Couldn't read your accounts";
/** No savings, cash or current account on file. */
const NO_ACCOUNT = 'No account to count yet';
const NOTHING_NEEDED = 'Nothing is marked as needed every month';

/** The cushion rows' figure when the cushion cannot be counted, or null when it can. */
function cushionUnknown(facts: GuidanceFacts): string | null {
  if (!facts.accountsKnown) return UNREAD;
  if (facts.liquid === null) return NO_ACCOUNT;
  return null;
}

function clearPicture(facts: GuidanceFacts, place: CirclePlace, state: RowState) {
  const months = facts.monthsInYear;
  const sorted = checkOf(place, 'sorted');
  const share = facts.sortedShare;
  const shareWords =
    share === null ? null : `${shareOf(share, 100, sorted?.met === true && share >= 100)}%`;
  return {
    key: `${Math.min(months, 12)} of 12 months on file`,
    detail:
      shareWords === null
        ? null
        : state === 'current'
          ? `${shareWords} of spending sorted; ${SORTED_SHARE}% is needed.`
          : `${shareWords} of spending sorted.`,
    measure: months < 12 ? months / 12 : share === null ? null : Math.min(1, share / SORTED_SHARE),
    months: months < 12 ? months : null,
  };
}

function payingYourWay(facts: GuidanceFacts, place: CirclePlace, words: LedgerWords) {
  const check = checkOf(place, 'own-income');
  const { ownIncome, spending, income } = facts;
  if (ownIncome === null || spending === null || !(spending > 0)) {
    return { key: null, detail: null, measure: null };
  }
  const viaInvested = check?.via === 'work-optional';
  const support = income !== null ? income - ownIncome : 0;
  let detail = `${words.money(Math.round(income ?? ownIncome))} in, ${words.money(Math.round(spending))} out a month.`;
  if (viaInvested) detail += ' Your investments could cover it, which counts too.';
  else if (support >= 0.5) {
    detail += ` ${words.money(Math.round(support))} a month you marked as support is left out.`;
  }
  return {
    key: `Own income covers ${shareOf(Math.max(0, ownIncome), spending, ownIncome >= spending)}% of spending`,
    detail,
    measure: Math.max(0, Math.min(1, ownIncome / spending)),
  };
}

function breathingRoom(facts: GuidanceFacts, place: CirclePlace, words: LedgerWords) {
  const check = checkOf(place, 'first-cushion');
  const unknown = cushionUnknown(facts);
  if (unknown !== null && check?.met !== true) return { key: unknown, detail: null, measure: null };
  const months = facts.cushionMonths;
  if (months === null) return { key: null, detail: null, measure: null };
  if (months === Infinity) return { key: NOTHING_NEEDED, detail: null, measure: 1 };
  const key =
    months < 1
      ? `${Math.floor(months * DAYS_IN_A_MONTH)} days of essentials`
      : `${monthsText(months)} ${monthsText(months) === '1' ? 'month' : 'months'} of essentials`;
  return {
    key,
    detail: reachDetail(facts, words),
    measure: Math.max(0, Math.min(1, months / FIRST_CUSHION_MONTHS)),
  };
}

/** "{liquid} you can reach, against {essentials} needed a month." */
function reachDetail(facts: GuidanceFacts, words: LedgerWords): string | null {
  if (facts.liquid === null) return null;
  const reach = words.money(Math.round(facts.liquid));
  if (facts.unsure.all && facts.spending !== null) {
    return `${reach} you can reach, against ${words.money(Math.round(facts.spending))} spent a month.`;
  }
  if (facts.essentials === null) return null;
  return `${reach} you can reach, against ${words.money(Math.round(facts.essentials))} needed a month.`;
}

/** Solid ground's debt sentence: no debt at the line, the first one at it, or the answer it waits on. */
export function debtSentence(facts: GuidanceFacts, place: CirclePlace): string | null {
  const check = checkOf(place, 'no-expensive-debt');
  if (!check) return null;
  if (check.met === true) return 'No debt at 10% or more.';
  if (check.unknown === 'unread')
    return "The debt check waits on your accounts, which didn't load.";
  if (check.unknown === 'not-on-file') return 'The debt check waits on one answer.';
  const debt = firstExpensive(facts);
  if (!debt) return null;
  return debt.rate === null
    ? `${debtName(debt)} comes first: no rate is set for it.`
    : `${debtName(debt)} at ${rateText(debt.rate)}% comes first.`;
}

function solidGround(facts: GuidanceFacts, place: CirclePlace, words: LedgerWords) {
  const check = checkOf(place, 'solid-cushion');
  const sentences: string[] = [];
  const debt = debtSentence(facts, place);
  if (debt) sentences.push(debt);
  if (facts.yearlyBills) {
    sentences.push(
      `Yearly bills: about ${words.money(Math.ceil(facts.yearlyBills.perMonth))} a month to set aside.`
    );
  }
  const detail = sentences.length > 0 ? sentences.join(' ') : null;
  const unknown = cushionUnknown(facts);
  if (unknown !== null && check?.met !== true) return { key: unknown, detail, measure: null };
  const months = facts.cushionMonths;
  if (months === null || facts.essentials === null || facts.liquid === null) {
    return { key: null, detail, measure: null };
  }
  if (months === Infinity) return { key: NOTHING_NEEDED, detail, measure: 1 };
  const key =
    check?.met === true
      ? `${monthsText(months)} months put by`
      : `${monthsText(months)} of 3 months: ${words.money(gapOf(SOLID_CUSHION_MONTHS * facts.essentials, facts.liquid))} to go`;
  return { key, detail, measure: Math.max(0, Math.min(1, months / SOLID_CUSHION_MONTHS)) };
}

/** "{value} of {target}: {pct}%", or the target alone at zero. */
function towards(
  check: Check | undefined,
  facts: GuidanceFacts,
  words: LedgerWords,
  atZero: (target: string) => string
) {
  if (!check || check.target === null || check.value === null) return null;
  const target = words.money(Math.round(check.target));
  if (!(check.value > 0)) return { key: atZero(target), measure: 0 };
  const met = check.met === true;
  return {
    key: `${words.money(Math.round(check.value))} of ${target}: ${shareOf(check.value, check.target, met)}%`,
    measure: Math.max(0, Math.min(1, check.value / check.target)),
  };
}

function roomToChoose(facts: GuidanceFacts, place: CirclePlace, words: LedgerWords) {
  const check = checkOf(place, 'two-years');
  if (check?.unknown === 'unread') return { key: UNREAD, detail: null, measure: null };
  const figure = towards(check, facts, words, (target) => `Two years of spending: ${target}`);
  return {
    key: figure?.key ?? null,
    detail: figure ? 'Invested, plus money in reach beyond six months of essentials.' : null,
    measure: figure?.measure ?? null,
  };
}

function workOptional(facts: GuidanceFacts, place: CirclePlace, words: LedgerWords) {
  const check = checkOf(place, 'work-optional');
  if (check?.unknown === 'unread') return { key: UNREAD, detail: null, measure: null };
  const years = 100 / facts.withdrawalRatePct;
  const figure = towards(
    check,
    facts,
    words,
    (target) => `${monthsText(years)} years of spending: ${target}`
  );
  return {
    key: figure?.key ?? null,
    detail: figure
      ? `Invested, so taking ${rateText(facts.withdrawalRatePct)}% a year would cover what you spend.`
      : null,
    measure: figure?.measure ?? null,
  };
}

function moreThanEnough(
  facts: GuidanceFacts,
  place: CirclePlace,
  placement: Placement,
  words: LedgerWords
) {
  const check = checkOf(place, 'enough');
  if (facts.enoughPerYear === null) {
    return {
      key: 'Your own number',
      detail:
        placement.current === 7
          ? 'What would a year of more than enough cost?'
          : 'Asked once you reach Work optional.',
      measure: null,
    };
  }
  if (check?.unknown === 'unread') return { key: UNREAD, detail: null, measure: null };
  const figure = towards(check, facts, words, (target) => `Your own number: ${target}`);
  return {
    key: figure?.key ?? null,
    detail: `A year of more than enough: ${words.money(Math.round(facts.enoughPerYear))}.`,
    measure: figure?.measure ?? null,
  };
}

/** The seven rows, in order. */
export function ledgerRows(
  placement: Placement,
  facts: GuidanceFacts,
  words: LedgerWords
): LedgerRow[] {
  return placement.circles.map((place) => {
    const state = stateOf(place, placement);
    const name = CIRCLE_NAMES[place.circle];
    const line = CIRCLE_LINES[place.circle];
    let figure: { key: string | null; detail: string | null; measure: number | null };
    let months: number | null = null;
    if (place.circle === 1) {
      const first = clearPicture(facts, place, state);
      figure = first;
      months = first.months;
    } else if (!facts.averaged) {
      // Before three months, rows 2 to 7 have no figures: one line under the rows says so.
      figure = { key: null, detail: null, measure: null };
    } else if (place.circle === 2) figure = payingYourWay(facts, place, words);
    else if (place.circle === 3) figure = breathingRoom(facts, place, words);
    else if (place.circle === 4) figure = solidGround(facts, place, words);
    else if (place.circle === 5) figure = roomToChoose(facts, place, words);
    else if (place.circle === 6) figure = workOptional(facts, place, words);
    else figure = moreThanEnough(facts, place, placement, words);
    const pill = PILLS[state];
    return {
      circle: place.circle,
      name,
      line,
      state,
      pill,
      key: figure.key,
      detail: figure.detail,
      measure: figure.measure,
      months,
      label: `${name}. ${pill}. ${figure.key ?? line.replace(/\.$/, '')}.`,
    };
  });
}

/** The phrase for the gap to a circle's first unmet required check (sub-line rule d). */
function gapPhrase(check: Check, facts: GuidanceFacts, words: LedgerWords): string | null {
  const { value, target } = check;
  switch (check.id) {
    case 'sorted':
      return value === null
        ? null
        : `${shareOf(value, 100, false)}% of your spending has a category. Clear picture needs ${SORTED_SHARE}%.`;
    case 'own-income':
      return value === null || target === null
        ? null
        : `${words.money(gapOf(target, value))} a month short of covering what you spend.`;
    case 'first-cushion':
      return facts.essentials === null || facts.liquid === null
        ? null
        : `${words.money(gapOf(FIRST_CUSHION_MONTHS * facts.essentials, facts.liquid))} to a month of essentials.`;
    case 'no-expensive-debt': {
      const n = facts.debts.filter((debt) => debt.expensive === true).length;
      return n === 1
        ? 'One debt at 10% or more comes first.'
        : `${n} debts at 10% or more come first.`;
    }
    case 'solid-cushion':
      return facts.essentials === null || facts.liquid === null
        ? null
        : `${words.money(gapOf(SOLID_CUSHION_MONTHS * facts.essentials, facts.liquid))} to three months of essentials.`;
    case 'two-years':
      return value === null || target === null
        ? null
        : `${words.money(gapOf(target, value))} to two years of spending.`;
    case 'work-optional':
      return value === null || target === null
        ? null
        : `${words.money(gapOf(target, value))} to ${words.money(Math.round(target))}, which at ${rateText(facts.withdrawalRatePct)}% a year covers what you spend.`;
    case 'enough':
      return value === null || target === null
        ? null
        : `${words.money(gapOf(target, value))} to ${words.money(Math.round(target))}, your own number.`;
    default:
      return null;
  }
}

/** Whether a check not known waits on the person's answer, rather than on an account. */
export function waitsOnAnswer(check: Check): boolean {
  return (
    check.unknown === 'not-on-file' &&
    (check.id === 'no-expensive-debt' ||
      check.id === 'enough' ||
      check.id === 'free-money' ||
      check.id === 'yearly-bills')
  );
}

/** The divider's meta, the "You're in" line, the sub-line, and the line under the rows. */
export function ledgerStatus(
  placement: Placement,
  facts: GuidanceFacts,
  words: LedgerWords
): LedgerStatus {
  const current = placement.current;
  const months = facts.months.length;
  const waiting = facts.averaged
    ? null
    : `Your figures appear once 3 months are tracked.${months === 1 ? ' One is so far.' : months === 2 ? ' Two are so far.' : ''}`;
  if (current === null) {
    return {
      meta: 'All seven reached',
      line: "You've reached all seven circles.",
      sub: null,
      waiting,
    };
  }
  const place = placement.circles[current - 1];
  const line = `You're in the ${ORDINALS[current - 1]} circle: ${CIRCLE_NAMES[current]}.`;
  const meta = facts.firm
    ? `Circle ${current} of 7`
    : `For now: ${Math.min(facts.monthsInYear, 12)} of 12 months`;
  return { meta, line, sub: subLine(place, facts, words), waiting };
}

function subLine(place: CirclePlace, facts: GuidanceFacts, words: LedgerWords): string | null {
  if (!facts.firm) {
    return "Circles firm up once a full year is here. For now, here's what we can see.";
  }
  const required = place.checks.filter((check) => check.required);
  if (required.some((check) => check.unknown === 'unread')) {
    return "Your accounts didn't load, so the checks that read them are waiting. Reload to try again.";
  }
  const answers = required.filter(waitsOnAnswer).length;
  if (answers === 1) return 'One check waits on your answer.';
  if (answers > 1) return `${answers} checks wait on your answers.`;
  if (required.some((check) => check.unknown === 'not-on-file') && facts.liquid === null) {
    return 'None of your accounts holds money you can reach yet, so the cushion checks are waiting.';
  }
  const first = required.find((check) => check.met === false);
  return first ? gapPhrase(first, facts, words) : null;
}
