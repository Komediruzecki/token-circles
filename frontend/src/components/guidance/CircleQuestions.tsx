/**
 * The questions the circles ask (design.md 1.8, guidance.md 5.5), as a circle's view asks them and
 * as Settings, About this space shows the answers: each takes the answers on file and saves a
 * change through `onSave`, which answers true once it is saved. A choice shows at once and goes
 * back if the save fails.
 *
 * An amount given in another currency than the base one is left out of the circles
 * (answers.ts `factsAnswersOf`); the question shows it filled in, to save again in the base one.
 */
import { createSignal, Show } from 'solid-js'
import {
  AMOUNT_ABOVE_ZERO,
  ENOUGH_ABOVE_ZERO,
  SAVED_ELSEWHERE_HINT,
  SAVED_ELSEWHERE_OPTIONS,
  SAVED_ELSEWHERE_QUESTION,
} from '../../../../shared/guidance/questions'
import { formatWholeCurrency } from '../../core/api'
import { AmountForm, Choices, Question } from './questionParts'
import styles from './Questions.module.css'
import type { JSX } from 'solid-js'
import type { AnswerAmount, AnswerChanges } from '../../../../shared/guidance/answers'

/** Saves `changes`; true once saved. */
export type SaveAnswer = (changes: AnswerChanges) => Promise<boolean>

/**
 * Radio chips for one answer, saved as soon as one is chosen. The choice shows while it saves and
 * goes back to the answer on file if the save fails.
 */
export function AnswerChips<T>(props: {
  name: string
  question: string
  options: readonly { label: string; answer: T }[]
  answered: T | undefined
  disabled: boolean
  testId: string
  onChoose: (answer: T) => Promise<boolean>
}): JSX.Element {
  const [pick, setPick] = createSignal<{ answer: T } | null>(null)
  const chosen = (): T | undefined => {
    const picked = pick()
    return picked === null ? props.answered : picked.answer
  }
  return (
    <Choices
      name={props.name}
      question={props.question}
      options={props.options}
      chosen={chosen()}
      disabled={props.disabled}
      testId={props.testId}
      onChoose={(answer) => {
        setPick({ answer })
        void props.onChoose(answer).finally(() => setPick(null))
      }}
    />
  )
}

/** "You gave this in USD: …", for an amount the circles leave out while the base currency differs. */
function OtherCurrency(props: { given: AnswerAmount | undefined; currency: string }): JSX.Element {
  return (
    <Show when={props.given && props.given.currency !== props.currency ? props.given : null}>
      {(given) => (
        <p class={styles.hint}>
          You gave {formatWholeCurrency(given().amount, given().currency)}. Your circles count it
          again once you save it in {props.currency}, your base currency now.
        </p>
      )}
    </Show>
  )
}

/** Pension or investment savings outside the app: No, or Yes and how much. */
export function SavedElsewhereQuestion(props: {
  given: AnswerAmount | undefined
  currency: string
  disabled: boolean
  idPrefix: string
  /** The legend's id, for a button the question describes. */
  legendId?: string
  onSave: SaveAnswer
  /** Under the question, as Settings' Remove answer. */
  children?: JSX.Element
}): JSX.Element {
  // "Yes" picked and no amount saved yet: the amount field shows before anything is saved.
  const [yes, setYes] = createSignal(false)
  const answered = (): boolean | undefined =>
    props.given === undefined ? undefined : props.given.amount > 0
  const showAmount = () => yes() || answered() === true
  return (
    <Question
      question={SAVED_ELSEWHERE_QUESTION}
      hint={SAVED_ELSEWHERE_HINT}
      id={props.legendId}
      testId={`${props.idPrefix}-saved-elsewhere`}
    >
      <Choices
        name={`${props.idPrefix}-saved-elsewhere`}
        question={SAVED_ELSEWHERE_QUESTION}
        options={SAVED_ELSEWHERE_OPTIONS}
        chosen={yes() ? true : answered()}
        disabled={props.disabled}
        testId={`${props.idPrefix}-saved-elsewhere-choice`}
        onChoose={(answer) => {
          if (answer) {
            setYes(true)
            return
          }
          setYes(false)
          void props.onSave({ savedElsewhere: { amount: 0, currency: props.currency } })
        }}
      />
      <Show when={showAmount()}>
        <AmountForm
          currency={props.currency}
          initial={props.given && props.given.amount > 0 ? props.given.amount : null}
          label={`Pension or investment savings outside Token Circles, in ${props.currency}`}
          emptyProblem={AMOUNT_ABOVE_ZERO}
          disabled={props.disabled}
          testId={`${props.idPrefix}-saved-elsewhere-amount`}
          onSave={(amount) => {
            void props
              .onSave({ savedElsewhere: { amount, currency: props.currency } })
              .then((saved) => {
                if (saved) setYes(false)
              })
          }}
        />
      </Show>
      <OtherCurrency given={props.given} currency={props.currency} />
      {props.children}
    </Question>
  )
}

/** What a year of more than enough would cost, filled in with the answer on file. */
export function EnoughAmount(props: {
  given: AnswerAmount | undefined
  currency: string
  disabled: boolean
  testId: string
  onSave: SaveAnswer
}): JSX.Element {
  return (
    <>
      <AmountForm
        currency={props.currency}
        initial={props.given?.amount ?? null}
        label={`A year of more than enough, in ${props.currency}`}
        emptyProblem={ENOUGH_ABOVE_ZERO}
        disabled={props.disabled}
        testId={props.testId}
        onSave={(amount) => {
          void props.onSave({ enoughPerYear: { amount, currency: props.currency } })
        }}
      />
      <OtherCurrency given={props.given} currency={props.currency} />
    </>
  )
}
