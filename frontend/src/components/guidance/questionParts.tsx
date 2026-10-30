/**
 * The parts the circles' questions are asked with, in Your next step, a circle's view and Settings,
 * About this space (guidance.md 5.5): radio chips that save as they are chosen, an amount with
 * Save, and ticks per category with Save. `createAnswerSave` runs a save for one profile and hands
 * the saved record to the circles at once (core/guidance.ts `takeAnswers`), so a step or a check
 * moves on without waiting for a read.
 */
import { createEffect, createSignal, For, Index, on, Show, untrack } from 'solid-js'
import { MONEY_MAX } from '../../../../shared/fieldReaders'
import { AMOUNT_TOO_BIG, SAVE_FAILED } from '../../../../shared/guidance/questions'
import { round } from '../../../../shared/retirementSettings'
import { takeAnswers } from '../../core/guidance'
import { saveAnswers } from '../../core/guidanceAnswers'
import NumberField from '../NumberField'
import styles from './Questions.module.css'
import type { JSX } from 'solid-js'
import type { AnswerChanges, Answers } from '../../../../shared/guidance/answers'

/** A save in progress, and what went wrong with the last one. */
export interface AnswerSave {
  saving: () => boolean
  problem: () => string | null
  /** Save `changes` for the profile, through `saveAnswers`. True once saved. */
  save: (changes: AnswerChanges) => Promise<boolean>
  /** Run `work`, which writes and answers the saved record, as one save. True once saved. */
  run: (work: () => Promise<Answers>) => Promise<boolean>
}

/** Saves for the profile `profileId` answers, one at a time, handing each record to the circles. */
export function createAnswerSave(profileId: () => number): AnswerSave {
  const [saving, setSaving] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  const run = async (work: () => Promise<Answers>): Promise<boolean> => {
    const id = profileId()
    setProblem(null)
    setSaving(true)
    try {
      takeAnswers(id, await work())
      return true
    } catch {
      setProblem(SAVE_FAILED)
      return false
    } finally {
      setSaving(false)
    }
  }
  return {
    saving,
    problem,
    run,
    save: (changes) => run(() => saveAnswers(changes, profileId())),
  }
}

/** A question in words, with a hint under it, around its answers. */
export function Question(props: {
  question: string
  hint?: string
  testId: string
  /** The legend's id, for a button the question describes. */
  id?: string
  children: JSX.Element
}): JSX.Element {
  return (
    <fieldset class={styles.question} data-test-id={props.testId}>
      <legend id={props.id} class={styles.legend}>
        {props.question}
      </legend>
      <Show when={props.hint}>
        <p class={styles.hint}>{props.hint}</p>
      </Show>
      {props.children}
    </fieldset>
  )
}

/** A question's choices, as radio chips. Choosing one calls `onChoose` at once. */
export function Choices<T>(props: {
  name: string
  question: string
  options: readonly { label: string; answer: T }[]
  chosen: T | undefined
  disabled: boolean
  testId?: string
  onChoose: (answer: T) => void
}): JSX.Element {
  return (
    <div class={styles.chips} role="radiogroup" aria-label={props.question}>
      <For each={props.options}>
        {(option) => (
          <label class={styles.chip} data-test-id={props.testId ?? 'next-step-choice'}>
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

/** An amount in `currency`, above 0, and Save. */
export function AmountForm(props: {
  currency: string
  /** Filled in at first, as the answer on file. */
  initial?: number | null
  /** What the field is, for a screen reader: "A year of more than enough, in EUR". */
  label: string
  /** The problem with an empty field, or 0. */
  emptyProblem: string
  disabled: boolean
  testId: string
  onSave: (amount: number) => void
}): JSX.Element {
  const [amount, setAmount] = createSignal<number | null>(untrack(() => props.initial ?? null))
  const [problem, setProblem] = createSignal<string | null>(null)
  return (
    <form
      class={styles.amountForm}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const value = amount()
        if (value === null || !Number.isFinite(value) || value <= 0) {
          setProblem(props.emptyProblem)
          return
        }
        if (value >= MONEY_MAX) {
          setProblem(AMOUNT_TOO_BIG)
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
            ariaLabel={props.label}
            ariaInvalid={problem() ? 'true' : undefined}
            testId={props.testId}
            disabled={props.disabled}
          />
        </label>
        <button type="submit" class={styles.save} disabled={props.disabled}>
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

/** One category to tick: its name, and what it takes in or spends a month. */
export interface TickRow {
  id: number
  name: string
  amount: string
  checked: boolean
}

/**
 * Ticks per category, and Save. The ticks start as `rows` say and follow them when they change (a
 * save landed); Save hands over the ids ticked. With `requireChange`, Save waits for a change.
 */
export function TickList(props: {
  rows: readonly TickRow[]
  disabled: boolean
  requireChange: boolean
  testId: string
  onSave: (ticked: ReadonlySet<number>) => void
}): JSX.Element {
  const fromRows = () => new Set(props.rows.filter((row) => row.checked).map((row) => row.id))
  const [ticked, setTicked] = createSignal<ReadonlySet<number>>(untrack(fromRows))
  createEffect(
    on(
      () => props.rows.map((row) => `${row.id}:${row.checked}`).join(','),
      () => setTicked(fromRows()),
      { defer: true }
    )
  )
  const changed = () => props.rows.some((row) => row.checked !== ticked().has(row.id))
  const toggle = (id: number, on: boolean) => {
    const next = new Set(ticked())
    if (on) next.add(id)
    else next.delete(id)
    setTicked(next)
  }
  return (
    <>
      <ul class={styles.ticks} data-test-id={props.testId}>
        <Index each={props.rows}>
          {(row) => (
            <li>
              <label class={styles.tick} data-test-id={`${props.testId}-row`}>
                <input
                  type="checkbox"
                  checked={ticked().has(row().id)}
                  disabled={props.disabled}
                  onChange={(e) => {
                    toggle(row().id, e.currentTarget.checked)
                  }}
                />
                <span class={styles.tickName}>{row().name}</span>
                <span class={styles.tickAmount}>{row().amount}</span>
              </label>
            </li>
          )}
        </Index>
      </ul>
      <div class={styles.tickFoot}>
        <button
          type="button"
          class={styles.save}
          data-test-id={`${props.testId}-save`}
          disabled={props.disabled || (props.requireChange && !changed())}
          onClick={() => {
            props.onSave(ticked())
          }}
        >
          Save
        </button>
      </div>
    </>
  )
}

/** The problem with the last save, as an alert. */
export function SaveProblem(props: { problem: string | null; testId: string }): JSX.Element {
  return (
    <Show when={props.problem}>
      <p class={styles.problem} role="alert" data-test-id={props.testId}>
        {props.problem}
      </p>
    </Show>
  )
}
