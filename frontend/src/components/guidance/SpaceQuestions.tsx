/**
 * "Where do you live?" and "Who does this space cover?", as guidance.md section 5.5 asks them: in
 * setup's About this space screen, and in Settings, About this space. Each is a group of radio
 * chips; choosing one calls `onChoose` with that answer. Both can be left unanswered.
 */
import { For, Show } from 'solid-js'
import {
  ADULT_CHOICES,
  CHILD_CHOICES,
  countChoice,
  HOUSEHOLD_QUESTION,
  REGION_CHOICES,
  REGION_QUESTION,
  REGION_WHY,
} from './regionWords'
import styles from './SpaceQuestions.module.css'
import type { JSX } from 'solid-js'
import type { AnswerChanges, Answers } from '../../../../shared/guidance/answers'

export interface SpaceQuestionsProps {
  /** The answers shown as chosen. */
  answers: Answers
  /** The person chose an answer. */
  onChoose: (changes: AnswerChanges) => void
  /** Keeps the radio groups of two copies apart, and prefixes the test ids. */
  idPrefix: string
  /** Turns the choices off, while a save runs. */
  disabled?: boolean
  /** A line under the region question: how the region was set. */
  regionNote?: JSX.Element
  /** A line under the household question. */
  householdNote?: JSX.Element
  /** With it, an answered question offers "Remove answer", which clears its answer. */
  onAskAgain?: (question: 'region' | 'household') => void
  /**
   * Setup's screen on a phone: the regions in two columns, each count on one row with its label
   * beside it, "3+" for "3 or more", and no line under the region question (the screen's lead
   * says why it asks).
   */
  compact?: boolean
}

function Chip(props: {
  name: string
  label: string
  /** Shown in place of the label, which stays the radio's name: "3+" for "3 or more". */
  short?: string
  checked: boolean
  disabled?: boolean
  testId: string
  onChoose: () => void
}) {
  return (
    <label class={styles.chip} data-test-id={props.testId}>
      <input
        type="radio"
        class={styles.radio}
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.short ? props.label : undefined}
        onChange={() => {
          props.onChoose()
        }}
      />
      <span aria-hidden={props.short ? 'true' : undefined}>{props.short ?? props.label}</span>
    </label>
  )
}

/** "Remove answer". Both questions have one, so each is described by its question: a screen reader
 *  lists "Remove answer, Where do you live?", not two buttons with the same name. */
function AskAgain(props: {
  testId: string
  describedBy: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class={styles.askAgain}
      data-test-id={props.testId}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      onClick={() => {
        props.onClick()
      }}
    >
      Remove answer
    </button>
  )
}

/**
 * "Who does this space cover?": adults and children, each a group of chips. Setup and About this
 * space ask it with the region question; the subscription card asks it on its own while no adult
 * count is on file.
 */
export function HouseholdQuestion(props: {
  /** Keeps the radio groups of two copies apart, and prefixes the test ids. */
  idPrefix: string
  answers: Answers
  onChoose: (changes: AnswerChanges) => void
  disabled?: boolean
  /** A line under the question. */
  note?: JSX.Element
  /** With it, an answered question offers "Remove answer". */
  onAskAgain?: () => void
  /** Each count on one row, its label beside its chips, "3+" for "3 or more". */
  compact?: boolean
}): JSX.Element {
  const id = (part: string) => `${props.idPrefix}-${part}`
  const adults = () => countChoice(props.answers.adults)
  const children = () => countChoice(props.answers.children)
  const answered = () => adults() !== undefined || children() !== undefined
  return (
    <fieldset
      class={styles.question}
      classList={{ [styles.compact]: Boolean(props.compact) }}
      data-test-id={id('household')}
    >
      <legend id={id('household-question')} class={styles.legend}>
        {HOUSEHOLD_QUESTION}
      </legend>
      <div class={styles.counts}>
        <fieldset class={styles.count}>
          <legend class={styles.countLegend}>Adults</legend>
          <div class={styles.chips}>
            <For each={ADULT_CHOICES}>
              {(choice) => (
                <Chip
                  name={id('adults')}
                  label={choice.label}
                  short={props.compact ? choice.short : undefined}
                  checked={adults() === choice.value}
                  disabled={props.disabled}
                  testId={id(`adults-${choice.value}`)}
                  onChoose={() => {
                    props.onChoose({ adults: choice.value })
                  }}
                />
              )}
            </For>
          </div>
        </fieldset>
        <fieldset class={styles.count}>
          <legend class={styles.countLegend}>Children</legend>
          <div class={styles.chips}>
            <For each={CHILD_CHOICES}>
              {(choice) => (
                <Chip
                  name={id('children')}
                  label={choice.label}
                  short={props.compact ? choice.short : undefined}
                  checked={children() === choice.value}
                  disabled={props.disabled}
                  testId={id(`children-${choice.value}`)}
                  onChoose={() => {
                    props.onChoose({ children: choice.value })
                  }}
                />
              )}
            </For>
          </div>
        </fieldset>
      </div>
      <Show when={props.note || (props.onAskAgain && answered())}>
        <div class={styles.note}>
          <span data-test-id={id('household-note')}>{props.note}</span>
          <Show when={props.onAskAgain && answered()}>
            <AskAgain
              testId={id('household-ask-again')}
              describedBy={id('household-question')}
              disabled={props.disabled}
              onClick={() => props.onAskAgain?.()}
            />
          </Show>
        </div>
      </Show>
    </fieldset>
  )
}

export function SpaceQuestions(props: SpaceQuestionsProps) {
  const id = (part: string) => `${props.idPrefix}-${part}`
  return (
    <div class={styles.questions} classList={{ [styles.compact]: Boolean(props.compact) }}>
      <fieldset class={styles.question} data-test-id={id('region')}>
        <legend id={id('region-question')} class={styles.legend}>
          {REGION_QUESTION}
        </legend>
        <Show when={!props.compact}>
          <p class={styles.why}>{REGION_WHY}</p>
        </Show>
        <div class={styles.chips} classList={{ [styles.regionChips]: Boolean(props.compact) }}>
          <For each={REGION_CHOICES}>
            {(choice) => (
              <Chip
                name={id('region')}
                label={choice.label}
                checked={props.answers.region === choice.value}
                disabled={props.disabled}
                testId={id(`region-${choice.value}`)}
                onChoose={() => {
                  props.onChoose({ region: choice.value })
                }}
              />
            )}
          </For>
        </div>
        <Show when={props.regionNote || (props.onAskAgain && props.answers.region)}>
          <div class={styles.note}>
            <span data-test-id={id('region-note')}>{props.regionNote}</span>
            <Show when={props.onAskAgain && props.answers.region}>
              <AskAgain
                testId={id('region-ask-again')}
                describedBy={id('region-question')}
                disabled={props.disabled}
                onClick={() => props.onAskAgain?.('region')}
              />
            </Show>
          </div>
        </Show>
      </fieldset>

      <HouseholdQuestion
        idPrefix={props.idPrefix}
        answers={props.answers}
        disabled={props.disabled}
        onChoose={props.onChoose}
        note={props.householdNote}
        onAskAgain={props.onAskAgain ? () => props.onAskAgain?.('household') : undefined}
        compact={props.compact}
      />
    </div>
  )
}
