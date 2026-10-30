/**
 * One circle, opened from its row (`#progress/<n>`, design.md 1.8, circles part 2): its ring, its
 * name and one-liner, where the person is, Your next step while it is the circle being worked on,
 * what the circle checks, and the person's numbers behind the checks. "All seven circles" and
 * Escape both go back to the list, where Progress puts focus on this circle's row; opening it puts
 * focus on its heading.
 *
 * The questions that feed the circles are asked here, each where its answer is first needed
 * (shared/guidance/circleView.ts `circleQuestions`): the card, yearly-bills, free-money and
 * own-number questions under the check they settle, the support, essentials and outside-savings
 * questions under the numbers they change. Each is saved through `saveAnswers` and taken by the
 * circles at once. A question Your next step asks on this screen is asked there only.
 */
import { createMemo, For, Index, onMount, Show } from 'solid-js'
import { CIRCLE_NAMES } from '../../../../shared/guidance/circles'
import {
  CHECK_STATES,
  checkRows,
  checksLine,
  circleNumbers,
  circleQuestions,
} from '../../../../shared/guidance/circleView'
import { CIRCLE_LINES } from '../../../../shared/guidance/ledger'
import {
  CARD_OPTIONS,
  CARD_QUESTION,
  ENOUGH_QUESTION,
  ESSENTIALS_HINT,
  ESSENTIALS_QUESTION,
  freeMoneyQuestion,
  GUIDANCE_LINE,
  SUPPORT_HINT,
  SUPPORT_QUESTION,
  YEARLY_BILLS_ASIDE,
  YEARLY_BILLS_OPTIONS,
} from '../../../../shared/guidance/questions'
import { apiPut } from '../../core/api'
import { asOneWrite } from '../../core/dataVersions'
import { saveAnswers } from '../../core/guidanceAnswers'
import { circleHash } from '../../core/progressRoute'
import CircleGlyph from './CircleGlyph'
import ledger from './CircleLedger.module.css'
import { AnswerChips, EnoughAmount, SavedElsewhereQuestion } from './CircleQuestions'
import styles from './CircleView.module.css'
import NextStepCard from './NextStepCard'
import { createAnswerSave, Question, SaveProblem, TickList } from './questionParts'
import type { JSX } from 'solid-js'
import type { Answers, FreeMoneyAnswer } from '../../../../shared/guidance/answers'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { CheckRow, CheckState, CircleQuestion } from '../../../../shared/guidance/circleView'
import type { GuidanceView } from '../../core/guidance'
import type { SaveAnswer } from './CircleQuestions'
import type { TickRow } from './questionParts'

const BackIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M10 3.5 5.5 8l4.5 4.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

/** A check's state as a mark: a tick when met, a ring when not yet, a dashed ring when not known. */
function StateMark(props: { state: CheckState }): JSX.Element {
  return (
    <svg class={styles.mark} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <Show
        when={props.state === 'met'}
        fallback={
          <circle
            cx="10"
            cy="10"
            r="7.25"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-dasharray={props.state === 'not-known' ? '2.6 2.4' : undefined}
          />
        }
      >
        <circle cx="10" cy="10" r="8" fill="currentColor" />
        <path
          d="m6.4 10.2 2.4 2.4 4.8-5"
          fill="none"
          stroke="var(--card-bg)"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
    </svg>
  )
}

export interface CircleViewProps {
  circle: CircleNumber
  view: GuidanceView | null
  /** Back to the list: "All seven circles", or Escape. */
  onClose: () => void
}

/** The question a check row asks, by the check it settles. */
const ASKED_UNDER: Partial<Record<CheckRow['id'], CircleQuestion>> = {
  'no-expensive-debt': 'card',
  'yearly-bills': 'yearly-bills',
  'free-money': 'free-money',
  enough: 'enough',
}

