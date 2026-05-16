/**
 * Emergency Fund Tracker Component - EARS Specification
 *
 * GIVEN: A user is on the Emergency Fund page
 * WHEN: The page loads
 * THEN: The header displays "Emergency Fund" and shows monthly expenses and total fund
 *
 * GIVEN: A user has emergency fund data
 * WHEN: The page loads with data
 * THEN: The coverage chart shows how many months of expenses the fund can cover
 *
 * GIVEN: A user expands details
 * WHEN: They click to show details
 * THEN: A breakdown by month displays coverage percentages and status
 */

/**
 * Emergency Fund Tracker Component
 * Calculates monthly expenses and compares against savings account balances
 */
import { createSignal, For, onMount } from 'solid-js'
import Chart from '../components/Chart'
import ExportChartButton from '../components/ExportChartButton'
import { apiGet, formatCurrency, showToast } from '../core/api'
import { theme } from '../core/theme'
import sharedStyles from './CalculatorShared.module.css'
import styles from './EmergencyFundCalculator.module.css'

export default function EmergencyFundCalculator() {
  const chartColors = () => theme.getChartColors()
  const [monthlyExpenses, setMonthlyExpenses] = createSignal(0)
  const [totalEmergencyFund, setTotalEmergencyFund] = createSignal(0)
  const [monthsWithData, setMonthsWithData] = createSignal(0)
  const [coverage, setCoverage] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(false)
  const [showDetails, setShowDetails] = createSignal(false)

  onMount(() => {
    loadEmergencyFund()
  })

  const loadEmergencyFund = async () => {
    setLoading(true)
    try {
      const data: any = await apiGet('/api/calculator/emergency-fund')
      setMonthlyExpenses(data.avgMonthlyExpenses || 0)
      setTotalEmergencyFund(data.totalEmergencyFund || 0)
      setMonthsWithData(data.monthsWithData || 0)
      setCoverage(data.coverage || [])
    } catch (e: any) {
      showToast(e.message || 'Failed to load emergency fund data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // _coverageData - placeholder (functionality can be extended)

  const [chartRef, setChartRef] = createSignal<any>(undefined)

  return (
    <div class={sharedStyles.page}>
      <div class={sharedStyles.pageHeader}>
        <h1>Emergency Fund Tracker</h1>
        <p>Calculate coverage based on monthly expenses</p>
      </div>

      {loading() ? (
        <div class={styles.loading}>Loading...</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div class={styles.summaryGrid}>
            <div class={styles.summaryCard}>
              <div class={styles.summaryTitle}>Based on</div>
              <div class={styles.summaryValue}>{monthsWithData()} months</div>
              <div class={styles.summarySubtitle}>of transaction history</div>
            </div>
            <div class={styles.summaryCard}>
              <div class={styles.summaryTitle}>Average Monthly Expenses</div>
              <div class={styles.summaryValue}>{formatCurrency(monthlyExpenses(), 'EUR')}</div>
            </div>
            <div class={styles.summaryCard}>
              <div class={styles.summaryTitle}>Total Emergency Fund</div>
              <div class={styles.summaryValue}>{formatCurrency(totalEmergencyFund(), 'EUR')}</div>
            </div>
          </div>

          {/* Coverage Visualization */}
          <div class={styles.chartSection}>
            <Chart
              id="emergencyFundChart"
              type="bar"
              data={{
                labels: coverage().map((c) => c.label),
                datasets: [
                  {
                    label: 'Coverage',
                    data: coverage().map((c) => c.coveragePct),
                    backgroundColor: coverage().map((c) => {
                      if (c.status === 'complete') return 'rgba(16, 185, 129, 0.8)'
                      if (c.status === 'partial') return 'rgba(245, 158, 11, 0.8)'
                      return 'rgba(239, 68, 68, 0.8)'
                    }),
                    borderColor: coverage().map((c) => {
                      if (c.status === 'complete') return 'rgb(16, 185, 129)'
                      if (c.status === 'partial') return 'rgb(245, 158, 11)'
                      return 'rgb(239, 68, 68)'
                    }),
                    borderWidth: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: chartColors().text },
                    grid: { color: chartColors().border },
                    title: { display: true, text: 'Coverage %', color: chartColors().text },
                  },
                  x: {
                    ticks: { color: chartColors().text },
                    grid: { color: chartColors().border },
                  },
                },
                plugins: {
                  legend: { display: false },
                },
              }}
              height={300}
              width="100%"
              onReady={(chart: any) => {
                setChartRef(chart)
              }}
            />
            <ExportChartButton
              chart={chartRef()}
              filename="emergency-fund-chart"
              variant="inline"
            />
          </div>

          {/* Coverage Details */}
          <div class={styles.detailsSection}>
            <div class={styles.detailsHeader}>
              <h3>Coverage Levels</h3>
              <button class={styles.toggleBtn} onClick={() => setShowDetails(!showDetails())}>
                {showDetails() ? 'Hide' : 'Show'} Details
              </button>
            </div>

            {showDetails() && (
              <div class={styles.coverageGrid}>
                <For each={coverage()}>
                  {(c) => (
                    <div class={`${styles.coverageItem} ${styles[c.status] || ''}`}>
                      <div class={styles.coverageTitle}>{c.label} Fund</div>
                      <div class={styles.coverageBars}>
                        <div class={styles.progressBar}>
                          <div
                            class={styles.progressFill}
                            style={{ width: `${c.coveragePct}%` }}
                          ></div>
                        </div>
                        <div class={styles.progressStats}>
                          <span>{formatCurrency(c.current, 'EUR')}</span>
                          <span>of {formatCurrency(c.required, 'EUR')}</span>
                        </div>
                      </div>
                      <div class={styles.coverageStatus}>{c.status}</div>
                    </div>
                  )}
                </For>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
