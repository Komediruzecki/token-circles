/**
 * The questions the circles ask once, each where its answer is first needed (guidance.md 5.5), in
 * the words the circle view, Your next step and Settings share. Every answer is kept in the
 * answers record (answers.ts) and can be changed in Settings, About this space.
 */
import type { FreeMoneyAnswer } from './answers';

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

/** The free-money question for one region (guidance.md 5.5), and what its step is called. */
export interface FreeMoneyQuestion {
  /** The next step's title, and the check's in the circle view. */
  title: string;
  /** The check's name in the circle view. */
  check: string;
  question: string;
  options: readonly { label: string; answer: FreeMoneyAnswer }[];
}

export const FREE_MONEY_QUESTIONS: Readonly<Record<'DE' | 'HR' | 'UK' | 'US', FreeMoneyQuestion>> =
  {
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
    ? FREE_MONEY_QUESTIONS[region]
    : null;
}

/** The guidance line: under the questions about money a person might put away, and on each view. */
export const GUIDANCE_LINE =
  'Token Circles explains and calculates. It does not give financial advice. For decisions about investments, loans or pensions, talk to a licensed adviser.';