export default function CircleView(props: CircleViewProps): JSX.Element {
  let heading!: HTMLHeadingElement
  const row = () => props.view?.rows[props.circle - 1]
  const name = () => CIRCLE_NAMES[props.circle]
  const answerSave = createAnswerSave(() => props.view?.profileId ?? 0)

  onMount(() => {
    heading.focus()
  })

  const checks = createMemo(() => {
    const view = props.view
    if (!view) return []
    return checkRows(
      view.placement.circles[props.circle - 1],
      view.facts,
      view.words,
      view.placement.current
    )
  })
  const numbers = createMemo(() => {
    const view = props.view
    if (!view) return null
    return circleNumbers(props.circle, view.facts, view.words, {
      holdings: view.inputs.holdings,
      kindsAsked: view.inputs.answers.kindsAsked === true,
    })
  })
  /** The questions this view asks, less the one Your next step asks on it. */
  const questions = createMemo((): CircleQuestion[] => {
    const view = props.view
    if (!view) return []
    const asked = circleQuestions(props.circle, view.facts, {
      kindsAsked: view.inputs.answers.kindsAsked === true,
      current: view.placement.current,
      gate: view.gate,
    })
    const action = row()?.state === 'current' ? view.next.action : null
    const stepAsks = action?.kind === 'question' ? action.question : null
    return asked.filter((question) => question !== stepAsks)
  })
  const asks = (question: CircleQuestion | undefined): question is CircleQuestion =>
    question !== undefined && questions().includes(question)

  return (
    <section
      class={styles.view}
      aria-labelledby="circle-view-title"
      data-test-id="circle-view"
      data-circle={props.circle}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        props.onClose()
      }}
    >
      <a
        class={styles.back}
        href={circleHash(null)}
        data-test-id="circle-back"
        onClick={(e) => {
          e.preventDefault()
          props.onClose()
        }}
      >
        <BackIcon />
        All seven circles
      </a>
      <header class={styles.head}>
        <CircleGlyph
          class={styles.glyph}
          circle={props.circle}
          state={row()?.state ?? 'later'}
          measure={row()?.measure ?? null}
          months={row()?.months ?? null}
          size={52}
        />
        <div class={styles.headText}>
          <p class={styles.eyebrow}>Circle {props.circle} of 7</p>
          <h2 id="circle-view-title" class={styles.title} ref={heading} tabIndex={-1}>
            {name()}
          </h2>
          <p class={styles.line}>{CIRCLE_LINES[props.circle]}</p>
        </div>
        <Show when={row()}>
          {(r) => (
            <span class={`${ledger.pill} ${styles.pill}`} data-state={r().state}>
              {r().pill}
            </span>
          )}
        </Show>
      </header>
      <Show when={row()?.key}>
        {(key) => (
          <p class={styles.key} data-test-id="circle-view-key">
            {key()}
            <Show when={row()?.detail}>
              {(detail) => <span class={styles.detail}>{detail()}</span>}
            </Show>
          </p>
        )}
      </Show>
      <Show when={props.view && row()?.state === 'current' ? props.view : null}>
        {(view) => <NextStepCard class={styles.next} step={view().next} view={view()} level={3} />}
      </Show>

      <Show when={props.view}>
        {(view) => (
          <>
            <section class={styles.part} aria-labelledby="circle-checks-title">
              <h3 id="circle-checks-title" class={styles.partTitle}>
                What {name()} checks
              </h3>
              <p class={styles.partLead} data-test-id="circle-checks-line">
                {checksLine(view().placement.circles[props.circle - 1])}
              </p>
              {/* Keyed by place: a row holds a question's inputs, which an answer must not rebuild. */}
              <ul class={styles.checks} data-test-id="circle-checks">
                <Index each={checks()}>
                  {(check) => (
                    <li
                      class={styles.check}
                      data-state={check().state}
                      data-check={check().id}
                      data-test-id="circle-check"
                    >
                      <div class={styles.checkHead}>
                        <StateMark state={check().state} />
                        <span class={styles.checkTitle}>{check().title}</span>
                        <span class={styles.checkState} data-test-id="circle-check-state">
                          {CHECK_STATES[check().state]}
                        </span>
                      </div>
                      <Show when={check().detail}>
                        <p class={styles.checkDetail} data-test-id="circle-check-detail">
                          {check().detail}
                        </p>
                      </Show>
                      <Show when={check().waiting}>
                        <p class={styles.checkWaiting} data-test-id="circle-check-waiting">
                          {check().waiting}
                        </p>
                      </Show>
                      <Show when={check().needed}>
                        <p class={styles.checkNeeded}>{check().needed}</p>
                      </Show>
                      <Show when={asks(ASKED_UNDER[check().id]) ? ASKED_UNDER[check().id] : null}>
                        {(question) => (
                          <CheckQuestion
                            question={question()}
                            view={view()}
                            disabled={answerSave.saving()}
                            onSave={answerSave.save}
                          />
                        )}
                      </Show>
                    </li>
                  )}
                </Index>
              </ul>
            </section>

            <Show when={numbers()}>
              {(shown) => (
                <section class={styles.part} aria-labelledby="circle-numbers-title">
                  <h3 id="circle-numbers-title" class={styles.partTitle}>
                    Your numbers
                  </h3>
                  <p class={styles.partLead} data-test-id="circle-numbers-lead">
                    {shown().lead}
                  </p>
                  <dl class={styles.numbers} data-test-id="circle-numbers">
                    <For each={shown().rows}>
                      {(number) => (
                        <div class={styles.number}>
                          <dt>{number.label}</dt>
                          <dd>{number.value}</dd>
                          <Show when={number.note}>
                            <p class={styles.numberNote}>{number.note}</p>
                          </Show>
                          <Show when={number.link}>
                            {(link) => (
                              <a class={styles.numberLink} href={link().hash}>
                                {link().label}
                              </a>
                            )}
                          </Show>
                        </div>
                      )}
                    </For>
                  </dl>
                  <Show when={asks('support')}>
                    <SupportQuestion
                      view={view()}
                      disabled={answerSave.saving()}
                      onSave={answerSave.save}
                    />
                  </Show>
                  <Show when={asks('essentials')}>
                    <EssentialsQuestion
                      view={view()}
                      disabled={answerSave.saving()}
                      run={answerSave.run}
                    />
                  </Show>
                  <Show when={asks('saved-elsewhere')}>
                    <SavedElsewhereQuestion
                      given={view().inputs.answers.savedElsewhere}
                      currency={view().inputs.currency}
                      disabled={answerSave.saving()}
                      idPrefix="circle"
                      onSave={answerSave.save}
                    />
                  </Show>
                </section>
              )}
            </Show>
            <SaveProblem problem={answerSave.problem()} testId="circle-view-problem" />
          </>
        )}
      </Show>
      <p class={styles.guide}>{GUIDANCE_LINE}</p>
    </section>
  )
}

