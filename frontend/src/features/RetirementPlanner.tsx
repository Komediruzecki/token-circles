/**
 * Retirement planner.
 *
 * The assumptions behind the projection, and the projection itself. Every number on the
 * chart traces back to a field on this panel, and every field is editable — the page used
 * to draw a projection from server defaults nobody could reach, which made the whole thing
 * look like a fixed picture of someone else's retirement.
 *
 * The projection is computed here, in the browser, from shared/retirement.ts. That is the
 * same module the Worker runs, so nothing is lost by not asking it: the chart redraws on
 * every keystroke instead of after a round trip, and the two still agree by construction.
 * Only saving talks to the server.
 */
import { createMemo, createSignal, For, Index, Show } from 'solid-js'
import { projectRetirement, yearsOfWithdrawals } from '../../../shared/retirement'
import {
  DEFAULT_SETTINGS,
  effectiveReturnPct,
  monthOf,
  normalizeSettings,
  RETURN_SCENARIOS,
  round,
  settingsToInput,
} from '../../../shared/retirementSettings'
import Chart from '../components/Chart'
import InfoTip from '../components/InfoTip'
import MonthPicker from '../components/MonthPicker'
import NumberField from '../components/NumberField'
import OrbitalDivider from '../components/OrbitalDivider'
import RangeField from '../components/RangeField'
import Toggle from '../components/Toggle'
import { apiGet, apiPut, formatCurrency, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { refetchOnActive } from '../core/pageVisibility'
import { theme } from '../core/theme'
import { lifestyleMarkersPlugin } from './lifestyleMarkers'
import styles from './RetirementPage.module.css'
import type { ExpensePeriod, IncomeStep, Lifestyle } from '../../../shared/retirement'
import type { DerivedField, RetirementSettings } from '../../../shared/retirementSettings'
import type { LifestyleMarker } from './lifestyleMarkers'

interface SettingsResponse {
  settings: RetirementSettings
  filled: DerivedField[]
  missing: string[]
  startMonth: string
}

/** A field's label, so `filled` can name what it took in words rather than in field names. */
const FIELD_LABELS: Record<string, string> = {
  netWorth: 'Current net worth',
  monthlyIncome: 'Monthly income',
  monthlyExpenses: 'Monthly spending',
  monthlyContribution: 'Monthly contribution',
  lifestyles: 'Retirement spending',
  birthMonth: 'Date of birth',
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/**
 * One colour per lifestyle, shared by its dashed target line and its marker on the chart
 * so the two read as the same thing without a second legend entry. Index 0 is the net
 * worth line's green, so lifestyles start at 1.
 */
const LIFESTYLE_PALETTE = ['#59d2a2', '#6e9bff', '#f0a860', '#d98ce0']

// Year ranges for the month pickers. A plan can reach back a few years — people record a
// pay step that already happened — and forward across a working life and then some.
const NOW_YEAR = new Date().getFullYear()
const PLAN_FROM_YEAR = NOW_YEAR - 5
const PLAN_TO_YEAR = NOW_YEAR + 80

export default function RetirementPlanner() {
  const state = useAppState()
  const [settings, setSettings] = createSignal<RetirementSettings>(DEFAULT_SETTINGS)
  const [filled, setFilled] = createSignal<DerivedField[]>([])
  const [startMonth, setStartMonth] = createSignal(monthOf(new Date()))
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [showNominal, setShowNominal] = createSignal(false)
  const [showBand, setShowBand] = createSignal(false)
  // On by default: the date each lifestyle becomes affordable is the answer the page
  // exists to give, and leaving it off by default hides it behind a preference.
  const [showMarkers, setShowMarkers] = createSignal(true)

  const chartColors = () => theme.getChartColors()

  const load = async () => {
    try {
      const res = await apiGet<SettingsResponse>('/api/retirement/settings')
      setSettings(normalizeSettings(res.settings))
      setFilled(res.filled || [])
      if (res.startMonth) setStartMonth(res.startMonth)
      setDirty(false)
    } catch (err) {
      console.error('Failed to load retirement settings', err)
      showToast('Failed to load your retirement assumptions', 'error')
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiPut<Pick<SettingsResponse, 'settings' | 'filled'>>(
        '/api/retirement/settings',
        settings()
      )
      // Take back what was stored rather than what was sent: the server normalises, and the
      // panel should show what will actually be used next time.
      setSettings(normalizeSettings(res.settings))
      // Saving is exactly what stops a field being derived, so the provenance note has to
      // come back from the save too. Without this it kept crediting "your data" for figures
      // the user had just entered by hand.
      setFilled(res.filled || [])
      setDirty(false)
      showToast('Retirement assumptions saved', 'success')
    } catch (err) {
      console.error('Failed to save retirement settings', err)
      showToast('Failed to save your retirement assumptions', 'error')
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof RetirementSettings>(key: K, value: RetirementSettings[K]) => {
    setSettings({ ...settings(), [key]: value })
    setDirty(true)
  }

  const projection = createMemo(() => projectRetirement(settingsToInput(settings(), startMonth())))

  /**
   * A withdrawal rate is a claim about how much of the pot you take each year, so raising it
   * lowers the target and brings the date forward — which looks like a free lunch until you
   * ask how long the money lasts. That is the number this works out, and the field says it.
   */
  const withdrawalRunway = createMemo(() =>
    yearsOfWithdrawals(settings().safeWithdrawalRatePct, projection().realAnnualReturnPct)
  )

  const swrSustainable = createMemo(() => !Number.isFinite(withdrawalRunway()))

  /**
   * The age the pot would empty at: the age the first lifestyle is reached, plus the
   * runway. The first is the one the cards mark as primary, and a single chip has to pick
   * one — a plan reached at 36 and one reached at 52 do not run out at the same age even
   * on the same rate, which is the part a runway in years alone does not convey.
   *
   * Null unless there is a date of birth to count ages from and a crossing to count from.
   */
  const runsOutAtAge = createMemo(() => {
    if (swrSustainable()) return null
    const crossing = projection().lifestyles[0]?.crossing
    if (!crossing || crossing.age === null) return null
    return Math.round(crossing.age + withdrawalRunway())
  })

  /**
   * What the withdrawal rate means, in the one place a user will look for it. Written out
   * rather than left to the reader because the rate is the single most misread control on
   * this page: a bigger number reads as "more money", when the spending never changes and
   * only the pot you call sufficient does.
   */
  const swrExplainer = createMemo(() => {
    const rate = settings().safeWithdrawalRatePct
    if (rate <= 0)
      return 'The share of your pot you take in your first retired year. 4% is the usual rule of thumb.'
    const multiple = (100 / rate).toFixed(0)
    const real = projection().realAnnualReturnPct.toFixed(2)
    const lasts = swrSustainable()
      ? `Growth of ${real}% after inflation covers it, so the pot is never spent down.`
      : `At ${real}% growth after inflation the pot empties after about ${Math.round(withdrawalRunway())} years.`
    return (
      `The share of your pot you take in your first retired year — and after that, the same amount ` +
      `raised with inflation, not the same percentage. It sets the pot you need: ${multiple}x your ` +
      `annual spending. Raising it is not more money to live on; the spending is unchanged. It only ` +
      `calls a smaller pot enough, which is why it retires you sooner. ${lasts} 4% is the usual rule of thumb.`
    )
  })

  /**
   * A marker per lifestyle that is actually reached inside the projection. The x is in
   * chart-point units: the chart plots one point a year and a crossing lands on a month,
   * so twelfths are the resolution the line is drawn at.
   */
  const markers = createMemo<LifestyleMarker[]>(() =>
    projection().lifestyles.flatMap((lifestyle, i) => {
      const crossing = lifestyle.crossing
      if (!crossing) return []
      return [
        {
          x: crossing.index / 12,
          label: lifestyle.label,
          color: LIFESTYLE_PALETTE[(i + 1) % LIFESTYLE_PALETTE.length],
        },
      ]
    })
  )

  const scenarios = createMemo(() => {
    if (!showBand()) return []
    const base = effectiveReturnPct(settings())
    return RETURN_SCENARIOS.filter((s) => s.offsetPct !== 0).map((s) => ({
      ...s,
      projection: projectRetirement({
        ...settingsToInput(settings(), startMonth()),
        annualReturnPct: base + s.offsetPct,
      }),
    }))
  })

  /** One point a year keeps a sixty-year projection readable and the canvas cheap. */
  const yearly = <T,>(rows: T[], pick: (row: T) => number): number[] =>
    rows.filter((_, i) => i % 12 === 0).map(pick)

  const axisLabels = createMemo(() =>
    projection()
      .rows.filter((_, i) => i % 12 === 0)
      .map((r) => (r.age === null ? r.month.slice(0, 4) : String(r.age)))
  )

  const value = (row: { netWorth: number; netWorthReal: number }) =>
    showNominal() ? row.netWorth : row.netWorthReal

  /**
   * The target line. In today's money it is flat, which is the whole point of reading the
   * chart in real terms — the line you are chasing stops moving. In nominal terms it climbs
   * with inflation, and the crossing is at the same month either way.
   */
  const targetSeries = (lifestyle: { targetToday: number }) => {
    const rate = projection().monthlyInflationRate
    return projection()
      .rows.filter((_, i) => i % 12 === 0)
      .map((r) =>
        showNominal() ? lifestyle.targetToday * Math.pow(1 + rate, r.index) : lifestyle.targetToday
      )
  }

  const chartData = createMemo(() => {
    const p = projection()
    return {
      labels: axisLabels(),
      datasets: [
        {
          label: showNominal() ? 'Net worth' : "Net worth (today's money)",
          data: yearly(p.rows, value),
          borderColor: '#59d2a2',
          backgroundColor: 'rgba(89, 210, 162, 0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
        ...scenarios().map((s, i) => ({
          label: `${s.label} (${(effectiveReturnPct(settings()) + s.offsetPct).toFixed(1)}%)`,
          data: yearly(s.projection.rows, value),
          borderColor: i === 0 ? '#e08a8a' : '#8ad0e0',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1,
          borderDash: [2, 3],
        })),
        ...p.lifestyles.map((l, i) => ({
          label: `${l.label} target`,
          data: targetSeries(l),
          borderColor: LIFESTYLE_PALETTE[(i + 1) % LIFESTYLE_PALETTE.length],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [6, 4],
        })),
      ],
    }
  })

  const chartOptions = createMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    scales: {
      x: {
        title: {
          display: true,
          text: settings().birthMonth ? 'Age' : 'Year',
          color: chartColors().text,
        },
        ticks: { color: chartColors().text, maxTicksLimit: 12 },
        grid: { color: chartColors().border },
      },
      y: {
        beginAtZero: true,
        ticks: {
          callback: (v: any) => formatCurrency(v),
          color: chartColors().text,
        },
        grid: { color: chartColors().border },
      },
    },
    plugins: {
      legend: {
        display: true,
        labels: { usePointStyle: true, padding: 15, font: { size: 12 }, color: chartColors().text },
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
        },
      },
      // Read by lifestyleMarkersPlugin. Empty rather than absent when the toggle is off:
      // the plugin instance is shared across updates and only its options change.
      lifestyleMarkers: { markers: showMarkers() ? markers() : [] },
    },
  }))

  const crossingText = (crossing: { month: string; age: number | null } | null): string => {
    if (!crossing) return 'Not within this projection'
    const [year, month] = crossing.month.split('-')
    const when = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
    return crossing.age === null ? when : `Age ${crossing.age}, ${when}`
  }

  const addLifestyle = () => {
    const next: Lifestyle = {
      id: `lifestyle-${Date.now()}`,
      label: 'New lifestyle',
      monthlySpendToday: 2000,
    }
    update('lifestyles', [...settings().lifestyles, next])
  }

  const updateLifestyle = (id: string, patch: Partial<Lifestyle>) => {
    update(
      'lifestyles',
      settings().lifestyles.map((l) => (l.id === id ? { ...l, ...patch } : l))
    )
  }

  const removeLifestyle = (id: string) => {
    const remaining = settings().lifestyles.filter((l) => l.id !== id)
    // The projection needs something to aim at; the last one stays.
    if (remaining.length > 0) update('lifestyles', remaining)
  }

  const addStep = () => {
    const next: IncomeStep = {
      fromMonth: `${new Date().getFullYear() + 1}-01`,
      monthlyAmount: Math.round(settings().monthlyIncome * 1.2),
    }
    update('incomeSteps', [...settings().incomeSteps, next])
  }

  const addPeriod = () => {
    const next: ExpensePeriod = {
      fromMonth: `${new Date().getFullYear() + 1}-01`,
      monthlyAmount: 500,
    }
    update('expensePeriods', [...settings().expensePeriods, next])
  }

  // Assumptions, derived defaults and the facts behind them are all profile-scoped, so a
  // profile switch has to re-ask the server. Pages stay mounted under the keep-alive host
  // (#317), so onMount fires once per session and left the panel showing the old profile's
  // plan. refetchOnActive reloads while visible and defers while hidden.
  refetchOnActive(
    'retirement',
    () => {
      void state.profileVersion
    },
    () => {
      void load()
    }
  )

  return (
    <div class={styles.planner} data-test-id="retirement-planner" data-tour="retirement-planner">
      <OrbitalDivider id="retirement-sec-planner" label="Your Plan" />

      <Show when={!loading()} fallback={<div class={styles.emptyState}>Loading your plan...</div>}>
        <Show when={filled().length > 0}>
          <div class={styles.derivedNote} data-test-id="retirement-derived-note">
            {/* The same circled-i as InfoTip, drawn larger: this note is the page's own
                voice explaining where its numbers came from, and at 16px it read as a
                stray bullet rather than the mark the rest of the app uses. */}
            <svg
              class={styles.derivedIcon}
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path stroke-linecap="round" d="M12 16v-4m0-4h.01" />
            </svg>
            <div>
              <strong>Filled in from your data.</strong> Change anything that looks wrong — these
              are starting points, not decisions.
              <ul class={styles.derivedList}>
                <For each={filled()}>
                  {(f) => (
                    <li>
                      <span class={styles.derivedField}>{labelFor(f.field)}</span>
                      <span class={styles.derivedSource}>{f.source}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
        </Show>

        <div class={styles.plannerLayout}>
          <form
            class={styles.assumptions}
            data-test-id="retirement-assumptions"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div class={styles.modeToggle} role="group" aria-label="Calculator detail">
              <button
                type="button"
                data-test-id="retirement-mode-simple"
                class={`${styles.modeButton} ${settings().mode === 'simple' ? styles.modeActive : ''}`}
                aria-pressed={settings().mode === 'simple'}
                onClick={() => {
                  update('mode', 'simple')
                }}
              >
                Simple
              </button>
              <button
                type="button"
                data-test-id="retirement-mode-advanced"
                class={`${styles.modeButton} ${settings().mode === 'advanced' ? styles.modeActive : ''}`}
                aria-pressed={settings().mode === 'advanced'}
                onClick={() => {
                  update('mode', 'advanced')
                }}
              >
                Advanced
              </button>
            </div>
            <p class={styles.modeHint}>
              {settings().mode === 'simple'
                ? 'One contribution a month, at one rate of return.'
                : 'Income and spending projected separately, with planned pay steps and spending periods.'}
            </p>

            <div class={styles.formRow}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-networth">
                  Current net worth
                </label>
                <NumberField
                  id="ret-networth"
                  step="0.01"
                  class={styles.formControl}
                  testId="retirement-input-networth"
                  value={settings().netWorth}
                  onChange={(v) => {
                    update('netWorth', v)
                  }}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-birth">
                  Date of birth
                  <InfoTip
                    testId="retirement-info-birth"
                    text="Used to label the chart with your age instead of the year, and to work out how long a plan that stops at an age has to run."
                  />
                </label>
                <MonthPicker
                  id="ret-birth"
                  class={styles.monthPicker}
                  testId="retirement-input-birth"
                  ariaLabel="Date of birth"
                  fromYear={NOW_YEAR - 120}
                  toYear={NOW_YEAR}
                  allowEmpty
                  value={settings().birthMonth}
                  onChange={(v) => {
                    update('birthMonth', v)
                  }}
                />
              </div>
            </div>

            <Show when={settings().mode === 'simple'}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-contribution">
                  Monthly contribution
                </label>
                <NumberField
                  id="ret-contribution"
                  step="0.01"
                  class={styles.formControl}
                  testId="retirement-input-contribution"
                  value={settings().monthlyContribution}
                  onChange={(v) => {
                    update('monthlyContribution', v)
                  }}
                />
              </div>
            </Show>

            <Show when={settings().mode === 'advanced'}>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel} for="ret-income">
                    Monthly income
                  </label>
                  <NumberField
                    id="ret-income"
                    step="0.01"
                    class={styles.formControl}
                    testId="retirement-input-income"
                    value={settings().monthlyIncome}
                    onChange={(v) => {
                      update('monthlyIncome', v)
                    }}
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel} for="ret-expenses">
                    Monthly spending
                  </label>
                  <NumberField
                    id="ret-expenses"
                    step="0.01"
                    class={styles.formControl}
                    testId="retirement-input-expenses"
                    value={settings().monthlyExpenses}
                    onChange={(v) => {
                      update('monthlyExpenses', v)
                    }}
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-raise">
                  Annual pay rise (%)
                  <InfoTip
                    testId="retirement-info-raise"
                    text="Applied every January, unless a pay step beats it."
                  />
                </label>
                <NumberField
                  id="ret-raise"
                  step="0.01"
                  class={styles.formControl}
                  testId="retirement-input-raise"
                  value={settings().annualRaisePct}
                  onChange={(v) => {
                    update('annualRaisePct', v)
                  }}
                />
              </div>

              <fieldset class={styles.subSection} data-test-id="retirement-income-steps">
                <legend class={styles.subLegend}>
                  Planned pay steps
                  <InfoTip
                    testId="retirement-info-steps"
                    text="What you will earn from that month on. Lower than today is a pay cut or a sabbatical, and is projected as one; raises carry on from there."
                  />
                </legend>
                <Index each={settings().incomeSteps}>
                  {(step, i) => (
                    <div class={styles.listRow}>
                      <MonthPicker
                        class={styles.monthPicker}
                        ariaLabel="Pay step start month"
                        fromYear={PLAN_FROM_YEAR}
                        toYear={PLAN_TO_YEAR}
                        value={step().fromMonth}
                        onChange={(v) => {
                          update(
                            'incomeSteps',
                            settings().incomeSteps.map((s, j) =>
                              j === i ? { ...s, fromMonth: v ?? '' } : s
                            )
                          )
                        }}
                      />
                      <NumberField
                        step="0.01"
                        class={styles.formControl}
                        ariaLabel="Monthly income from then"
                        value={step().monthlyAmount}
                        onChange={(v) => {
                          update(
                            'incomeSteps',
                            settings().incomeSteps.map((s, j) =>
                              j === i ? { ...s, monthlyAmount: v } : s
                            )
                          )
                        }}
                      />
                      <button
                        type="button"
                        class={`${styles.btnSm} ${styles.btnGhost}`}
                        aria-label="Remove pay step"
                        onClick={() => {
                          update(
                            'incomeSteps',
                            settings().incomeSteps.filter((_, j) => j !== i)
                          )
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </Index>
                <button
                  type="button"
                  class={`${styles.btnSm} ${styles.btnSecondary}`}
                  data-test-id="retirement-add-step"
                  onClick={addStep}
                >
                  Add pay step
                </button>
              </fieldset>

              <fieldset class={styles.subSection} data-test-id="retirement-expense-periods">
                <legend class={styles.subLegend}>
                  Planned spending
                  <InfoTip
                    testId="retirement-info-periods"
                    text="Leave the end blank for spending that carries on. A negative amount is a planned saving."
                  />
                </legend>
                <Index each={settings().expensePeriods}>
                  {(period, i) => (
                    <div class={styles.listRow}>
                      <MonthPicker
                        class={styles.monthPicker}
                        ariaLabel="Spending period start"
                        fromYear={PLAN_FROM_YEAR}
                        toYear={PLAN_TO_YEAR}
                        value={period().fromMonth}
                        onChange={(v) => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.map((p, j) =>
                              j === i ? { ...p, fromMonth: v ?? '' } : p
                            )
                          )
                        }}
                      />
                      <MonthPicker
                        class={styles.monthPicker}
                        ariaLabel="Spending period end"
                        fromYear={PLAN_FROM_YEAR}
                        toYear={PLAN_TO_YEAR}
                        allowEmpty
                        emptyLabel="Ongoing"
                        value={period().toMonth}
                        onChange={(v) => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.map((p, j) =>
                              j === i ? { ...p, toMonth: v ?? undefined } : p
                            )
                          )
                        }}
                      />
                      <NumberField
                        step="0.01"
                        class={styles.formControl}
                        ariaLabel="Extra monthly spending"
                        value={period().monthlyAmount}
                        onChange={(v) => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.map((p, j) =>
                              j === i ? { ...p, monthlyAmount: v } : p
                            )
                          )
                        }}
                      />
                      <button
                        type="button"
                        class={`${styles.btnSm} ${styles.btnGhost}`}
                        aria-label="Remove spending period"
                        onClick={() => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.filter((_, j) => j !== i)
                          )
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </Index>
                <button
                  type="button"
                  class={`${styles.btnSm} ${styles.btnSecondary}`}
                  data-test-id="retirement-add-period"
                  onClick={addPeriod}
                >
                  Add spending period
                </button>
              </fieldset>
            </Show>

            <div class={styles.formRow}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-return">
                  Expected annual return (%)
                </label>
                <NumberField
                  id="ret-return"
                  step="0.01"
                  class={styles.formControl}
                  testId="retirement-input-return"
                  disabled={settings().useAllocation}
                  value={
                    settings().useAllocation
                      ? round(effectiveReturnPct(settings()))
                      : settings().annualReturnPct
                  }
                  onChange={(v) => {
                    update('annualReturnPct', v)
                  }}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-inflation">
                  Inflation (%)
                </label>
                <NumberField
                  id="ret-inflation"
                  step="0.01"
                  class={styles.formControl}
                  testId="retirement-input-inflation"
                  disabled={!settings().adjustForInflation}
                  value={settings().annualInflationPct}
                  onChange={(v) => {
                    update('annualInflationPct', v)
                  }}
                />
              </div>
            </div>

            <label class={styles.checkRow} data-test-id="retirement-toggle-inflation">
              <input
                type="checkbox"
                checked={settings().adjustForInflation}
                onChange={(e) => {
                  update('adjustForInflation', e.currentTarget.checked)
                }}
              />
              <span>
                Adjust for inflation
                <span class={styles.fieldHint}>
                  {settings().adjustForInflation
                    ? `A real return of ${projection().realAnnualReturnPct.toFixed(2)}% after inflation.`
                    : 'Everything is shown in future money, which flatters the numbers.'}
                </span>
              </span>
            </label>

            <Show when={settings().mode === 'advanced'}>
              <label class={styles.checkRow} data-test-id="retirement-toggle-allocation">
                <input
                  type="checkbox"
                  checked={settings().useAllocation}
                  onChange={(e) => {
                    update('useAllocation', e.currentTarget.checked)
                  }}
                />
                <span>
                  Work the return out from an allocation
                  <span class={styles.fieldHint}>
                    Currently {effectiveReturnPct(settings()).toFixed(2)}% blended.
                  </span>
                </span>
              </label>

              <Show when={settings().useAllocation}>
                <fieldset class={styles.subSection} data-test-id="retirement-allocation">
                  <legend class={styles.subLegend}>
                    Allocation
                    <InfoTip
                      testId="retirement-info-allocation"
                      text="Weights are shares of the portfolio. Cash is held at minus inflation, because that is what it does."
                    />
                  </legend>
                  <Index each={settings().allocation}>
                    {(slice, i) => (
                      <div class={styles.listRow}>
                        <input
                          type="text"
                          class={styles.formControl}
                          aria-label="Asset name"
                          value={slice().label}
                          oninput={(e) => {
                            update(
                              'allocation',
                              settings().allocation.map((a, j) =>
                                j === i ? { ...a, label: e.currentTarget.value } : a
                              )
                            )
                          }}
                        />
                        <NumberField
                          step="1"
                          class={styles.formControl}
                          ariaLabel="Share of portfolio, percent"
                          value={slice().weightPct}
                          onChange={(v) => {
                            update(
                              'allocation',
                              settings().allocation.map((a, j) =>
                                j === i ? { ...a, weightPct: v } : a
                              )
                            )
                          }}
                        />
                        <NumberField
                          step="0.01"
                          class={styles.formControl}
                          ariaLabel="Expected annual return, percent"
                          disabled={slice().erodesWithInflation}
                          value={slice().annualReturnPct}
                          onChange={(v) => {
                            update(
                              'allocation',
                              settings().allocation.map((a, j) =>
                                j === i ? { ...a, annualReturnPct: v } : a
                              )
                            )
                          }}
                        />
                      </div>
                    )}
                  </Index>
                </fieldset>
              </Show>
            </Show>

            <fieldset class={styles.subSection} data-test-id="retirement-lifestyles">
              <legend class={styles.subLegend}>
                What you want to retire into
                <InfoTip
                  testId="retirement-info-lifestyles"
                  text="Monthly spending in today's money. Somewhere cheaper is a different retirement date, not a different plan."
                />
              </legend>
              <Index each={settings().lifestyles}>
                {(lifestyle) => (
                  <div class={styles.listRow}>
                    <input
                      type="text"
                      class={styles.formControl}
                      aria-label="Lifestyle name"
                      value={lifestyle().label}
                      oninput={(e) => {
                        updateLifestyle(lifestyle().id, { label: e.currentTarget.value })
                      }}
                    />
                    <NumberField
                      step="0.01"
                      class={styles.formControl}
                      ariaLabel="Monthly spending in today's money"
                      value={lifestyle().monthlySpendToday}
                      onChange={(v) => {
                        updateLifestyle(lifestyle().id, {
                          monthlySpendToday: v,
                        })
                      }}
                    />
                    <button
                      type="button"
                      class={`${styles.btnSm} ${styles.btnGhost}`}
                      aria-label="Remove lifestyle"
                      disabled={settings().lifestyles.length === 1}
                      onClick={() => {
                        removeLifestyle(lifestyle().id)
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </Index>
              <button
                type="button"
                class={`${styles.btnSm} ${styles.btnSecondary}`}
                data-test-id="retirement-add-lifestyle"
                onClick={addLifestyle}
              >
                Add a lifestyle
              </button>
            </fieldset>

            <div class={styles.formRow}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-swr">
                  Withdrawal rate (%)
                  <InfoTip testId="retirement-info-swr" text={swrExplainer()} />
                </label>
                {/* The slider is the point: what this number costs you is a trade-off, and
                    dragging it shows the chart and the runway move together. The number box
                    beside it keeps exact entry, and doubles as the slider's readout. */}
                <div class={styles.sliderRow}>
                  <RangeField
                    min={1}
                    max={12}
                    step={0.1}
                    showReadout={false}
                    value={settings().safeWithdrawalRatePct}
                    testId="retirement-slider-swr"
                    ariaLabel="Withdrawal rate, percent"
                    onChange={(v) => {
                      update('safeWithdrawalRatePct', round(v))
                    }}
                  />
                  <NumberField
                    id="ret-swr"
                    step="0.01"
                    class={`${styles.formControl} ${styles.sliderNumber}`}
                    testId="retirement-input-swr"
                    value={settings().safeWithdrawalRatePct}
                    onChange={(v) => {
                      update('safeWithdrawalRatePct', v)
                    }}
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-life">
                  Plan until age
                  {/* Stopping at an age means nothing without a date to count it from, and the
                      projection quietly ignores the field in that case. Say so rather than
                      leaving a control that does nothing. */}
                  <Show when={settings().birthMonth === null}>
                    <InfoTip
                      testId="retirement-life-needs-birth"
                      text="Set your date of birth to plan to an age. Until then the chart runs 60 years."
                    />
                  </Show>
                </label>
                <NumberField
                  id="ret-life"
                  step="1"
                  class={styles.formControl}
                  testId="retirement-input-life"
                  disabled={settings().birthMonth === null}
                  value={settings().lifeExpectancyAge}
                  onChange={(v) => {
                    update('lifeExpectancyAge', v)
                  }}
                />
              </div>
            </div>

            <div class={styles.saveRow}>
              <button
                type="submit"
                class={styles.btnPrimary}
                data-test-id="retirement-save-settings"
                disabled={saving() || !dirty()}
              >
                {saving() ? 'Saving...' : dirty() ? 'Save assumptions' : 'Saved'}
              </button>
              <Show when={dirty()}>
                <span class={styles.fieldHint}>
                  The chart already reflects these; saving keeps them for next time.
                </span>
              </Show>
            </div>
          </form>

          <div class={styles.results} data-test-id="retirement-results">
            <div class={styles.projectionRow}>
              <For each={projection().lifestyles}>
                {(lifestyle, i) => (
                  <div
                    class={`${styles.projectionCard} ${i() === 0 ? styles.primary : ''}`}
                    data-test-id="retirement-lifestyle-card"
                  >
                    <div class={styles.cardLabel}>{lifestyle.label}</div>
                    <div class={styles.cardValue} data-test-id="retirement-crossing">
                      {crossingText(lifestyle.crossing)}
                    </div>
                    <div class={styles.cardSub}>
                      Needs {formatCurrency(lifestyle.targetToday)} in today's money
                    </div>
                  </div>
                )}
              </For>
            </div>

            {/* The cards say when you can stop. This says how long stopping then lasts,
                which is the half of the answer the withdrawal rate quietly decides. */}
            <div
              class={`${styles.runwayChip} ${swrSustainable() ? '' : styles.runwayChipWarn}`}
              data-test-id="retirement-runway-chip"
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path stroke-linecap="round" d="M12 7v5l3 2" />
              </svg>
              <Show
                when={swrSustainable()}
                fallback={
                  <span>
                    Retired for about <strong>{Math.round(withdrawalRunway())} years</strong> before
                    the money runs out
                    <Show when={runsOutAtAge() !== null}>, around age {runsOutAtAge()}</Show>.
                    Drawing {settings().safeWithdrawalRatePct}% a year outpaces{' '}
                    {projection().realAnnualReturnPct.toFixed(2)}% growth after inflation.
                  </span>
                }
              >
                <span>
                  Retired <strong>for as long as you like</strong> — growth of{' '}
                  {projection().realAnnualReturnPct.toFixed(2)}% after inflation covers the{' '}
                  {settings().safeWithdrawalRatePct}% you draw, so the pot is never spent down.
                </span>
              </Show>
            </div>

            {/* The app's own switch rather than three native checkboxes, in its compact
                size: these annotate the chart and should not out-shout it. */}
            <div class={styles.chartControls}>
              <Toggle
                size="compact"
                checked={showNominal()}
                onChange={setShowNominal}
                data-test-id="retirement-toggle-nominal"
              >
                Show future money instead of today's
              </Toggle>
              <Toggle
                size="compact"
                checked={showBand()}
                onChange={setShowBand}
                data-test-id="retirement-toggle-band"
              >
                Show a better and worse return
              </Toggle>
              <Toggle
                size="compact"
                checked={showMarkers()}
                onChange={setShowMarkers}
                data-test-id="retirement-toggle-markers"
              >
                Mark when each lifestyle is reached
              </Toggle>
            </div>

            <div class={styles.retirementProjections} data-test-id="retirement-chart">
              <Chart
                id="retirement-projection-chart"
                type="line"
                data={chartData()}
                options={chartOptions()}
                plugins={[lifestyleMarkersPlugin]}
                height={280}
                width="100%"
              />
            </div>

            <div class={styles.projectionDetails} data-test-id="retirement-summary">
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Paid in over the projection</span>
                <span class={styles.detailValue}>{formatCurrency(projection().totalSaved)}</span>
              </div>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Investment growth</span>
                <span class={`${styles.detailValue} ${styles.positive}`}>
                  {formatCurrency(projection().totalGrowth)}
                </span>
              </div>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>
                  Final balance{showNominal() ? '' : ", today's money"}
                </span>
                <span class={styles.detailValue}>
                  {formatCurrency(
                    showNominal() ? projection().finalNetWorth : projection().finalNetWorthReal
                  )}
                </span>
              </div>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Return after inflation</span>
                <span class={styles.detailValue}>
                  {projection().realAnnualReturnPct.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
