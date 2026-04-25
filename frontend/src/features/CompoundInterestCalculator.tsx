/**
 * Compound Interest Projector Component
 * Calculates investment growth with scenario comparisons
 */
import { createSignal } from 'solid-js'
import Chart from '../components/Chart'
import { formatCurrency } from '../core/api'
import styles from './CompoundInterestCalculator.module.css'
import { apiPost, showToast } from '../utils/api'

interface CompoundInterestResult {
  projection: Array<{ year: number; balance: number; contributions: number; interest: number }>
  principal: number
  monthlyContribution: number
  annualReturn: number
  years: number
  finalBalance: number
  totalContributions: number
  totalInterest: number
  scenarios: Array<{
    name: string
    return: number
    color: string
    finalBalance: number
    totalContributions: number
    interest: number
  }>
}

interface FormState {
  principal: number
  monthlyContribution: number
  annualReturn: number
  years: number
}

export default function CompoundInterestCalculator() {
  const [loading, setLoading] = createSignal(false)
  const [results, setResults] = createSignal<CompoundInterestResult | null>(null)
  const [form, setForm] = createSignal<FormState>({
    principal: 10000,
    monthlyContribution: 500,
    annualReturn: 7,
    years: 10,
  })

  const calculate = async () => {
    setLoading(true)
    try {
      const data = await apiPost('/calculator/compound-interest', form())
      setResults(data)
    } catch (e: any) {
      showToast(e.message || 'Calculation failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Auto-calculate on mount and debounced
  let debounceTimer: number | null = null
  onCalculate()

  function onCalculate() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => calculate(), 400)
  }

  const updateForm = (field: keyof FormState, value: number) => {
    setForm({ ...form(), [field]: value })
    onCalculate()
  }

  const summary = () => {
    const r = results()
    if (!r) return null
    return {
      finalBalance: r.finalBalance,
      contributions: r.totalContributions,
      interest: r.totalInterest,
      scenarios: r.scenarios,
    }
  }

  const downloadChart = () => {
    const canvas = document.getElementById('compoundInterestChart') as HTMLCanvasElement
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = 'compound-interest-chart.png'
    a.click()
  }

  return (
    <div class={styles.page}>
      <div class={styles.pageHeader}>
        <h1>📈 Compound Interest Projector</h1>
        <p>Project investment growth over time</p>
      </div>

      <div class={styles.calcContainer}>
        {/* Calculator Form */}
        <div class={styles.calcSection}>
          <h3 class={styles.calcTitle}>Investment Parameters</h3>
          <div class={styles.formGrid}>
            <div class={styles.formGroup}>
              <label>Initial Investment</label>
              <input
                type="number"
                step="100"
                value={form().principal}
                oninput={(e) => updateForm('principal', Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Monthly Contribution</label>
              <input
                type="number"
                step="100"
                value={form().monthlyContribution}
                oninput={(e) => updateForm('monthlyContribution', Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Return (%)</label>
              <input
                type="number"
                step="0.1"
                value={form().annualReturn}
                oninput={(e) => updateForm('annualReturn', Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Time Period (years)</label>
              <input
                type="number"
                min="1"
                max="50"
                value={form().years}
                oninput={(e) => updateForm('years', Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Results Summary */}
        <div class={styles.calcSection}>
          <h3 class={styles.calcTitle}>Projected Growth</h3>
          <div class={styles.formGrid}>
            <div class={styles.formGroup}>
              <label>Final Balance</label>
              <div class={styles.formValue}>
                {summary()?.finalBalance !== undefined
                  ? formatCurrency(summary().finalBalance, 'EUR')
                  : '--'}
              </div>
            </div>
            <div class={styles.formGroup}>
              <label>Total Contributions</label>
              <div class={styles.formValue}>
                {summary()?.contributions !== undefined
                  ? formatCurrency(summary().contributions, 'EUR')
                  : '--'}
              </div>
            </div>
            <div class={styles.formGroup}>
              <label>Interest Earned</label>
              <div class={`${styles.formValue} success`}>
                {summary()?.interest !== undefined
                  ? formatCurrency(summary().interest, 'EUR')
                  : '--'}
              </div>
            </div>
            <div class={styles.formGroup}>
              <label>Interest Rate</label>
              <div class={styles.formValue}>{form().annualReturn}%</div>
            </div>
          </div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.loading}>Calculating...</div>
      ) : results() ? (
        <>
          {/* Scenario Comparison Chart */}
          <div class={styles.chartSection}>
            <h3 class={styles.chartTitle}>Scenario Comparison</h3>
            <Chart
              id="compoundInterestChart"
              type="bar"
              data={{
                labels: summary()?.scenarios.map((s) => s.name) || [],
                datasets: [
                  {
                    label: 'Final Balance',
                    data: summary()?.scenarios.map((s) => s.finalBalance) || [],
                    backgroundColor: summary()?.scenarios.map((s) => s.color + 'cc') || [],
                    borderColor: summary()?.scenarios.map((s) => s.color) || [],
                    borderWidth: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    ticks: {
                      callback: (v) => formatCurrency(v, 'EUR'),
                      color: 'var(--text)',
                    },
                    grid: { color: 'var(--border)' },
                    title: {
                      display: true,
                      text: 'Final Balance',
                      color: 'var(--text)',
                    },
                  },
                  x: {
                    ticks: { color: 'var(--text)' },
                    grid: { color: 'var(--border)' },
                  },
                },
                plugins: {
                  legend: { display: false },
                },
              }}
              height={300}
              width="100%"
            />
            <button class={styles.btnSecondary} onClick={downloadChart}>
              Download Chart
            </button>
          </div>

          {/* Detailed Projection Chart */}
          <div class={styles.chartSection}>
            <h3 class={styles.chartTitle}>Detailed Projection</h3>
            <Chart
              id="compoundInterestChartDetailed"
              type="line"
              data={{
                labels: results().projection.map((p) => `${p.year} yrs`),
                datasets: [
                  {
                    label: 'Balance',
                    data: results().projection.map((p) => p.balance),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                  },
                  {
                    label: 'Contributions',
                    data: results().projection.map((p) => p.contributions),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                  },
                  {
                    label: 'Interest',
                    data: results().projection.map((p) => p.interest),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    ticks: {
                      callback: (v) => formatCurrency(v, 'EUR'),
                      color: 'var(--text)',
                    },
                    grid: { color: 'var(--border)' },
                    title: {
                      display: true,
                      text: 'Balance / Contributions / Interest',
                      color: 'var(--text)',
                    },
                  },
                  x: {
                    ticks: { color: 'var(--text)', maxTicksLimit: 10 },
                    grid: { color: 'var(--border)' },
                  },
                },
                plugins: {
                  legend: { position: 'top', labels: { color: 'var(--text)' } },
                },
              }}
              height={300}
              width="100%"
            />
          </div>

          {/* Scenario Details */}
          <div class={styles.scenariosSection}>
            <h3 class={styles.scenariosTitle}>Scenario Details</h3>
            <div class={styles.scenariosGrid}>
              {summary()?.scenarios.map((s) => (
                <div class={styles.scenarioCard} style={'--color: ' + (s.color || '#6366f1') + ';' as any}>
                  <div class={styles.scenarioName}>{s.name}</div>
                  <div class={styles.scenarioStats}>
                    <div class={styles.stat}>
                      <span class={styles.statLabel}>Return Rate</span>
                      <span class={styles.statValue}>{s.return}%</span>
                    </div>
                    <div class={styles.stat}>
                      <span class={styles.statLabel}>Final Balance</span>
                      <span class={styles.statValue}>{formatCurrency(s.finalBalance, 'EUR')}</span>
                    </div>
                    <div class={styles.stat}>
                      <span class={styles.statLabel}>Interest Earned</span>
                      <span class={`${styles.statValue} success`}>
                        {formatCurrency(s.interest, 'EUR')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div class={styles.cta}>
          <p>Enter your investment parameters to see projections</p>
        </div>
      )}
    </div>
  )
}