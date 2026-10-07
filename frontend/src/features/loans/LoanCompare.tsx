/**
 * Compare: the loan as planned (A) beside a what-if (B), with the presets already worked out from
 * the loan. One click picks a template with its first preset; a select changes the preset; the
 * mode says what the extra payments do. "Compare both modes" sets the same what-if side by side
 * as finishing sooner and paying less each month, and "Use as A" pins B to compare against.
 *
 * Nothing here is stored: the picks live in the address (decision R7), so the page only reports
 * them upward and renders whatever the address says.
 */
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import {
  applyWhatIf,
  buildWhatIf,
  runScenario,
  templateTakesMode,
} from '../../../../shared/loanScenarios'
import { addCalendarMonths, rateStretches } from '../../../../shared/loanSchedule'
import LoanBalanceChart from './LoanBalanceChart'
import {
  bothModesSentence,
  choiceTitle,
  compareSentence,
  differenceLine,
  inMonthsLabel,
  MODE_NAMES,
  monthLong,
  monthOfYearName,
  monthShort,
  pointsLabel,
  span,
  TEMPLATE_NAMES,
  yearsEarlierLabel,
} from './loanCopy'
import styles from './Loans.module.css'
import type {
  ScenarioFacts,
  TemplateId,
  TemplateOption,
  WhatIfChoice,
} from '../../../../shared/loanScenarios'
import type { LoanInput } from '../../../../shared/loanSchedule'
import type { ChartSeries } from './LoanBalanceChart'
import type { Formats } from './loanCopy'
import type { ScenarioMode, ScenarioPick } from './loanRoute'

interface Props {
  loan: LoanInput
  /** The month of the next payment; null once the loan is repaid. */
  from: number | null
  options: TemplateOption[]
  b: ScenarioPick | null
  a: ScenarioPick | null
  onPick: (b: ScenarioPick | null, a: ScenarioPick | null) => void
  formats: Formats
  axisMoney: (amount: number) => string
}

/** A field of a template's choice: how its select is labelled and how each value reads. */
interface FieldSpec {
  key: string
  label: string
  text: (value: number) => string
}

function fieldsOf(template: TemplateId, f: Formats): FieldSpec[] {
  const money = (v: number) => f.wholeMoney(v)
  switch (template) {
    case 'more-each-month':
      return [{ key: 'amount', label: 'More each month', text: money }]
    case 'round-up':
      return [{ key: 'target', label: 'Pay each month', text: money }]
    case 'one-payment':
      return [
        { key: 'amount', label: 'Amount', text: money },
        { key: 'inMonths', label: 'When', text: inMonthsLabel },
      ]
    case 'yearly-bonus':
      return [
        { key: 'amount', label: 'Amount', text: money },
        { key: 'monthOfYear', label: 'Every', text: monthOfYearName },
      ]
    case 'extra-installment':
      return [{ key: 'monthOfYear', label: 'Every', text: monthOfYearName }]
    case 'done-by':
      return [{ key: 'yearsEarlier', label: 'Done', text: yearsEarlierLabel }]
    case 'rate-change':
      return [{ key: 'points', label: 'Rate from the next payment', text: pointsLabel }]
  }
}

const MODE_ORDER: ScenarioMode[] = ['shorten', 'lower', 'both']

/** One side of the comparison. `base` is what B is measured against; none for A itself. */
interface Side {
  key: string
  swatch: 'a' | 'b'
  /** "A" or "B"; empty when both sides are B, set as the two modes. */
  letter: string
  title: string
  mode: string
  facts: ScenarioFacts
  base: ScenarioFacts | null
  /** What the pick adds to every payment from the next one, if anything. */
  monthlyExtra: number
}

