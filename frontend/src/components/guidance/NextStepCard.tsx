/**
 * Your next step (design.md 2.1, circles part 2): the one step the circles point to, with why in
 * the person's own numbers, how far along it is, and a button to the page where it is done. A step
 * that waits on an answer asks the question here: the choice shows at once, is saved through
 * `saveAnswers` (which re-reads the record first), and the circles take it without waiting for a
 * read (core/guidance.ts `takeAnswers`), so the step moves on.
 *
 * The words come from shared/guidance/nextStep.ts; this draws them.
 */
import { createSignal, createUniqueId, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { MONEY_MAX } from '../../../../shared/fieldReaders'
import { stepCircleName } from '../../../../shared/guidance/nextStep'
import {
  CARD_OPTIONS,
  freeMoneyQuestion,
  GUIDANCE_LINE,
  SAVE_FAILED,
  YEARLY_BILLS_OPTIONS,
} from '../../../../shared/guidance/questions'
import { round } from '../../../../shared/retirementSettings'
import { refreshAchievements } from '../../core/achievementsStore'
import { takeAnswers } from '../../core/guidance'
import { saveAnswers } from '../../core/guidanceAnswers'
import NumberField from '../NumberField'
import CircleGlyph from './CircleGlyph'
import styles from './NextStepCard.module.css'
import type { JSX } from 'solid-js'
import type { AnswerChanges, FreeMoneyAnswer } from '../../../../shared/guidance/answers'
import type { NextStep, StepMeter } from '../../../../shared/guidance/nextStep'
import type { GuidanceView } from '../../core/guidance'

export const ArrowIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

const ReloadIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none">
    <path
      d="M4 4v5h.58m15.36 2A8 8 0 0 0 4.58 9m0 0H9m11 11v-5h-.58m0 0a8 8 0 0 1-15.36-2m15.36 2H15"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

/** How far along: twelve cells for the months on file, or a bar to the target. */
export function Meter(props: { meter: StepMeter }): JSX.Element {
  const cells = () => (props.meter.kind === 'cells' ? props.meter.on : null)
  const share = () => (props.meter.kind === 'bar' ? props.meter.share : 0)
  return (
    <div class={styles.meter} data-test-id="next-step-meter">
      <Show
        when={cells() !== null}
        fallback={
          <div class={styles.track} aria-hidden="true">
            <i style={{ width: `${(share() * 100).toFixed(1)}%` }} />
          </div>
        }
      >
        <div class={styles.cells} aria-hidden="true">
          <For each={Array.from({ length: 12 }, (_, i) => i)}>
            {(i) => <i classList={{ [styles.on]: i < (cells() ?? 0) }} />}
          </For>
        </div>
      </Show>
      <div class={styles.labels}>
        <span>{props.meter.left}</span>
        <span>{props.meter.right}</span>
      </div>
    </div>
  )
}

/** A question's choices, as radio chips. */
function Choices<T>(props: {
  name: string
  question: string
  options: readonly { label: string; answer: T }[]
  chosen: T | undefined
  disabled: boolean
  onChoose: (answer: T) => void
}): JSX.Element {
  return (
    <div class={styles.chips} role="radiogroup" aria-label={props.question}>
      <For each={props.options}>
        {(option) => (
          <label class={styles.chip} data-test-id="next-step-choice">
            <input
              type="radio"
              class={styles.radio}
              name={props.name}
              checked={props.chosen === option.answer}
              disabled={props.disabled}
              onChange={() => {
                props.onChoose(option.answer)
              }}
            />
            <span>{option.label}</span>
          </label>
        )}
      </For>
    </div>
  )
}

/** "What would a year of more than enough cost?": an amount in the base currency, and Save. */
function EnoughForm(props: {
  currency: string
  disabled: boolean
  onSave: (amount: number) => void
}): JSX.Element {
  const [amount, setAmount] = createSignal<number | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  return (
    <form
      class={styles.amountForm}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const value = amount()
        if (value === null || !Number.isFinite(value) || value <= 0) {
          setProblem('Enter what a year would cost, above 0.')
          return
        }
        if (value >= MONEY_MAX) {
          setProblem('Enter an amount under 1,000,000,000,000.')
          return
        }
        setProblem(null)
        props.onSave(round(value, 2))
      }}
    >
      <div class={styles.amountRow}>
        <label class={styles.amount}>
          <span class={styles.currency}>{props.currency}</span>
          <NumberField<number | null>
            value={amount()}
            emptyValue={null}
            onChange={setAmount}
            step="0.01"
            min="0"
            class={styles.amountInput}
            ariaLabel={`A year of more than enough, in ${props.currency}`}
            ariaInvalid={problem() ? 'true' : undefined}
            testId="next-step-amount"
            disabled={props.disabled}
          />
        </label>
        <button type="submit" class={styles.primary} disabled={props.disabled}>
          Save
        </button>
      </div>
      <Show when={problem()}>
        <p class={styles.problem} role="alert">
          {problem()}
        </p>
      </Show>
    </form>
  )
}

export interface NextStepCardProps {
  step: NextStep
  view: GuidanceView
  /** The card's heading: h2 as a section of Progress, h3 inside a Dashboard card. */
  level?: 2 | 3
  class?: string
  /** Under the card, as on Dashboard: a link to all seven circles. */
  footer?: JSX.Element
}

