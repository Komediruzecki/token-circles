/**
 * The questions the circles ask once, each where its answer is first needed (guidance.md 5.5), in
 * the words the circle view, Your next step and Settings share. Every answer is kept in the
 * answers record (answers.ts) and can be changed in Settings, About this space.
 */
import type { FreeMoneyAnswer, TenureAnswer } from './answers';

/** Under a question in Your next step and the circle view. */
export const ASKED_ONCE = 'Asked once. You can change it in Settings, About this space.';

/** An answer that did not save, wherever it was given. */
export const SAVE_FAILED = "Couldn't save your answer. Try again.";

/** The questions with chips. */
export type QuestionId = 'card' | 'yearly-bills' | 'free-money' | 'enough';

export const CARD_QUESTION = 'Do you carry a balance on a credit card or overdraft?';
export const CARD_OPTIONS: readonly { label: string; answer: boolean }[] = [
  { label: 'No', answer: false },
  { label: 'Yes', answer: true },
];

export const YEARLY_BILLS_QUESTION = 'Do you set aside money for yearly bills each month?';
export const YEARLY_BILLS_OPTIONS: readonly { label: string; answer: boolean }[] = [
  { label: 'Yes', answer: true },
  { label: 'Not yet', answer: false },
];

export const ENOUGH_QUESTION = 'What would a year of more than enough cost?';

/** Circle 4's view asks it under the yearly-bills check, whose detail names the bills. */
export const YEARLY_BILLS_ASIDE = 'Do you set this aside each month?';

/** Circle 2's view, under Your numbers: ticks per income category. Never a next step. */
export const SUPPORT_QUESTION =
  'Is any of your income support you expect to stop, from family for example?';
export const SUPPORT_HINT = 'Tick each one that is. Own income is counted without them.';

/** Circles 3 and 4, under Your numbers, while some spending counts as needed by default. */
export const ESSENTIALS_QUESTION = 'Which of these do you need every month, whatever happens?';
export const ESSENTIALS_HINT =
  'Your cushion is counted in months of these. Each choice is kept with its category on Categories.';

/** Circle 5's view, under Your numbers. */
export const SAVED_ELSEWHERE_QUESTION =
  "Do you have pension or investment savings that aren't in Token Circles?";
export const SAVED_ELSEWHERE_OPTIONS: readonly { label: string; answer: boolean }[] = [
  { label: 'No', answer: false },
  { label: 'Yes', answer: true },
];
export const SAVED_ELSEWHERE_HINT = 'Counted as invested, at the amount you give.';

/**
 * Whether this build carries the copy the benchmarks gate holds back
 * (frontend/src/core/guidanceGate.ts): the frontend's build defines __BENCHMARKS_SHOWN__ by the
 * gate's own test, so a production build compiles that copy out. Where nothing defines it (the
 * Worker, tests), the copy is there.
 */
declare const __BENCHMARKS_SHOWN__: boolean | undefined;
const HELD_BACK_COPY = typeof __BENCHMARKS_SHOWN__ === 'undefined' || __BENCHMARKS_SHOWN__;

/** The housing card asks it while it has no answer (the benchmarks gate holds both back). */
export const TENURE_QUESTION = HELD_BACK_COPY ? 'How do you live?' : '';
export const TENURE_HINT = HELD_BACK_COPY
  ? 'Renting and owning are compared with different figures.'
  : '';

/**
 * The answers to "How do you live?" where `region` is compared with: the UK's figures tell private
 * and social renters apart, so only there is social housing a choice of its own (and wherever it is
 * the answer on file).
 */
export function tenureOptions(
  region: string,
  answered?: TenureAnswer
): readonly { label: string; answer: TenureAnswer }[] {
  if (!HELD_BACK_COPY) return [];
  const renting: { label: string; answer: TenureAnswer }[] =
    region === 'UK' || answered === 'rentSocial'
      ? [
          { label: 'Rent privately', answer: 'rentPrivate' },
          { label: 'Rent social housing', answer: 'rentSocial' },
        ]
      : [{ label: 'Rent', answer: 'rentPrivate' }];
  return [
    ...renting,
    { label: 'Own with a mortgage', answer: 'mortgage' },
    { label: 'Own outright', answer: 'outright' },
    { label: 'Live with family', answer: 'family' },
  ];
}

/** The amount forms' errors. */
export const AMOUNT_ABOVE_ZERO = 'Enter an amount above 0.';
export const ENOUGH_ABOVE_ZERO = 'Enter what a year would cost, above 0.';
export const AMOUNT_TOO_BIG = 'Enter an amount under 1,000,000,000,000.';

/** The free-money question for one region (guidance.md 5.5), and what its step is called. */
export interface FreeMoneyQuestion {
  /** The next step's title, and the check's in the circle view. */
  title: string;
  /** The check's name in the circle view. */
  check: string;
  question: string;
  options: readonly { label: string; answer: FreeMoneyAnswer }[];
}

/** None where the build leaves the gate's copy out (HELD_BACK_COPY): no free money is asked there. */
export const FREE_MONEY_QUESTIONS: Readonly<
  Partial<Record<'DE' | 'HR' | 'UK' | 'US', FreeMoneyQuestion>>
> = !HELD_BACK_COPY
  ? {}
  : {
      DE: {
        title: 'Check the free money your employer adds',
        check: 'Free money from your employer',
        question:
          'Does your employer offer a company pension through salary conversion (Entgeltumwandlung)? By law, your employer adds 15% of what you convert, where it saves social contributions.',
        options: [
          { label: 'I use it', answer: 'taken' },
          { label: 'Offered, not using it', answer: 'not-taken' },
          { label: 'Not offered', answer: 'not-offered' },
          { label: 'Not sure', answer: 'not-sure' },
        ],
      },
      HR: {
        title: "Check the state's top-up",
        check: "The state's pension top-up",
        question:
          'Do you pay into a voluntary pension fund (treći stup)? The state adds 15% of up to EUR 663.61 a year, at most EUR 99.54.',
        options: [
          { label: 'Yes', answer: 'taken' },
          { label: 'No', answer: 'not-taken' },
          { label: 'Not sure', answer: 'not-sure' },
        ],
      },
      UK: {
        title: 'Check your workplace pension',
        check: 'Your workplace pension',
        question:
          "Are you in your workplace pension? While you're enrolled, your employer pays at least 3% of qualifying earnings.",
        options: [
          { label: 'Yes', answer: 'taken' },
          { label: 'I opted out', answer: 'not-taken' },
          { label: 'Not sure', answer: 'not-sure' },
        ],
      },
      US: {
        title: "Check your employer's match",
        check: "Your employer's match",
        question:
          'Does your employer match what you put into a retirement plan? Contributing enough to get the full match is the step most guides put before extra debt payments.',
        options: [
          { label: 'Yes, all of it', answer: 'taken' },
          { label: 'Some of it', answer: 'partly' },
          { label: 'No match', answer: 'not-offered' },
          { label: 'Not sure', answer: 'not-sure' },
        ],
      },
    };

/** The free-money question for `region`, or null where none is asked. */
export function freeMoneyQuestion(region: string): FreeMoneyQuestion | null {
  return region === 'DE' || region === 'HR' || region === 'UK' || region === 'US'
    ? (FREE_MONEY_QUESTIONS[region] ?? null)
    : null;
}

/** The guidance line: under the questions about money a person might put away, and on each view. */
export const GUIDANCE_LINE =
  'Token Circles explains and calculates. It does not give financial advice. For decisions about investments, loans or pensions, talk to a licensed adviser.';
