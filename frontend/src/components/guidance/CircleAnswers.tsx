/**
 * Settings, About this space: the answers the circles asked for (design.md 1.8, guidance.md 5.5).
 * Each answered question is listed with its answer, changeable here, and "Remove answer", after
 * which its circle asks again. The support and essentials answers change where they were given:
 * Paying your way ticks the support, and each category keeps whether it is needed every month.
 * The free-money and tenure answers show only while the benchmarks gate is open, as their questions
 * do.
 */
import { createUniqueId, Show } from 'solid-js'
import {
  CARD_OPTIONS,
  CARD_QUESTION,
  ENOUGH_QUESTION,
  ESSENTIALS_QUESTION,
  freeMoneyQuestion,
  SUPPORT_QUESTION,
  TENURE_QUESTION,
  tenureOptions,
  YEARLY_BILLS_OPTIONS,
  YEARLY_BILLS_QUESTION,
} from '../../../../shared/guidance/questions'
import { circleHash } from '../../core/progressRoute'
import { AnswerChips, EnoughAmount, SavedElsewhereQuestion } from './CircleQuestions'
import { Question } from './questionParts'
import styles from './Questions.module.css'
import type { JSX } from 'solid-js'
import type {
  AnswerChanges,
  Answers,
  FreeMoneyAnswer,
  TenureAnswer,
} from '../../../../shared/guidance/answers'
import type { SaveAnswer } from './CircleQuestions'

export interface CircleAnswersProps {
  answers: Answers
  /** The base currency, for the amounts. */
  currency: string
  /** Category names by id, for the support answer; null when they could not be read. */
  categoryNames: ReadonlyMap<number, string> | null
  /** The benchmarks gate (core/guidanceGate.ts): the free-money answer shows only while open. */
  gate: boolean
  /** The region compared with: the UK's figures tell social renters apart. */
  region: string
  disabled: boolean
  onSave: SaveAnswer
}

/** "Remove answer", described by its question: a screen reader hears which answer it removes. */
function RemoveAnswer(props: {
  describedBy: string
  testId: string
  disabled: boolean
  onRemove: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      class={styles.remove}
      aria-describedby={props.describedBy}
      data-test-id={props.testId}
      disabled={props.disabled}
      onClick={() => {
        props.onRemove()
      }}
    >
      Remove answer
    </button>
  )
}

/** One listed answer: its question, the answer as it can be changed, and Remove answer. */
function Answered(props: {
  question: string
  name: string
  disabled: boolean
  remove: AnswerChanges
  onSave: SaveAnswer
  children: JSX.Element
  link?: { hash: string; label: string }
}): JSX.Element {
  const id = `circle-answer-${props.name}-${createUniqueId()}`
  return (
    <Question question={props.question} id={id} testId={`settings-answer-${props.name}`}>
      {props.children}
      <div class={styles.answerFoot}>
        <Show when={props.link}>
          {(link) => (
            <a class={styles.link} href={link().hash}>
              {link().label}
            </a>
          )}
        </Show>
        <RemoveAnswer
          describedBy={id}
          testId={`settings-answer-${props.name}-remove`}
          disabled={props.disabled}
          onRemove={() => void props.onSave(props.remove)}
        />
      </div>
    </Question>
  )
}

const listed = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })

