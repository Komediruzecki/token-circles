/**
 * The answers a person gives the guidance, one record per profile.
 *
 * The record is JSON text in the profile's settings under `guidance`; local-first names the profile
 * in the key, `guidance:<profile id>` (shared/profileSettings.ts). It has no route of its own and
 * no column per question: `PUT /api/settings` stores it, and refuses one that is not well formed
 * (readSetting in shared/settingsSchema.ts), in both runtimes.
 *
 * Setup asks two questions, at "Name your space":
 *
 * - `region`: where the person lives, for the official figures their numbers are compared with.
 *   DE, HR, EU27 ("another EU country"), UK or US; `elsewhere` for somewhere else, compared with
 *   the EU average; or `skipped` when they chose not to say.
 * - `adults` and `children`: who the space covers. 3 stands for three or more.
 *
 * The circles ask the rest, each when its answer is first needed (guidance.md section 5.5):
 *
 * - `supportCategoryIds`: the income categories that are support the person expects to stop.
 * - `carriesCardBalance`: whether they carry a balance on a credit card or overdraft.
 * - `freeMoney`: the free money an employer or the state adds, with the region it was asked for, as
 *   the question names that region's scheme.
 * - `setsAsideYearly`: whether they set the yearly bills on Bills aside each month.
 * - `savedElsewhere`: pension or investment savings outside the app, with the currency they were
 *   given in. 0 is "No".
 * - `enoughPerYear`: what a year of more than enough would cost, with its currency.
 * - `tenure`: how the household lives, for the housing figures.
 * - `kindsAsked`: the essentials question was answered, so it is not asked again.
 * - `savingsGoal`: the savings rate the person aims for, in percent, on Dashboard.
 *
 * An answer counts only while it still applies (`factsAnswersOf`): free money while the region is the
 * one it was asked for, and an amount while the base currency is the one it was given in. Otherwise
 * the question shows again, with the old answer filled in.
 *
 * Later questions add fields of their own, so the record keeps what it cannot read:
 *
 * - **A field this build does not know is kept as it is**, by the reader and by every write. A
 *   newer build's answers survive a write from this one.
 * - **A value this build cannot read is kept, and reads as unanswered.** A write checks that each
 *   field this build knows is well formed (a region is a short id, a count a whole number), not that
 *   this build knows the value: a newer build may add a region, and a record holding it must not
 *   stop an older build, in an old tab or after a rollback, from saving another answer.
 * - **Every write merges into the freshest read** (`mergeAnswers`): the app re-reads the record and
 *   changes only the fields being answered, so two tabs answering different questions keep both.
 * - **The stored text is at most 4 KB** (`ANSWERS_MAX_BYTES`).
 *
 * Pure and hand-written, as the Worker imports it and `shared/` has no zod.
 */
import { MONEY_MAX } from '../fieldReaders';
import type { FactsAnswers } from './facts';

/** The answers to "Where do you live?": the places compared with, and the two that name none. */
export const REGION_ANSWERS = ['DE', 'HR', 'EU27', 'UK', 'US', 'elsewhere', 'skipped'] as const;
export type RegionAnswer = (typeof REGION_ANSWERS)[number];

/**
 * The answers to the free-money question (guidance.md 5.5), across the four regions that ask it:
 * taken in full, taken in part (the US match, "Some of it"), not taken, none on offer, not sure.
 */
export const FREE_MONEY_ANSWERS = [
  'taken',
  'partly',
  'not-taken',
  'not-offered',
  'not-sure',
] as const;
export type FreeMoneyAnswer = (typeof FREE_MONEY_ANSWERS)[number];

/**
 * The answers to "How do you live?" (guidance.md 5.5): the benchmarks' tenures, with living with
 * family and a skipped question beside them.
 */
export const TENURE_ANSWERS = [
  'rentPrivate',
  'rentSocial',
  'mortgage',
  'outright',
  'family',
  'skipped',
] as const;
export type TenureAnswer = (typeof TENURE_ANSWERS)[number];

/** The most adults or children the household question offers: 3 stands for three or more. */
export const HOUSEHOLD_MOST = 3;

/** The largest stored record, in bytes of its JSON text. */
export const ANSWERS_MAX_BYTES = 4096;

/** The most support categories one record lists. */
export const SUPPORT_CATEGORIES_MOST = 100;

/** An amount the person gave, in the currency they gave it in. */
export interface AnswerAmount {
  amount: number;
  /** An ISO 4217 code, like EUR. */
  currency: string;
}

/** The answer to the free-money question, and the region whose scheme it named. */
export interface FreeMoneyAnswered {
  region: string;
  answer: FreeMoneyAnswer;
}

