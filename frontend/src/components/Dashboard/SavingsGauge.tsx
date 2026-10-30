/**
 * Dashboard's savings gauge (design.md 2.3): the savings rate over the last 12 tracked months, from
 * the circles' facts rather than the period picked above it, so it reads like the yearly figures it
 * is set beside. The ring says how many months it covers, and the goal is the profile's
 * (`savingsGoal` in the answers record, core/savingsGoal.ts).
 *
 * Behind the benchmarks gate (core/guidanceGate.ts): the typical band where the person lives, as an
 * arc on the ring and a line in the legend, the savings card's sentence for their band, and which
 * region it is. Without a goal of their own the band is the target while the gate is open; with it
 * closed, 20% as before. The band comes from the cards chunk (shared/guidance/cards.ts), loaded with
 * `import()` only while the gate is open, so a closed gate never fetches it.
 */
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { CLEAR_PICTURE_MONTHS } from '../../../../shared/guidance/circles'
import {
  percentText,
  principalLine,
  savingsTitle,
  shownRate,
} from '../../../../shared/guidance/savingsWords'
import { round } from '../../../../shared/retirementSettings'
import { DEFAULT_SAVINGS_GOAL } from '../../core/savingsGoal'
import { setSettingsTab } from '../../core/settingsStore'
import { createAnswerSave } from '../guidance/questionParts'
import { regionReasonText } from '../guidance/regionWords'
import NumberField from '../NumberField'
import OrbitGauge from './OrbitGauge'
import styles from './SavingsGauge.module.css'
import type { JSX } from 'solid-js'
import type * as Cards from '../../../../shared/guidance/cards'
import type { GuidanceView } from '../../core/guidance'

export const GOAL_RANGE_PROBLEM = 'Enter a goal from 0 to 100%.'
export const GOAL_SAVE_FAILED = "Couldn't save your goal. Try again."

/** Points to a goal, rounded up so a gap never reads as smaller than it is: "6.3". */
const pointsToGo = (gap: number): string => {
  const up = Math.ceil(gap * 10 - 1e-6) / 10
  return Number.isInteger(up) ? String(up) : up.toFixed(1)
}