export function CircleAnswers(props: CircleAnswersProps): JSX.Element {
  const a = () => props.answers
  const savedElsewhereId = `circle-answer-saved-elsewhere-${createUniqueId()}`
  const freeMoney = () => {
    const given = a().freeMoney
    const asked = given && props.gate ? freeMoneyQuestion(given.region) : null
    return given && asked ? { given, asked } : null
  }
  const supportNames = () => {
    const ids = a().supportCategoryIds ?? []
    const known = props.categoryNames
    if (known === null) {
      return ids.length === 0
        ? 'None of it.'
        : `${ids.length} income ${ids.length === 1 ? 'category' : 'categories'}.`
    }
    // A category deleted since is no longer counted.
    const names = ids.flatMap((id) => {
      const name = known.get(id)
      return name ? [name] : []
    })
    return names.length === 0 ? 'None of it.' : `${listed.format(names)}.`
  }
  const any = () =>
    a().carriesCardBalance !== undefined ||
    a().setsAsideYearly !== undefined ||
    freeMoney() !== null ||
    (props.gate && a().tenure !== undefined) ||
    a().supportCategoryIds !== undefined ||
    a().kindsAsked !== undefined ||
    a().savedElsewhere !== undefined ||
    a().enoughPerYear !== undefined

  return (
    <section
      class={styles.answers}
      aria-labelledby="circle-answers-title"
      data-test-id="settings-circle-answers"
    >
      <h3 id="circle-answers-title" class={styles.answersTitle}>
        What your circles asked
      </h3>
      <Show
        when={any()}
        fallback={
          <p class={styles.hint} data-test-id="settings-circle-answers-empty">
            Nothing yet. A circle asks when an answer would change one of its checks.
          </p>
        }
      >
        <p class={styles.hint}>Remove an answer and its circle asks again.</p>
      </Show>

      <Show when={a().carriesCardBalance !== undefined}>
        <Answered
          question={CARD_QUESTION}
          name="card"
          disabled={props.disabled}
          remove={{ carriesCardBalance: null }}
          onSave={props.onSave}
        >
          <AnswerChips
            name="settings-answer-card"
            question={CARD_QUESTION}
            options={CARD_OPTIONS}
            answered={a().carriesCardBalance}
            disabled={props.disabled}
            testId="settings-answer-card-choice"
            onChoose={(answer) => props.onSave({ carriesCardBalance: answer })}
          />
        </Answered>
      </Show>

      <Show when={a().setsAsideYearly !== undefined}>
        <Answered
          question={YEARLY_BILLS_QUESTION}
          name="yearly-bills"
          disabled={props.disabled}
          remove={{ setsAsideYearly: null }}
          onSave={props.onSave}
        >
          <AnswerChips
            name="settings-answer-yearly-bills"
            question={YEARLY_BILLS_QUESTION}
            options={YEARLY_BILLS_OPTIONS}
            answered={a().setsAsideYearly}
            disabled={props.disabled}
            testId="settings-answer-yearly-bills-choice"
            onChoose={(answer) => props.onSave({ setsAsideYearly: answer })}
          />
        </Answered>
      </Show>

      <Show when={freeMoney()}>
        {(free) => (
          <Answered
            question={free().asked.question}
            name="free-money"
            disabled={props.disabled}
            remove={{ freeMoney: null }}
            onSave={props.onSave}
          >
            <AnswerChips<FreeMoneyAnswer>
              name="settings-answer-free-money"
              question={free().asked.question}
              options={free().asked.options}
              answered={free().given.answer}
              disabled={props.disabled}
              testId="settings-answer-free-money-choice"
              onChoose={(answer) =>
                props.onSave({ freeMoney: { region: free().given.region, answer } })
              }
            />
          </Answered>
        )}
      </Show>

      <Show when={props.gate && a().tenure !== undefined}>
        <Answered
          question={TENURE_QUESTION}
          name="tenure"
          disabled={props.disabled}
          remove={{ tenure: null }}
          onSave={props.onSave}
        >
          <AnswerChips<TenureAnswer>
            name="settings-answer-tenure"
            question={TENURE_QUESTION}
            options={tenureOptions(props.region, a().tenure)}
            answered={a().tenure}
            disabled={props.disabled}
            testId="settings-answer-tenure-choice"
            onChoose={(answer) => props.onSave({ tenure: answer })}
          />
        </Answered>
      </Show>

      <Show when={a().supportCategoryIds !== undefined}>
        <Answered
          question={SUPPORT_QUESTION}
          name="support"
          disabled={props.disabled}
          remove={{ supportCategoryIds: null }}
          onSave={props.onSave}
          link={{ hash: circleHash(2), label: 'Change it in Paying your way' }}
        >
          <p class={styles.value} data-test-id="settings-answer-support-value">
            {supportNames()}
          </p>
        </Answered>
      </Show>

      <Show when={a().kindsAsked !== undefined}>
        <Answered
          question={ESSENTIALS_QUESTION}
          name="essentials"
          disabled={props.disabled}
          remove={{ kindsAsked: null }}
          onSave={props.onSave}
          link={{ hash: '#categories', label: 'Open Categories' }}
        >
          <p class={styles.value}>Each choice is kept with its category on Categories.</p>
        </Answered>
      </Show>

      <Show when={a().savedElsewhere !== undefined}>
        <SavedElsewhereQuestion
          given={a().savedElsewhere}
          currency={props.currency}
          disabled={props.disabled}
          idPrefix="settings-answer"
          legendId={savedElsewhereId}
          onSave={props.onSave}
        >
          <div class={styles.answerFoot}>
            <RemoveAnswer
              describedBy={savedElsewhereId}
              testId="settings-answer-saved-elsewhere-remove"
              disabled={props.disabled}
              onRemove={() => void props.onSave({ savedElsewhere: null })}
            />
          </div>
        </SavedElsewhereQuestion>
      </Show>

      <Show when={a().enoughPerYear !== undefined}>
        <Answered
          question={ENOUGH_QUESTION}
          name="enough"
          disabled={props.disabled}
          remove={{ enoughPerYear: null }}
          onSave={props.onSave}
        >
          <EnoughAmount
            given={a().enoughPerYear}
            currency={props.currency}
            disabled={props.disabled}
            testId="settings-answer-enough-amount"
            onSave={props.onSave}
          />
        </Answered>
      </Show>
    </section>
  )
}