/** The answers this build reads. A field it does not know, or a value it cannot read, is absent. */
export interface Answers {
  region?: RegionAnswer;
  /** At least 1. */
  adults?: number;
  /** At least 0. */
  children?: number;
  /** Income category ids. */
  supportCategoryIds?: number[];
  carriesCardBalance?: boolean;
  freeMoney?: FreeMoneyAnswered;
  setsAsideYearly?: boolean;
  /** 0 is "No". */
  savedElsewhere?: AnswerAmount;
  /** Above 0. */
  enoughPerYear?: AnswerAmount;
  tenure?: TenureAnswer;
  kindsAsked?: boolean;
  /** In percent, 0 to 100. */
  savingsGoal?: number;
}

/** The fields this build knows. */
export const ANSWER_FIELDS = [
  'region',
  'adults',
  'children',
  'supportCategoryIds',
  'carriesCardBalance',
  'freeMoney',
  'setsAsideYearly',
  'savedElsewhere',
  'enoughPerYear',
  'tenure',
  'kindsAsked',
  'savingsGoal',
] as const satisfies readonly (keyof Answers)[];

/** The stored record: every field, the ones this build reads and the ones it does not. */
export type AnswersRecord = Record<string, unknown>;

/** A change to the answers: a field set to its new answer, or to null to clear it ("Remove answer"). */
export type AnswerChanges = { [K in keyof Answers]?: Answers[K] | null };

/** The words for each refusal. */
export const ANSWERS_MESSAGES = {
  record: 'Send the answers as the JSON text of one object, like {"region": "DE"}.',
  size: 'Keep the answers to 4 KB or less.',
  region: 'Use a short id for the region, like DE or EU27.',
  adults: 'Use a whole number from 1 to 99 for the adults.',
  children: 'Use a whole number from 0 to 99 for the children.',
  supportCategoryIds: 'List the support categories by their ids, like [12, 15], up to 100 of them.',
  carriesCardBalance: 'Answer whether you carry a card balance with true or false.',
  freeMoney:
    'Send the free money answer with its region, like {"region": "DE", "answer": "taken"}.',
  setsAsideYearly: 'Answer whether you set yearly bills aside with true or false.',
  savedElsewhere:
    'Send the savings held elsewhere as an amount and a currency, like {"amount": 5000, "currency": "EUR"}.',
  enoughPerYear:
    'Send a year of more than enough as an amount above 0 and a currency, like {"amount": 60000, "currency": "EUR"}.',
  tenure: 'Use a short id for how you live, like rentPrivate.',
  kindsAsked: 'Answer whether the essentials question was answered with true or false.',
  savingsGoal: 'Use a savings goal from 0 to 100 percent.',
} as const;

/** A count a write accepts: a whole number in range. 99 bounds it; the questions offer 3. */
const COUNT_MOST = 99;
const SHORT_ID = /^[A-Za-z0-9_-]{1,32}$/;
const CURRENCY = /^[A-Z]{3}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown, least: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= least && value <= COUNT_MOST
  );
}

const isShortId = (value: unknown): value is string =>
  typeof value === 'string' && SHORT_ID.test(value);

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** An amount with its currency, from 0 (or above 0, when `positive`) to below `MONEY_MAX`. */
function isAmount(value: unknown, positive: boolean): value is AnswerAmount {
  if (!isPlainObject(value)) return false;
  const { amount, currency } = value;
  return (
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    (positive ? amount > 0 : amount >= 0) &&
    amount < MONEY_MAX &&
    typeof currency === 'string' &&
    CURRENCY.test(currency)
  );
}

function isSupportList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= SUPPORT_CATEGORIES_MOST && value.every(isId);
}

function isGoal(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * The stored record, from the setting's JSON text. Anything that is not one object, including no
 * record at all, reads as an empty one.
 */
export function answersRecord(stored: unknown): AnswersRecord {
  let value: unknown = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      return {};
    }
  }
  return isPlainObject(value) ? { ...value } : {};
}

/** The answers this build reads in a stored record, or in no record at all. */
export function readAnswers(stored: unknown): Answers {
  const record = answersRecord(stored);
  const answers: Answers = {};
  if (isOneOf(record.region, REGION_ANSWERS)) answers.region = record.region;
  if (isCount(record.adults, 1)) answers.adults = record.adults;
  if (isCount(record.children, 0)) answers.children = record.children;
  if (isSupportList(record.supportCategoryIds)) {
    answers.supportCategoryIds = [...record.supportCategoryIds];
  }
  if (typeof record.carriesCardBalance === 'boolean') {
    answers.carriesCardBalance = record.carriesCardBalance;
  }
  const free = record.freeMoney;
  if (isPlainObject(free) && isShortId(free.region) && isOneOf(free.answer, FREE_MONEY_ANSWERS)) {
    answers.freeMoney = { region: free.region, answer: free.answer };
  }
  if (typeof record.setsAsideYearly === 'boolean') answers.setsAsideYearly = record.setsAsideYearly;
  if (isAmount(record.savedElsewhere, false)) {
    const { amount, currency } = record.savedElsewhere;
    answers.savedElsewhere = { amount, currency };
  }
  if (isAmount(record.enoughPerYear, true)) {
    const { amount, currency } = record.enoughPerYear;
    answers.enoughPerYear = { amount, currency };
  }
  if (isOneOf(record.tenure, TENURE_ANSWERS)) answers.tenure = record.tenure;
  if (typeof record.kindsAsked === 'boolean') answers.kindsAsked = record.kindsAsked;
  if (isGoal(record.savingsGoal)) answers.savingsGoal = record.savingsGoal;
  return answers;
}

