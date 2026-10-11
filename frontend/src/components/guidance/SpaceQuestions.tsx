/**
 * "Where do you live?" and "Who does this space cover?", as guidance.md section 5.5 asks them: in
 * setup's "Name your space" step, and in Settings, About this space. Each is a group of radio
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
  /** With it, an answered question offers "Ask again", which clears its answer. */
  onAskAgain?: (question: 'region' | 'household') => void
}

function Chip(props: {
  name: string
  label: string
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
        onChange={() => {
          props.onChoose()
        }}
      />
      <span>{props.label}</span>
    </label>
  )
}

function AskAgain(props: { testId: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={styles.askAgain}
      data-test-id={props.testId}
      disabled={props.disabled}
      onClick={() => {
        props.onClick()
      }}
    >
      Ask again
    </button>
  )
}

export function SpaceQuestions(props: SpaceQuestionsProps) {
  const id = (part: string) => `${props.idPrefix}-${part}`
  const adults = () => countChoice(props.answers.adults)
  const children = () => countChoice(props.answers.children)
  const householdAnswered = () => adults() !== undefined || children() !== undefined
  return (
    <div class={styles.questions}>
      <fieldset class={styles.question} data-test-id={id('region')}>
        <legend class={styles.legend}>{REGION_QUESTION}</legend>
        <p class={styles.why}>{REGION_WHY}</p>
        <div class={styles.chips}>
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
                disabled={props.disabled}
                onClick={() => props.onAskAgain?.('region')}
              />
            </Show>
          </div>
        </Show>
      </fieldset>

      <fieldset class={styles.question} data-test-id={id('household')}>
        <legend class={styles.legend}>{HOUSEHOLD_QUESTION}</legend>
        <div class={styles.counts}>
          <fieldset class={styles.count}>
            <legend class={styles.countLegend}>Adults</legend>
            <div class={styles.chips}>
              <For each={ADULT_CHOICES}>
                {(choice) => (
                  <Chip
                    name={id('adults')}
                    label={choice.label}
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
        <Show when={props.householdNote || (props.onAskAgain && householdAnswered())}>
          <div class={styles.note}>
            <span data-test-id={id('household-note')}>{props.householdNote}</span>
            <Show when={props.onAskAgain && householdAnswered()}>
              <AskAgain
                testId={id('household-ask-again')}
                disabled={props.disabled}
                onClick={() => props.onAskAgain?.('household')}
              />
            </Show>
          </div>
        </Show>
      </fieldset>
    </div>
  )
}