export default function SavingsGauge(props: { view: GuidanceView | null }): JSX.Element {
  // Loaded only while the gate is open, which a build fixes: so the band shows only then too.
  const [cards, setCards] = createSignal<typeof Cards | null>(null)
  createEffect(() => {
    if (!props.view?.gate || cards() !== null) return
    void import('../../../../shared/guidance/cards').then((module) => setCards(() => module))
  })
  const band = createMemo(() => {
    const view = props.view
    const module = cards()
    if (!view || !module) return null
    return module.savingsBand(view.facts, view.words, {
      region: view.region.region,
      currency: view.inputs.currency,
      tenure: view.inputs.answers.tenure ?? null,
      adults: view.inputs.answers.adults ?? null,
    })
  })

  const save = createAnswerSave(() => props.view?.profileId ?? 0)
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal<number | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)

  const own = () => props.view?.inputs.answers.savingsGoal
  /** The goal on the ring: the person's, else 20% unless the band is the target. */
  const goal = (): number | null => {
    const mine = own()
    if (mine !== undefined) return mine
    return band() ? null : DEFAULT_SAVINGS_GOAL
  }

  const startEditing = () => {
    setDraft(own() ?? null)
    setProblem(null)
    setEditing(true)
  }

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    const value = draft()
    if (value === null || !Number.isFinite(value) || value < 0 || value > 100) {
      setProblem(GOAL_RANGE_PROBLEM)
      return
    }
    setProblem(null)
    if (await save.save({ savingsGoal: round(value, 1) })) setEditing(false)
  }

  return (
    <section class={styles.card} data-test-id="savings-gauge" aria-labelledby="savings-gauge-title">
      <div class={styles.head}>
        <h3 id="savings-gauge-title" class={styles.title}>
          Savings rate
        </h3>
        <a class={styles.details} href="#progress/5" data-test-id="savings-gauge-details">
          Details
        </a>
      </div>
      <Show
        when={props.view}
        fallback={<p class={styles.line}>Working it out from your numbers.</p>}
      >
        {(view) => {
          const facts = () => view().facts
          const months = () => facts().months.length
          const shown = () => shownRate(facts())
          return (
            <Show
              when={shown() !== null}
              fallback={
                <p class={styles.line} data-test-id="savings-gauge-waiting">
                  {facts().averaged
                    ? `No income in your last ${months()} months, so there's no rate to show.`
                    : 'Your savings rate shows once 3 months are tracked.'}
                </p>
              }
            >
              <div class={styles.body}>
                <OrbitGauge
                  value={shown()!}
                  valueText={percentText(shown()!)}
                  goal={goal() ?? undefined}
                  band={band() ? { from: band()!.from, to: band()!.to } : undefined}
                  label={`${months()} months`}
                  ariaLabel={[
                    `Savings rate ${percentText(shown()!)}% over the last ${months()} months`,
                    band() ? `typical range ${band()!.from}% to ${band()!.to}%` : null,
                    goal() === null ? null : `goal ${goal()}%`,
                  ]
                    .filter((part) => part !== null)
                    .join('; ')}
                  size={168}
                />
                <div class={styles.words}>
                  <p class={styles.headline} data-test-id="savings-gauge-title">
                    {savingsTitle(facts(), view().words)}
                  </p>
                  <Show when={band()?.comparison}>
                    {(comparison) => (
                      <p class={styles.line} data-test-id="savings-gauge-compare">
                        {comparison()}
                      </p>
                    )}
                  </Show>
                  <Show when={principalLine(facts(), view().words)}>
                    {(line) => <p class={styles.line}>{line()}</p>}
                  </Show>
                  <Show when={!facts().firm}>
                    <p class={styles.line}>
                      Based on {months()} months. It firms up at {CLEAR_PICTURE_MONTHS}.
                    </p>
                  </Show>

                  <ul class={styles.legend} aria-hidden="true">
                    <li>
                      <i class={styles.swatchYou} />
                      You, {percentText(shown()!)}%
                    </li>
                    <Show when={band()}>
                      {(b) => (
                        <li>
                          <i class={styles.swatchBand} />
                          {b().legend}
                        </li>
                      )}
                    </Show>
                    {/* A goal of 0 is a goal: not `when={goal()}`. */}
                    <Show when={goal() !== null}>
                      <li>
                        <i class={styles.swatchGoal} />
                        {own() === undefined ? 'Goal' : 'Your goal'}, {goal()}%
                      </li>
                    </Show>
                  </ul>

                  <p class={styles.goal} data-test-id="savings-gauge-goal">
                    {(() => {
                      const g = goal()
                      // The band is the target, and the legend above already says it.
                      if (g === null) return 'No goal of your own yet.'
                      const rate = shown()!
                      const lead =
                        own() === undefined
                          ? `Goal: ${g}% until you set your own.`
                          : `Your goal: ${g}%.`
                      if (rate >= g) {
                        const spare = percentText(rate - g)
                        return spare === '0'
                          ? `${lead} Reached.`
                          : `${lead} Reached, with ${spare} points to spare.`
                      }
                      const income = facts().income ?? 0
                      // Up to whole units, past float noise: 3.3 points of 3,000 is 99, not 100.
                      const perMonth = view().words.money(
                        Math.ceil(((g - rate) / 100) * income - 1e-6)
                      )
                      return `${lead} ${pointsToGo(g - rate)} points to go, about ${perMonth} a month.`
                    })()}
                  </p>

                  <Show
                    when={editing()}
                    fallback={
                      <div class={styles.actions}>
                        <button
                          type="button"
                          class={styles.button}
                          data-test-id="savings-gauge-set-goal"
                          onClick={startEditing}
                        >
                          {own() === undefined ? 'Set a goal' : 'Change goal'}
                        </button>
                        <Show when={view().gate}>
                          <p class={styles.region} data-test-id="savings-gauge-region">
                            {regionReasonText(view().region)}{' '}
                            <a
                              class={styles.inline}
                              href="#settings"
                              onClick={() => {
                                setSettingsTab('general')
                              }}
                            >
                              Change
                            </a>
                          </p>
                        </Show>
                      </div>
                    }
                  >
                    <form class={styles.form} noValidate onSubmit={(e) => void submit(e)}>
                      <label class={styles.field}>
                        <NumberField<number | null>
                          value={draft()}
                          emptyValue={null}
                          onChange={setDraft}
                          step="0.1"
                          min="0"
                          max="100"
                          class={styles.input}
                          ariaLabel="Savings goal, in percent of income"
                          ariaInvalid={problem() ? 'true' : undefined}
                          testId="savings-gauge-goal-input"
                          disabled={save.saving()}
                        />
                        <span class={styles.unit}>%</span>
                      </label>
                      <button
                        type="submit"
                        class={styles.button}
                        data-test-id="savings-gauge-save"
                        disabled={save.saving()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        class={styles.quiet}
                        onClick={() => {
                          setEditing(false)
                          setProblem(null)
                        }}
                      >
                        Cancel
                      </button>
                    </form>
                  </Show>
                  <Show when={problem() ?? (save.problem() ? GOAL_SAVE_FAILED : null)}>
                    {(said) => (
                      <p class={styles.problem} role="alert" data-test-id="savings-gauge-problem">
                        {said()}
                      </p>
                    )}
                  </Show>
                </div>
              </div>
            </Show>
          )
        }}
      </Show>
    </section>
  )
}