/** The question under a check: the card, yearly bills, free money or the own number. */
function CheckQuestion(props: {
  question: CircleQuestion
  view: GuidanceView
  disabled: boolean
  onSave: SaveAnswer
}): JSX.Element {
  const answers = () => props.view.inputs.answers
  const region = () => props.view.region.region
  return (
    <>
      <Show when={props.question === 'card'}>
        <Question question={CARD_QUESTION} testId="circle-question-card">
          <AnswerChips
            name="circle-card"
            question={CARD_QUESTION}
            options={CARD_OPTIONS}
            answered={answers().carriesCardBalance}
            disabled={props.disabled}
            testId="circle-card-choice"
            onChoose={(answer) => props.onSave({ carriesCardBalance: answer })}
          />
        </Question>
      </Show>
      <Show when={props.question === 'yearly-bills'}>
        <Question question={YEARLY_BILLS_ASIDE} testId="circle-question-yearly-bills">
          <AnswerChips
            name="circle-yearly-bills"
            question={YEARLY_BILLS_ASIDE}
            options={YEARLY_BILLS_OPTIONS}
            answered={answers().setsAsideYearly}
            disabled={props.disabled}
            testId="circle-yearly-bills-choice"
            onChoose={(answer) => props.onSave({ setsAsideYearly: answer })}
          />
        </Question>
      </Show>
      <Show when={props.question === 'free-money' ? freeMoneyQuestion(region()) : null}>
        {(asked) => (
          <Question question={asked().question} testId="circle-question-free-money">
            <AnswerChips<FreeMoneyAnswer>
              name="circle-free-money"
              question={asked().question}
              options={asked().options}
              answered={
                answers().freeMoney?.region === region() ? answers().freeMoney?.answer : undefined
              }
              disabled={props.disabled}
              testId="circle-free-money-choice"
              onChoose={(answer) => props.onSave({ freeMoney: { region: region(), answer } })}
            />
          </Question>
        )}
      </Show>
      <Show when={props.question === 'enough'}>
        <Question question={ENOUGH_QUESTION} testId="circle-question-enough">
          <EnoughAmount
            given={answers().enoughPerYear}
            currency={props.view.inputs.currency}
            disabled={props.disabled}
            testId="circle-enough-amount"
            onSave={props.onSave}
          />
        </Question>
      </Show>
    </>
  )
}