export default function NextStepCard(props: NextStepCardProps): JSX.Element {
  const id = createUniqueId()
  const headingId = `next-step-${id}`
  const [saving, setSaving] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [chosen, setChosen] = createSignal<{ step: string; answer: unknown } | null>(null)
  const [reloading, setReloading] = createSignal(false)

  const level = () => props.level ?? 2
  const row = () =>
    props.step.circle === null ? undefined : props.view.rows[props.step.circle - 1]
  const question = () =>
    props.step.action?.kind === 'question' ? props.step.action.question : null
  const link = () => {
    const action = props.step.action
    return action && (action.kind === 'open' || action.kind === 'circles') ? action : null
  }
  const reload = () => (props.step.action?.kind === 'reload' ? props.step.action : null)
  const freeMoney = () => freeMoneyQuestion(props.view.region.region)

  /** The answer picked for the step on screen, while it saves. */
  const picked = (): unknown => {
    const pick = chosen()
    return pick !== null && pick.step === props.step.id ? pick.answer : undefined
  }

  const answer = async (changes: AnswerChanges, pick: unknown) => {
    const profileId = props.view.profileId
    setChosen({ step: props.step.id, answer: pick })
    setProblem(null)
    setSaving(true)
    try {
      takeAnswers(profileId, await saveAnswers(changes, profileId))
    } catch {
      setChosen(null)
      setProblem(SAVE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      class={`${styles.card} ${props.class ?? ''}`}
      aria-labelledby={headingId}
      data-test-id="next-step-card"
      data-step={props.step.id}
    >
      <div class={styles.head}>
        <Dynamic component={level() === 2 ? 'h2' : 'h3'} id={headingId} class={styles.eyebrow}>
          <span class={styles.sun} aria-hidden="true" />
          Your next step
        </Dynamic>
        <Show when={row()}>
          {(r) => (
            <span class={styles.circle} data-test-id="next-step-circle">
              <CircleGlyph
                circle={r().circle}
                state={r().state}
                measure={r().measure}
                months={r().months}
                size={20}
              />
              {stepCircleName(props.step)}
            </span>
          )}
        </Show>
      </div>
      <Dynamic
        component={level() === 2 ? 'h3' : 'h4'}
        class={styles.title}
        data-test-id="next-step-title"
      >
        {props.step.title}
      </Dynamic>
      <p class={styles.why} data-test-id="next-step-why">
        {props.step.why}
      </p>
      <Show when={props.view.gate && props.step.compare}>
        <p class={styles.why} data-test-id="next-step-compare">
          {props.step.compare}
        </p>
      </Show>

      <Show when={question() === 'card'}>
        <Choices
          name={`${headingId}-card`}
          question={props.step.title}
          options={CARD_OPTIONS}
          chosen={picked() as boolean | undefined}
          disabled={saving()}
          onChoose={(pick) => void answer({ carriesCardBalance: pick }, pick)}
        />
      </Show>
      <Show when={question() === 'yearly-bills'}>
        <Choices
          name={`${headingId}-yearly`}
          question={props.step.title}
          options={YEARLY_BILLS_OPTIONS}
          chosen={picked() as boolean | undefined}
          disabled={saving()}
          onChoose={(pick) => void answer({ setsAsideYearly: pick }, pick)}
        />
      </Show>
      <Show when={question() === 'free-money' ? freeMoney() : null}>
        {(asked) => (
          <Choices
            name={`${headingId}-free`}
            question={asked().question}
            options={asked().options}
            chosen={picked() as FreeMoneyAnswer | undefined}
            disabled={saving()}
            onChoose={(pick) =>
              void answer({ freeMoney: { region: props.view.region.region, answer: pick } }, pick)
            }
          />
        )}
      </Show>
      <Show when={question() === 'enough'}>
        <EnoughForm
          currency={props.view.inputs.currency}
          disabled={saving()}
          onSave={(amount) =>
            void answer({ enoughPerYear: { amount, currency: props.view.inputs.currency } }, amount)
          }
        />
      </Show>
      <Show when={problem()}>
        <p class={styles.problem} role="alert" data-test-id="next-step-problem">
          {problem()}
        </p>
      </Show>
      <Show when={props.step.fine}>
        <p class={styles.fine}>{props.step.fine}</p>
      </Show>
      <Show when={question() === 'free-money'}>
        <p class={styles.fine}>{GUIDANCE_LINE}</p>
      </Show>

      <Show when={props.step.meter}>{(meter) => <Meter meter={meter()} />}</Show>

      <Show when={link()}>
        {(action) => (
          <div class={styles.foot}>
            <a class={styles.primary} href={action().hash} data-test-id="next-step-action">
              {action().label}
              <ArrowIcon />
            </a>
          </div>
        )}
      </Show>
      <Show when={reload()}>
        {(action) => (
          <div class={styles.foot}>
            <button
              type="button"
              class={styles.primary}
              data-test-id="next-step-action"
              disabled={reloading()}
              onClick={() => {
                setReloading(true)
                refreshAchievements()
                  .catch(() => undefined)
                  .finally(() => setReloading(false))
              }}
            >
              <ReloadIcon />
              {action().label}
            </button>
          </div>
        )}
      </Show>

      <Show when={props.step.then}>
        {(then) => (
          <p class={styles.then} data-test-id="next-step-then">
            <b>Then:</b> {then().replace(/^Then: /, '')}
          </p>
        )}
      </Show>
      {props.footer}
    </section>
  )
}

/** The card before the circles are worked out, so the page keeps its place for it. */
export function NextStepPending(): JSX.Element {
  return (
    <section
      class={styles.card}
      aria-label="Your next step"
      aria-busy="true"
      data-test-id="next-step-pending"
    >
      <div class={styles.head}>
        <h2 class={styles.eyebrow}>
          <span class={styles.sun} aria-hidden="true" />
          Your next step
        </h2>
      </div>
      <p class={styles.why}>Working it out from your numbers.</p>
    </section>
  )
}