export default function LoanCompare(props: Props) {
  const f = () => props.formats
  const from = () => props.from ?? 1

  const run = (pick: ScenarioPick | null, mode: 'shorten' | 'lower') =>
    pick ? applyWhatIf(props.loan, buildWhatIf(props.loan, from(), pick.choice, mode)) : props.loan

  const aMode = () => (props.a?.mode === 'lower' ? 'lower' : 'shorten')
  const bMode = (): ScenarioMode =>
    props.b && templateTakesMode(props.b.choice.template) ? props.b.mode : 'shorten'

  const aLoan = createMemo(() => run(props.a, aMode()))
  const A = createMemo(() => runScenario(aLoan(), from()))
  const bLoan = createMemo(() =>
    props.b && bMode() !== 'both' ? run(props.b, bMode() as 'shorten' | 'lower') : null
  )
  const B = createMemo(() => {
    const loan = bLoan()
    return loan ? runScenario(loan, from()) : null
  })
  const both = createMemo(() =>
    props.b && bMode() === 'both'
      ? {
          sooner: runScenario(run(props.b, 'shorten'), from()),
          lower: runScenario(run(props.b, 'lower'), from()),
        }
      : null
  )

  const installmentNow = () => A().installmentNow
  const titleOf = (choice: WhatIfChoice) => choiceTitle(choice, f(), installmentNow())
  const aTitle = () => (props.a ? titleOf(props.a.choice) : 'As planned')
  const bTitle = () => (props.b ? titleOf(props.b.choice) : '')
  const savedCount = () => props.loan.prepayments?.length ?? 0
  const modeLine = (pick: ScenarioPick | null, mode: ScenarioMode) => {
    if (!pick) {
      const n = savedCount()
      if (n === 0) return 'Your loan as it stands'
      return n === 1 ? 'With your saved extra payment' : `With your ${n} saved extra payments`
    }
    if (pick.choice.template === 'done-by') return 'Finish sooner, by paying more each month'
    if (pick.choice.template === 'rate-change') return 'The installment changes with the rate'
    return MODE_NAMES[mode]
  }

  /** The extra a pick adds to every payment from the next one: a monthly rule, or done-by's. */
  const monthlyExtra = (pick: ScenarioPick | null, mode: 'shorten' | 'lower') =>
    pick
      ? buildWhatIf(props.loan, from(), pick.choice, mode)
          .every.filter((rule) => rule.every_months === 1 && rule.from_month <= from())
          .reduce((sum, rule) => sum + rule.amount, 0)
      : 0

  const sides = createMemo<Side[]>(() => {
    const aSide: Side = {
      key: 'a',
      swatch: 'a',
      letter: 'A',
      title: aTitle(),
      mode: modeLine(props.a, aMode()),
      facts: A(),
      base: null,
      monthlyExtra: monthlyExtra(props.a, aMode()),
    }
    const pair = both()
    if (pair) {
      // The same what-if twice: the mode is what tells the two apart, so it heads each side.
      return [
        {
          key: 'shorten',
          swatch: 'a',
          letter: '',
          title: MODE_NAMES.shorten,
          mode: bTitle(),
          facts: pair.sooner,
          base: A(),
          monthlyExtra: monthlyExtra(props.b, 'shorten'),
        },
        {
          key: 'lower',
          swatch: 'b',
          letter: '',
          title: MODE_NAMES.lower,
          mode: bTitle(),
          facts: pair.lower,
          base: A(),
          monthlyExtra: monthlyExtra(props.b, 'lower'),
        },
      ]
    }
    const b = B()
    if (!b) return [aSide]
    const mode = bMode() === 'lower' ? 'lower' : 'shorten'
    return [
      aSide,
      {
        key: 'b',
        swatch: 'b',
        letter: 'B',
        title: bTitle(),
        mode: modeLine(props.b, bMode()),
        facts: b,
        base: A(),
        monthlyExtra: monthlyExtra(props.b, mode),
      },
    ]
  })

  /** The rate and date of the month B stops being repaid in, for the sentence. */
  const never = () => {
    const b = B()
    const loan = bLoan()
    if (!b || !loan || b.neverPaysOffFrom === null) return null
    return {
      rate: rateStretches(loan, b.neverPaysOffFrom)[0]?.rate ?? null,
      date: addCalendarMonths(props.loan.start_date, b.neverPaysOffFrom - 1) || null,
    }
  }

  const sentence = createMemo(() => {
    const pair = both()
    if (pair) return bothModesSentence(A(), pair.sooner, pair.lower, from(), f())
    const b = B()
    if (b)
      return compareSentence({ a: A(), b, from: from(), aIsPlan: !props.a, never: never() }, f())
    const a = A()
    if (a.payoffMonth === null)
      return 'As planned this loan is never repaid: the installment no longer covers the interest.'
    return `As planned the loan is done in ${monthLong(a.payoffDate, a.payoffMonth)}, with ${f().wholeMoney(a.totalInterest)} paid in interest. Pick a what-if above to see what would change.`
  })

  const diff = createMemo(() => {
    const pair = both()
    if (pair) {
      return [
        `${MODE_NAMES.shorten}: ${differenceLine(A(), pair.sooner, from(), f())}`,
        `${MODE_NAMES.lower}: ${differenceLine(A(), pair.lower, from(), f())}`,
      ]
    }
    const b = B()
    return b ? [differenceLine(A(), b, from(), f())] : []
  })

  const startBalance = () => {
    const rows = A().rows
    return from() <= 1 ? props.loan.principal : (rows[from() - 2]?.balance ?? 0)
  }

  const chartSeries = createMemo<ChartSeries[]>(() =>
    sides().map((s) => ({
      key: s.swatch,
      label: both() ? s.title : s.letter,
      rows: s.facts.rows,
      payoffMonth: s.facts.payoffMonth,
    }))
  )

  const chartCaption = () => {
    if (both())
      return 'What is still owed each month, finishing sooner against paying less each month.'
    if (B())
      return `What is still owed each month: A (${props.a ? aTitle() : 'as planned'}) against B (${bTitle()}).`
    return 'What is still owed each month, as planned.'
  }

  const chartDescription = () =>
    sides()
      .map((s) => {
        const name = both() ? s.title : `${s.letter}, ${s.title}`
        return s.facts.payoffMonth === null
          ? `${name}: never repaid.`
          : `${name}: repaid in ${monthLong(s.facts.payoffDate, s.facts.payoffMonth)}.`
      })
      .join(' ')

  // ── Picking ─────────────────────────────────────────────────────────────

  const pickTemplate = (option: TemplateOption) => {
    const mode = templateTakesMode(option.template) ? (props.b ? bMode() : 'shorten') : 'shorten'
    props.onPick({ choice: option.first, mode }, props.a)
  }

  // On a phone the chips scroll sideways and the strip starts at its left end, so a pick past the
  // edge, Rate change after a reload, would sit out of sight. The picked chip is brought into view
  // when the strip appears and whenever another template is picked; another preset of the same
  // template leaves the strip where it is. At once when the strip appears or motion is turned
  // down, gliding otherwise.
  const [strip, setStrip] = createSignal<HTMLDivElement>()
  const pickedTemplate = createMemo(() => props.b?.choice.template)
  createEffect(
    on([strip, pickedTemplate], ([el], before) => {
      const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
      const glide =
        before?.[0] === el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      chip?.scrollIntoView({
        block: 'nearest',
        inline: 'center',
        behavior: glide ? 'smooth' : 'auto',
      })
    })
  )

  const setField = (key: string, value: number) => {
    if (!props.b) return
    props.onPick(
      { ...props.b, choice: { ...props.b.choice, [key]: value } as WhatIfChoice },
      props.a
    )
  }

  const setMode = (mode: ScenarioMode) => {
    if (props.b) props.onPick({ ...props.b, mode }, props.a)
  }

  const onModeKey = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const step = keys[e.key]
    if (!step) return
    e.preventDefault()
    const i = MODE_ORDER.indexOf(bMode())
    const next = MODE_ORDER[(i + step + MODE_ORDER.length) % MODE_ORDER.length]
    setMode(next)
    const group = e.currentTarget as HTMLElement
    queueMicrotask(() => group.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus())
  }

  const presetsFor = (template: TemplateId) =>
    (props.options.find((o) => o.template === template)?.presets ?? {}) as Record<string, number[]>

  const valuesFor = (key: string): number[] => {
    if (!props.b) return []
    const current = (props.b.choice as unknown as Record<string, number>)[key]
    const offered = presetsFor(props.b.choice.template)[key] ?? []
    return offered.includes(current) ? offered : [...offered, current].sort((x, y) => x - y)
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  const money = (n: number | null) => (n === null ? '–' : f().money(n))

  const installmentNote = (facts: ScenarioFacts): string | null => {
    const changes = facts.installmentChanges
    if (changes.length === 0) return null
    const first = changes[0]
    if (changes.length > 3) {
      const last = changes[changes.length - 1]
      const direction = last.installment < (facts.installmentNow ?? 0) ? 'falls' : 'rises'
      return `${direction} to ${f().money(last.installment)} by ${monthShort(last.date, last.month)}`
    }
    return `then ${f().money(first.installment)} from ${monthShort(first.date, first.month)}`
  }

  const endNote = (side: Side): string | null => {
    if (!side.base || side.facts.payoffMonth === null || side.base.payoffMonth === null) return null
    const months = side.base.payoffMonth - side.facts.payoffMonth
    if (months === 0) return 'same end date'
    return `${span(months)} ${months > 0 ? 'sooner' : 'later'}`
  }

  /** Interest saved against A, or the interest added when B costs more (a rate rise). */
  const saved = (side: Side): { label: string; text: string } => {
    if (!side.base || side.facts.payoffMonth === null || side.base.payoffMonth === null)
      return { label: 'Interest saved', text: '–' }
    const value = side.base.totalInterest - side.facts.totalInterest
    return value < 0
      ? { label: 'Extra interest', text: f().money(-value) }
      : { label: 'Interest saved', text: f().money(value) }
  }

  return (
    <div class={styles.panel} data-test-id="loans-compare">
      <Show
        when={props.from !== null && props.options.length > 0}
        fallback={
          <p class={styles.prompt} data-test-id="loans-compare-done">
            {props.from === null
              ? 'This loan is paid off, so there is nothing left to compare.'
              : 'Only the last payment is left, so there is nothing left to compare.'}
          </p>
        }
      >
        <div
          ref={setStrip}
          class={styles.chips}
          role="group"
          aria-label="What if"
          data-test-id="loans-templates"
        >
          <For each={props.options}>
            {(option) => (
              <button
                type="button"
                class={styles.chip}
                aria-pressed={props.b?.choice.template === option.template}
                data-test-id={`loans-template-${option.template}`}
                onClick={() => {
                  pickTemplate(option)
                }}
              >
                {TEMPLATE_NAMES[option.template]}
              </button>
            )}
          </For>
        </div>

        <Show when={props.b}>
          {(b) => (
            <div class={styles.controls} data-test-id="loans-compare-controls">
              <For each={fieldsOf(b().choice.template, f())}>
                {(field) => (
                  <label class={styles.field}>
                    {field.label}
                    <select
                      class={styles.select}
                      data-test-id={`loans-preset-${field.key}`}
                      value={String((b().choice as unknown as Record<string, number>)[field.key])}
                      onChange={(e) => {
                        setField(field.key, Number(e.currentTarget.value))
                      }}
                    >
                      <For each={valuesFor(field.key)}>
                        {(value) => <option value={String(value)}>{field.text(value)}</option>}
                      </For>
                    </select>
                  </label>
                )}
              </For>

              <Show when={templateTakesMode(b().choice.template)}>
                <div
                  class={styles.segments}
                  role="radiogroup"
                  aria-label="What the extra payments do"
                  onKeyDown={onModeKey}
                >
                  <For each={MODE_ORDER}>
                    {(mode) => (
                      <button
                        type="button"
                        role="radio"
                        class={styles.segment}
                        aria-checked={bMode() === mode}
                        tabIndex={bMode() === mode ? 0 : -1}
                        data-mode={mode}
                        data-test-id={`loans-mode-${mode}`}
                        onClick={() => {
                          setMode(mode)
                        }}
                      >
                        {MODE_NAMES[mode]}
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={bMode() !== 'both'}>
                <button
                  type="button"
                  class={styles.button}
                  data-test-id="loans-use-as-a"
                  onClick={() => {
                    props.onPick(null, { choice: b().choice, mode: bMode() })
                  }}
                >
                  Use as A
                </button>
              </Show>
              <Show when={props.a}>
                <button
                  type="button"
                  class={styles.buttonQuiet}
                  data-test-id="loans-reset-a"
                  onClick={() => {
                    props.onPick(props.b, null)
                  }}
                >
                  Back to as planned
                </button>
              </Show>
            </div>
          )}
        </Show>

        <p class={styles.sentence} data-test-id="loans-compare-sentence" aria-live="polite">
          {sentence()}
        </p>

        <div class={styles.sides}>
          <For each={sides()}>
            {(side) => (
              <section
                class={styles.side}
                data-test-id={`loans-compare-side-${side.key}`}
                aria-label={`${side.letter ? `${side.letter}: ` : ''}${side.title}, ${side.mode}`}
              >
                <div class={styles.sideHead}>
                  <span
                    class={`${styles.swatch} ${side.swatch === 'a' ? styles.swatchA : styles.swatchB}`}
                    aria-hidden="true"
                  />
                  <span class={styles.sideLetter}>{side.letter}</span>
                  <h3 class={styles.sideTitle} data-test-id={`loans-compare-${side.key}-title`}>
                    {side.title}
                  </h3>
                  <p class={styles.sideMode}>{side.mode}</p>
                </div>
                <dl class={styles.rows}>
                  <div>
                    <dt>Done in</dt>
                    <dd data-test-id={`loans-compare-${side.key}-payoff`}>
                      {side.facts.payoffMonth === null
                        ? 'Never'
                        : monthShort(side.facts.payoffDate, side.facts.payoffMonth)}
                      <Show when={endNote(side)}>{(note) => <small>{note()}</small>}</Show>
                    </dd>
                  </div>
                  <div>
                    <dt>Installment now</dt>
                    <dd data-test-id={`loans-compare-${side.key}-installment`}>
                      {money(side.facts.installmentNow)}
                      <Show when={side.monthlyExtra > 0}>
                        <small>plus {f().money(side.monthlyExtra)} extra a month</small>
                      </Show>
                      <Show when={installmentNote(side.facts)}>
                        {(note) => <small>{note()}</small>}
                      </Show>
                    </dd>
                  </div>
                  <div>
                    <dt>Total interest</dt>
                    <dd data-test-id={`loans-compare-${side.key}-interest`}>
                      {side.facts.payoffMonth === null ? '–' : f().money(side.facts.totalInterest)}
                    </dd>
                  </div>
                  <div>
                    <dt>{saved(side).label}</dt>
                    <dd data-test-id={`loans-compare-${side.key}-saved`}>{saved(side).text}</dd>
                  </div>
                  <div>
                    <dt>Paid extra</dt>
                    <dd data-test-id={`loans-compare-${side.key}-extra`}>
                      {f().money(side.facts.totalExtra)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}
          </For>
          <Show when={!props.b}>
            <p class={styles.prompt} data-test-id="loans-compare-prompt">
              Pick a what-if above to compare it with {props.a ? 'A' : 'your loan as planned'}.
            </p>
          </Show>
        </div>

        <figure class={styles.chartCard} style={{ margin: 0 }}>
          <figcaption class={styles.chartCaption}>{chartCaption()}</figcaption>
          <LoanBalanceChart
            series={chartSeries()}
            from={from()}
            startBalance={startBalance()}
            axisMoney={props.axisMoney}
            description={chartDescription()}
          />
        </figure>

        <Show when={diff().length > 0}>
          <div class={styles.diffBar} data-test-id="loans-compare-diff" aria-hidden="true">
            <For each={diff()}>{(line) => <div>{line}</div>}</For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