/** "Is any of your income support you expect to stop?", ticked per income category. */
function SupportQuestion(props: {
  view: GuidanceView
  disabled: boolean
  onSave: SaveAnswer
}): JSX.Element {
  const listed = () => props.view.inputs.answers.supportCategoryIds ?? []
  const rows = (): TickRow[] =>
    (props.view.facts.windowCategories ?? [])
      .filter((category) => category.type === 'income')
      .map((category) => ({
        id: category.id,
        name: category.name,
        amount: `${props.view.words.money(Math.round(category.perMonth))} a month`,
        checked: listed().includes(category.id),
      }))
  return (
    <Question question={SUPPORT_QUESTION} hint={SUPPORT_HINT} testId="circle-question-support">
      <TickList
        rows={rows()}
        disabled={props.disabled}
        requireChange
        testId="circle-support"
        onSave={(ticked) => {
          // Support categories the window does not show (older ones) stay as they were.
          const shown = new Set(rows().map((row) => row.id))
          const kept = listed().filter((id) => !shown.has(id))
          void props.onSave({ supportCategoryIds: [...kept, ...ticked] })
        }}
      />
    </Question>
  )
}

/**
 * "Which of these do you need every month, whatever happens?": the window's spending categories,
 * ticked as they count now. Saving writes each category's `essential` where it changes, and for
 * every one that counted only because nothing said otherwise, then `kindsAsked`, as one write.
 */
function EssentialsQuestion(props: {
  view: GuidanceView
  disabled: boolean
  run: (work: () => Promise<Answers>) => Promise<boolean>
}): JSX.Element {
  const categories = () =>
    (props.view.facts.windowCategories ?? []).filter((category) => category.type === 'expense')
  const rows = (): TickRow[] =>
    categories().map((category) => ({
      id: category.id,
      name: category.name,
      amount: `${props.view.words.money(Math.round(category.perMonth))} a month`,
      checked: category.essential,
    }))
  return (
    <Question
      question={ESSENTIALS_QUESTION}
      hint={ESSENTIALS_HINT}
      testId="circle-question-essentials"
    >
      <TickList
        rows={rows()}
        disabled={props.disabled}
        requireChange={false}
        testId="circle-essentials"
        onSave={(ticked) => {
          const profileId = props.view.profileId
          const writes = categories().filter(
            (category) =>
              category.via === 'no-kind' || category.essential !== ticked.has(category.id)
          )
          void props.run(() =>
            asOneWrite(async () => {
              for (const category of writes) {
                await apiPut(`/api/categories/${category.id}`, {
                  essential: ticked.has(category.id),
                })
              }
              return saveAnswers({ kindsAsked: true }, profileId)
            })
          )
        }}
      />
    </Question>
  )
}
