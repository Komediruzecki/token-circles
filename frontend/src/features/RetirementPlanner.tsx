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
import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { projectRetirement } from '../../../shared/retirement'
import {
  DEFAULT_SETTINGS,
  effectiveReturnPct,
  monthOf,
  normalizeSettings,
  RETURN_SCENARIOS,
  settingsToInput,
} from '../../../shared/retirementSettings'
import Chart from '../components/Chart'
import OrbitalDivider from '../components/OrbitalDivider'
import { apiGet, apiPut, formatCurrency, showToast } from '../core/api'
import { theme } from '../core/theme'
import styles from './RetirementPage.module.css'
import type { ExpensePeriod, IncomeStep, Lifestyle } from '../../../shared/retirement'
import type { DerivedField, RetirementSettings } from '../../../shared/retirementSettings'

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

export default function RetirementPlanner() {
  const [settings, setSettings] = createSignal<RetirementSettings>(DEFAULT_SETTINGS)
  const [filled, setFilled] = createSignal<DerivedField[]>([])
  const [startMonth, setStartMonth] = createSignal(monthOf(new Date()))
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [showNominal, setShowNominal] = createSignal(false)
  const [showBand, setShowBand] = createSignal(false)

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
      const res = await apiPut<{ settings: RetirementSettings }>(
        '/api/retirement/settings',
        settings()
      )
      // Take back what was stored rather than what was sent: the server normalises, and the
      // panel should show what will actually be used next time.
      setSettings(normalizeSettings(res.settings))
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
    const palette = ['#59d2a2', '#6e9bff', '#f0a860', '#d98ce0']
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
          borderColor: palette[(i + 1) % palette.length],
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

  onMount(load)

  return (
    <div class={styles.planner} data-test-id="retirement-planner" data-tour="retirement-planner">
      <OrbitalDivider id="retirement-sec-planner" label="Your Plan" />

      <Show when={!loading()} fallback={<div class={styles.emptyState}>Loading your plan...</div>}>
        <Show when={filled().length > 0}>
          <div class={styles.derivedNote} data-test-id="retirement-derived-note">
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                <input
                  id="ret-networth"
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  data-test-id="retirement-input-networth"
                  value={settings().netWorth}
                  oninput={(e) => {
                    update('netWorth', Number(e.currentTarget.value))
                  }}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-birth">
                  Date of birth
                </label>
                <input
                  id="ret-birth"
                  type="month"
                  class={styles.formControl}
                  data-test-id="retirement-input-birth"
                  value={settings().birthMonth ?? ''}
                  oninput={(e) => {
                    update('birthMonth', e.currentTarget.value || null)
                  }}
                />
                <span class={styles.fieldHint}>Used to label the chart with your age.</span>
              </div>
            </div>

            <Show when={settings().mode === 'simple'}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-contribution">
                  Monthly contribution
                </label>
                <input
                  id="ret-contribution"
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  data-test-id="retirement-input-contribution"
                  value={settings().monthlyContribution}
                  oninput={(e) => {
                    update('monthlyContribution', Number(e.currentTarget.value))
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
                  <input
                    id="ret-income"
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    data-test-id="retirement-input-income"
                    value={settings().monthlyIncome}
                    oninput={(e) => {
                      update('monthlyIncome', Number(e.currentTarget.value))
                    }}
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel} for="ret-expenses">
                    Monthly spending
                  </label>
                  <input
                    id="ret-expenses"
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    data-test-id="retirement-input-expenses"
                    value={settings().monthlyExpenses}
                    oninput={(e) => {
                      update('monthlyExpenses', Number(e.currentTarget.value))
                    }}
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-raise">
                  Annual pay rise (%)
                </label>
                <input
                  id="ret-raise"
                  type="number"
                  step="0.1"
                  class={styles.formControl}
                  data-test-id="retirement-input-raise"
                  value={settings().annualRaisePct}
                  oninput={(e) => {
                    update('annualRaisePct', Number(e.currentTarget.value))
                  }}
                />
                <span class={styles.fieldHint}>
                  Applied every January, unless a pay step beats it.
                </span>
              </div>

              <fieldset class={styles.subSection} data-test-id="retirement-income-steps">
                <legend class={styles.subLegend}>Planned pay steps</legend>
                <For each={settings().incomeSteps}>
                  {(step, i) => (
                    <div class={styles.listRow}>
                      <input
                        type="month"
                        class={styles.formControl}
                        aria-label="Pay step start month"
                        value={step.fromMonth}
                        oninput={(e) => {
                          update(
                            'incomeSteps',
                            settings().incomeSteps.map((s, j) =>
                              j === i() ? { ...s, fromMonth: e.currentTarget.value } : s
                            )
                          )
                        }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        class={styles.formControl}
                        aria-label="Monthly income from then"
                        value={step.monthlyAmount}
                        oninput={(e) => {
                          update(
                            'incomeSteps',
                            settings().incomeSteps.map((s, j) =>
                              j === i() ? { ...s, monthlyAmount: Number(e.currentTarget.value) } : s
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
                            settings().incomeSteps.filter((_, j) => j !== i())
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
                </For>
                <button
                  type="button"
                  class={`${styles.btnSm} ${styles.btnSecondary}`}
                  data-test-id="retirement-add-step"
                  onClick={addStep}
                >
                  Add pay step
                </button>
                <span class={styles.fieldHint}>
                  What you will earn from that month on. Lower than today is a pay cut or a
                  sabbatical, and is projected as one; raises carry on from there.
                </span>
              </fieldset>

              <fieldset class={styles.subSection} data-test-id="retirement-expense-periods">
                <legend class={styles.subLegend}>Planned spending</legend>
                <For each={settings().expensePeriods}>
                  {(period, i) => (
                    <div class={styles.listRow}>
                      <input
                        type="month"
                        class={styles.formControl}
                        aria-label="Spending period start"
                        value={period.fromMonth}
                        oninput={(e) => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.map((p, j) =>
                              j === i() ? { ...p, fromMonth: e.currentTarget.value } : p
                            )
                          )
                        }}
                      />
                      <input
                        type="month"
                        class={styles.formControl}
                        aria-label="Spending period end"
                        value={period.toMonth ?? ''}
                        oninput={(e) => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.map((p, j) =>
                              j === i() ? { ...p, toMonth: e.currentTarget.value || undefined } : p
                            )
                          )
                        }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        class={styles.formControl}
                        aria-label="Extra monthly spending"
                        value={period.monthlyAmount}
                        oninput={(e) => {
                          update(
                            'expensePeriods',
                            settings().expensePeriods.map((p, j) =>
                              j === i() ? { ...p, monthlyAmount: Number(e.currentTarget.value) } : p
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
                            settings().expensePeriods.filter((_, j) => j !== i())
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
                </For>
                <button
                  type="button"
                  class={`${styles.btnSm} ${styles.btnSecondary}`}
                  data-test-id="retirement-add-period"
                  onClick={addPeriod}
                >
                  Add spending period
                </button>
                <span class={styles.fieldHint}>
                  Leave the end blank for spending that carries on. A negative amount is a planned
                  saving.
                </span>
              </fieldset>
            </Show>

            <div class={styles.formRow}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-return">
                  Expected annual return (%)
                </label>
                <input
                  id="ret-return"
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  data-test-id="retirement-input-return"
                  disabled={settings().useAllocation}
                  value={
                    settings().useAllocation
                      ? effectiveReturnPct(settings()).toFixed(2)
                      : settings().annualReturnPct
                  }
                  oninput={(e) => {
                    update('annualReturnPct', Number(e.currentTarget.value))
                  }}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-inflation">
                  Inflation (%)
                </label>
                <input
                  id="ret-inflation"
                  type="number"
                  step="0.1"
                  class={styles.formControl}
                  data-test-id="retirement-input-inflation"
                  disabled={!settings().adjustForInflation}
                  value={settings().annualInflationPct}
                  oninput={(e) => {
                    update('annualInflationPct', Number(e.currentTarget.value))
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
                  <legend class={styles.subLegend}>Allocation</legend>
                  <For each={settings().allocation}>
                    {(slice, i) => (
                      <div class={styles.listRow}>
                        <input
                          type="text"
                          class={styles.formControl}
                          aria-label="Asset name"
                          value={slice.label}
                          oninput={(e) => {
                            update(
                              'allocation',
                              settings().allocation.map((a, j) =>
                                j === i() ? { ...a, label: e.currentTarget.value } : a
                              )
                            )
                          }}
                        />
                        <input
                          type="number"
                          step="1"
                          class={styles.formControl}
                          aria-label="Share of portfolio, percent"
                          value={slice.weightPct}
                          oninput={(e) => {
                            update(
                              'allocation',
                              settings().allocation.map((a, j) =>
                                j === i() ? { ...a, weightPct: Number(e.currentTarget.value) } : a
                              )
                            )
                          }}
                        />
                        <input
                          type="number"
                          step="0.1"
                          class={styles.formControl}
                          aria-label="Expected annual return, percent"
                          disabled={slice.erodesWithInflation}
                          value={slice.annualReturnPct}
                          oninput={(e) => {
                            update(
                              'allocation',
                              settings().allocation.map((a, j) =>
                                j === i()
                                  ? { ...a, annualReturnPct: Number(e.currentTarget.value) }
                                  : a
                              )
                            )
                          }}
                        />
                      </div>
                    )}
                  </For>
                  <span class={styles.fieldHint}>
                    Weights are shares of the portfolio. Cash is held at minus inflation, because
                    that is what it does.
                  </span>
                </fieldset>
              </Show>
            </Show>

            <fieldset class={styles.subSection} data-test-id="retirement-lifestyles">
              <legend class={styles.subLegend}>What you want to retire into</legend>
              <For each={settings().lifestyles}>
                {(lifestyle) => (
                  <div class={styles.listRow}>
                    <input
                      type="text"
                      class={styles.formControl}
                      aria-label="Lifestyle name"
                      value={lifestyle.label}
                      oninput={(e) => {
                        updateLifestyle(lifestyle.id, { label: e.currentTarget.value })
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      class={styles.formControl}
                      aria-label="Monthly spending in today's money"
                      value={lifestyle.monthlySpendToday}
                      oninput={(e) => {
                        updateLifestyle(lifestyle.id, {
                          monthlySpendToday: Number(e.currentTarget.value),
                        })
                      }}
                    />
                    <button
                      type="button"
                      class={`${styles.btnSm} ${styles.btnGhost}`}
                      aria-label="Remove lifestyle"
                      disabled={settings().lifestyles.length === 1}
                      onClick={() => {
                        removeLifestyle(lifestyle.id)
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
              </For>
              <button
                type="button"
                class={`${styles.btnSm} ${styles.btnSecondary}`}
                data-test-id="retirement-add-lifestyle"
                onClick={addLifestyle}
              >
                Add a lifestyle
              </button>
              <span class={styles.fieldHint}>
                Monthly spending in today's money. Somewhere cheaper is a different retirement date,
                not a different plan.
              </span>
            </fieldset>

            <div class={styles.formRow}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-swr">
                  Withdrawal rate (%)
                </label>
                <input
                  id="ret-swr"
                  type="number"
                  step="0.1"
                  class={styles.formControl}
                  data-test-id="retirement-input-swr"
                  value={settings().safeWithdrawalRatePct}
                  oninput={(e) => {
                    update('safeWithdrawalRatePct', Number(e.currentTarget.value))
                  }}
                />
                <span class={styles.fieldHint}>
                  {settings().safeWithdrawalRatePct > 0
                    ? `${(100 / settings().safeWithdrawalRatePct).toFixed(0)}x your annual spending. 4% is the usual rule of thumb.`
                    : 'A rate above zero. 4% is the usual rule of thumb.'}
                </span>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel} for="ret-life">
                  Plan until age
                </label>
                <input
                  id="ret-life"
                  type="number"
                  step="1"
                  class={styles.formControl}
                  data-test-id="retirement-input-life"
                  disabled={settings().birthMonth === null}
                  value={settings().lifeExpectancyAge}
                  oninput={(e) => {
                    update('lifeExpectancyAge', Number(e.currentTarget.value))
                  }}
                />
                {/* Stopping at an age means nothing without a date to count it from, and the
                    projection quietly ignores the field in that case. Say so rather than
                    leaving a control that does nothing. */}
                <Show when={settings().birthMonth === null}>
                  <span class={styles.fieldHint} data-test-id="retirement-life-needs-birth">
                    Set your date of birth to plan to an age. Until then the chart runs 60 years.
                  </span>
                </Show>
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

            <div class={styles.chartControls}>
              <label class={styles.checkRow} data-test-id="retirement-toggle-nominal">
                <input
                  type="checkbox"
                  checked={showNominal()}
                  onChange={(e) => setShowNominal(e.currentTarget.checked)}
                />
                <span>Show future money instead of today's</span>
              </label>
              <label class={styles.checkRow} data-test-id="retirement-toggle-band">
                <input
                  type="checkbox"
                  checked={showBand()}
                  onChange={(e) => setShowBand(e.currentTarget.checked)}
                />
                <span>Show a better and worse return</span>
              </label>
            </div>

            <div class={styles.retirementProjections} data-test-id="retirement-chart">
              <Chart
                id="retirement-projection-chart"
                type="line"
                data={chartData()}
                options={chartOptions()}
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