/**
 * The stored record with `changes` made: a field in `changes` is set, or removed when it is null.
 * Every other field stays as stored, the ones this build reads and the ones it does not.
 */
export function mergeAnswers(stored: unknown, changes: AnswerChanges): AnswersRecord {
  const record = answersRecord(stored);
  for (const field of ANSWER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;
    const value = changes[field];
    if (value === undefined) continue;
    if (value === null) delete record[field];
    else record[field] = value;
  }
  return record;
}

/**
 * Whether a field this build knows is well formed. Well formed is the shape, not a value this
 * build knows: a short id for a region, a tenure or a free-money answer, so that a newer build's
 * values are stored.
 */
function wellFormed(field: (typeof ANSWER_FIELDS)[number], value: unknown): boolean {
  switch (field) {
    case 'region':
    case 'tenure':
      return isShortId(value);
    case 'adults':
      return isCount(value, 1);
    case 'children':
      return isCount(value, 0);
    case 'supportCategoryIds':
      return isSupportList(value);
    case 'carriesCardBalance':
    case 'setsAsideYearly':
    case 'kindsAsked':
      return typeof value === 'boolean';
    case 'freeMoney':
      return isPlainObject(value) && isShortId(value.region) && isShortId(value.answer);
    case 'savedElsewhere':
      return isAmount(value, false);
    case 'enoughPerYear':
      return isAmount(value, true);
    case 'savingsGoal':
      return isGoal(value);
  }
}

/**
 * The text `PUT /api/settings` stores for a record, as it was sent, or why it is refused: it is
 * not the JSON text of one object, it is over 4 KB, or a field this build knows is not well formed.
 * A field it does not know is not checked, and a field sent as null is unanswered.
 */
export function checkAnswers(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const refuse = (error: string) => ({ ok: false as const, error });
  if (typeof raw !== 'string') return refuse(ANSWERS_MESSAGES.record);
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > ANSWERS_MAX_BYTES) return refuse(ANSWERS_MESSAGES.size);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(ANSWERS_MESSAGES.record);
  }
  if (!isPlainObject(parsed)) return refuse(ANSWERS_MESSAGES.record);
  for (const field of ANSWER_FIELDS) {
    const value = parsed[field];
    if (value === undefined || value === null) continue;
    if (!wellFormed(field, value)) return refuse(ANSWERS_MESSAGES[field]);
  }
  return { ok: true, value: raw };
}

/**
 * A stored record with its support categories under the ids `moved` gives them (old id to new), for
 * a restore that gives categories new ids, as the Worker's does. An id with no new one is left out.
 * Every other field is kept, and a record with no support list, or one that cannot be read, comes
 * back as it was.
 */
export function withSupportCategoriesMoved(
  stored: unknown,
  moved: ReadonlyMap<number, number>
): unknown {
  const record = answersRecord(stored);
  const listed = record.supportCategoryIds;
  if (!Array.isArray(listed)) return stored;
  record.supportCategoryIds = listed.flatMap((id: unknown) => {
    const now = typeof id === 'number' ? moved.get(id) : undefined;
    return now === undefined ? [] : [now];
  });
  return typeof stored === 'string' ? JSON.stringify(record) : record;
}

/** Where the answers are read: the region compared with, and the base currency. */
export interface AnswersContext {
  region: string;
  currency: string;
}

/**
 * What the circles read of the answers (facts.ts `FactsAnswers`), each only while it still
 * applies: free money while `region` is the one it was asked for, and an amount while `currency`
 * is the one it was given in. An answer that no longer applies reads as unanswered, so its
 * question shows again.
 */
export function factsAnswersOf(answers: Answers, at: AnswersContext): FactsAnswers {
  const inCurrency = (given: AnswerAmount | undefined): number | null =>
    given !== undefined && given.currency === at.currency ? given.amount : null;
  return {
    supportCategoryIds: answers.supportCategoryIds ?? null,
    carriesCardBalance: answers.carriesCardBalance ?? null,
    freeMoney: answers.freeMoney?.region === at.region ? answers.freeMoney.answer : null,
    savedElsewhere: inCurrency(answers.savedElsewhere),
    enoughPerYear: inCurrency(answers.enoughPerYear),
    setsAsideYearly: answers.setsAsideYearly ?? null,
  };
}
