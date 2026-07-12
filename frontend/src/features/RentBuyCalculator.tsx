/**
 * Rent vs Buy Calculator Component - EARS Specification
 *
 * GIVEN: A user is on the Rent vs Buy Calculator page
 * WHEN: The page loads
 * THEN: The header displays "Rent vs Buy" and input fields for both scenarios appear
 *
 * GIVEN: A user enters rent and buy costs
 * WHEN: They input rent, home price, loan terms, and maintenance costs
 * THEN: The calculator computes 30-year cumulative costs for both options
 *
 * GIVEN: A user views results
 * WHEN: They click calculate
 * THEN: Charts display cumulative costs and the break-even year is highlighted
 *
 * GIVEN: A user saves calculator settings
 * WHEN: They complete calculations
 * THEN: Settings are saved to localStorage for next visit
 */

/**
 * Rent vs Buy Calculator Component
 * Compares 30-year costs of renting vs buying a home
 */
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import Chart from '../components/Chart'
import ExportChartButton from '../components/ExportChartButton'
import { formatCurrency } from '../core/api'
import { theme } from '../core/theme'
import sharedStyles from './CalculatorShared.module.css'
import styles from './RentBuyCalculator.module.css'
import type * as Models from '../types/models'

interface Result {
  year: number
  rentCumulative: number
  buyCumulative: number
  rentInvestmentValue: number
  buyEquity: number
  rentNetCost: number
  buyNetCost: number
}

interface Props {
  currency?: Models.Currency
}

export default function RentBuyCalculator(props: Props) {
  const currency = props.currency || 'EUR'
  const [loading, setLoading] = createSignal(false)
  const chartColors = () => theme.getChartColors()
  const [results, setResults] = createSignal<Result[]>([])
  const [breakEvenYear, setBreakEvenYear] = createSignal<number | null>(null)

  // Form state
  const [formData, setFormData] = createSignal({
    rentMonthly: '1200',
    rentIncrease: '3',
    investReturn: '7',
    homePrice: '300000',
    downPayment: '60000',
    loanTerm: '30',
    interestRate: '4',
    propertyTax: '3000',
    insurance: '1200',
    maintenance: '1',
    hoa: '200',
    horizon: '30',
  })

  const [showResults, setShowResults] = createSignal(false)
  const [chartRef, setChartRef] = createSignal<any>(undefined)

  // Load saved calculator settings
  onMount(() => {
    const saved = localStorage.getItem('rentBuyCalculatorSettings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Convert stored numbers to strings for the string-based form
        const strForm: Record<string, string> = {}
        for (const key of Object.keys(parsed)) {
          strForm[key] = String(parsed[key] ?? formData()[key as keyof typeof formData])
        }
        setFormData({ ...formData(), ...strForm })
      } catch (_e) {
        console.error('Failed to load calculator settings')
      }
    }
    // Calculate immediately with loaded/default values
    calculate()
  })

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  // Debounced calculation
  let debounceTimer: number | null = null

  const scheduleUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      calculate()
    }, 400)
  }

  function handleInput(field: keyof typeof formData, value: string) {
    setFormData({ ...formData(), [field]: value })
    scheduleUpdate()
  }

  const calculate = () => {
    setLoading(true)
    const raw = formData()
    // Helper for locale-aware number parsing (supports both . and , as decimal separator)
    const n = (s: string) => parseFloat(s.replace(',', '.')) || 0
    // Save numeric values to localStorage
    const numForm: Record<string, number> = {}
    for (const key of Object.keys(raw)) {
      numForm[key] = n(raw[key as keyof typeof raw])
    }
    localStorage.setItem('rentBuyCalculatorSettings', JSON.stringify(numForm))

    try {
      const rentMonthly = n(raw.rentMonthly)
      const rentIncrease = n(raw.rentIncrease) / 100
      const investReturn = n(raw.investReturn || '7') / 100

      const homePrice = n(raw.homePrice)
      const downPayment = n(raw.downPayment)
      const loanTerm = parseInt(raw.loanTerm) || 0
      const interestRate = n(raw.interestRate) / 100
      const propertyTax = n(raw.propertyTax)
      const insurance = n(raw.insurance)
      const maintenancePct = n(raw.maintenance) / 100
      const hoa = n(raw.hoa)

      const years = parseInt(raw.horizon) || 30
      const monthlyRate = interestRate / 12
      const totalMonths = loanTerm * 12

      // Calculate monthly mortgage payment
      let monthlyPayment = 0
      if (monthlyRate > 0 && totalMonths > 0) {
        monthlyPayment =
          ((homePrice - downPayment) * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths))) /
          (Math.pow(1 + monthlyRate, totalMonths) - 1)
      } else if (totalMonths > 0) {
        monthlyPayment = (homePrice - downPayment) / totalMonths
      }

      // Track cumulative values
      let cumulativeRent = 0
      let cumulativeBuyCost = 0
      let investmentBalance = downPayment
      let cumulativePrincipal = 0
      let _cumulativeInterest = 0
      let principalBalance = homePrice - downPayment

      const resultData: Result[] = []

      for (let year = 1; year <= years; year++) {
        const yearRent = rentMonthly * 12 * Math.pow(1 + rentIncrease, year - 1)

        // Calculate mortgage details for this year
        let yearPrincipal = 0
        let yearInterest = 0
        const yearTax = propertyTax
        const yearInsurance = insurance
        const yearMaintenance = homePrice * maintenancePct
        const yearHOA = hoa * 12

        // Calculate mortgage principal/interest for each month of this year
        for (let month = 1; month <= 12; month++) {
          if (principalBalance > 0) {
            const interestPayment = principalBalance * monthlyRate
            const principalPayment = Math.min(monthlyPayment - interestPayment, principalBalance)
            yearInterest += interestPayment
            yearPrincipal += principalPayment
            principalBalance -= principalPayment
          }
        }

        // Add to cumulative
        cumulativeRent += yearRent
        cumulativeBuyCost +=
          monthlyPayment * 12 + yearTax + yearInsurance + yearMaintenance + yearHOA
        cumulativePrincipal += yearPrincipal
        _cumulativeInterest += yearInterest

        // Investment growth
        investmentBalance *= 1 + investReturn

        resultData.push({
          year,
          rentCumulative: cumulativeRent,
          buyCumulative: cumulativeBuyCost,
          rentInvestmentValue: investmentBalance,
          buyEquity: cumulativePrincipal,
          rentNetCost: cumulativeRent,
          buyNetCost: cumulativeBuyCost - cumulativePrincipal,
        })
      }

      // Find break-even year
      let beYear: number | null = null
      for (let i = 0; i < resultData.length; i++) {
        const r = resultData[i]
        if (r.buyNetCost <= r.rentNetCost) {
          beYear = r.year
          break
        }
      }

      setResults(resultData)
      setBreakEvenYear(beYear)
      setShowResults(true)
    } catch (e) {
      console.error('Calculation failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const getSummary = () => {
    const data = results()
    if (!data.length) return null
    const last = data[data.length - 1]
    return {
      rentCumulative: last.rentCumulative,
      rentInvestmentValue: last.rentInvestmentValue,
      rentNetCost: last.rentNetCost,
      buyCumulative: last.buyCumulative,
      buyEquity: last.buyEquity,
      buyNetCost: last.buyNetCost,
      winner: last.buyNetCost < last.rentNetCost ? 'buy' : 'rent',
      savings: Math.abs(last.buyNetCost - last.rentNetCost),
      breakEven: breakEvenYear(),
    }
  }

  const summary = createMemo(() => getSummary())

  return (
    <div class={sharedStyles.page}>
      <div class={sharedStyles.pageHeader}>
        <h1 data-tour="calc-rentbuy">Rent vs Buy Calculator</h1>
        <p>Compare long-term costs between renting and buying</p>
      </div>

      <div class={styles.calcContainer}>
        {/* Rent Inputs */}
        <div class={styles.calcSection}>
          <h3 class={styles.calcTitle}>Rent Scenario</h3>
          <div class={styles.formGrid}>
            <div class={styles.formGroup}>
              <label>Monthly Rent</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="rent-monthly-input"
                value={formData().rentMonthly}
                oninput={(e) => {
                  handleInput('rentMonthly' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Rent Increase (%)</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="rent-increase-input"
                value={formData().rentIncrease}
                oninput={(e) => {
                  handleInput('rentIncrease' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Investment Return (%)</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="invest-return-input"
                value={formData().investReturn}
                oninput={(e) => {
                  handleInput('investReturn' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Time Horizon (years)</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*"
                data-test-id="horizon-input"
                value={formData().horizon}
                oninput={(e) => {
                  handleInput('horizon' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
          </div>
        </div>

        {/* Buy Inputs */}
        <div class={styles.calcSection}>
          <h3 class={styles.calcTitle}>Buy Scenario</h3>
          <div class={styles.formGrid}>
            <div class={styles.formGroup}>
              <label>Home Price</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="home-price-input"
                value={formData().homePrice}
                oninput={(e) => {
                  handleInput('homePrice' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Down Payment</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="down-payment-input"
                value={formData().downPayment}
                oninput={(e) => {
                  handleInput('downPayment' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Loan Term (years)</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="loan-term-input"
                value={formData().loanTerm}
                oninput={(e) => {
                  handleInput('loanTerm' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Interest Rate (%)</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="interest-rate-input"
                value={formData().interestRate}
                oninput={(e) => {
                  handleInput('interestRate' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Property Tax</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="property-tax-input"
                value={formData().propertyTax}
                oninput={(e) => {
                  handleInput('propertyTax' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Insurance</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="insurance-input"
                value={formData().insurance}
                oninput={(e) => {
                  handleInput('insurance' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Maintenance (%)</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="maintenance-input"
                value={formData().maintenance}
                oninput={(e) => {
                  handleInput('maintenance' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual HOA Fees</label>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                data-test-id="hoa-input"
                value={formData().hoa}
                oninput={(e) => {
                  handleInput('hoa' as keyof typeof formData, e.target.value)
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.loading}>Calculating...</div>
      ) : showResults() && summary() ? (
        (() => {
          const s = summary()!
          return (
            <>
              {/* Summary Cards */}
              <div class={styles.summaryGrid}>
                <div class={styles.summaryCard} data-test-id="rent-scenario-card">
                  <div class={styles.summaryTitle}>Rent Scenario ({formData().horizon} years)</div>
                  <div class={styles.summaryRow} data-test-id="total-rent-paid">
                    <span>Total Rent Paid</span>
                    <span class={styles.summaryValue}>
                      {formatCurrency(s.rentCumulative, currency)}
                    </span>
                  </div>
                  <div class={styles.summaryRow}>
                    <span>Investment Value</span>
                    <span class={styles.summaryValue}>
                      {formatCurrency(s.rentInvestmentValue, currency)}
                    </span>
                  </div>
                  <div
                    class={`${styles.summaryRow} ${styles.highlight}`}
                    data-test-id="rent-net-cost"
                  >
                    <span>Net Cost</span>
                    <span class={styles.summaryValue}>
                      {formatCurrency(s.rentNetCost, currency)}
                    </span>
                  </div>
                </div>
                <div class={styles.summaryCard} data-test-id="buy-scenario-card">
                  <div class={styles.summaryTitle}>Buy Scenario ({formData().horizon} years)</div>
                  <div class={styles.summaryRow} data-test-id="total-mortgage-costs">
                    <span>Total Mortgage + Costs</span>
                    <span class={styles.summaryValue}>
                      {formatCurrency(s.buyCumulative, currency)}
                    </span>
                  </div>
                  <div class={styles.summaryRow}>
                    <span>Home Equity</span>
                    <span class={styles.summaryValue}>{formatCurrency(s.buyEquity, currency)}</span>
                  </div>
                  <div
                    class={`${styles.summaryRow} ${styles.highlight}`}
                    data-test-id="buy-net-cost"
                  >
                    <span>Net Cost</span>
                    <span class={styles.summaryValue}>
                      {formatCurrency(s.buyNetCost, currency)}
                    </span>
                  </div>
                </div>
                <div
                  class={`${styles.summaryCard} ${styles.verdict}`}
                  data-test-id="comparison-card"
                >
                  <div class={styles.summaryTitle}>Comparison</div>
                  <div class={styles.summaryRow}>
                    <span>Winner</span>
                    <span
                      class={`${styles.summaryValue} ${s.winner === 'buy' ? styles.success : styles.warning}`}
                      data-test-id="winner-value"
                    >
                      {s.winner === 'buy' ? 'Buying' : 'Renting'}
                    </span>
                  </div>
                  <div class={styles.summaryRow}>
                    <span>Savings</span>
                    <span class={styles.summaryValue} data-test-id="savings-value">
                      {formatCurrency(Math.abs(s.savings), currency)}
                    </span>
                  </div>
                  <div class={`${styles.summaryRow} highlight`}>
                    <span>Break-even</span>
                    <span class={styles.summaryValue} data-test-id="break-even-value">
                      {s.breakEven ? `Year ${s.breakEven}` : 'Not reached'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Break-even message */}
              {s.breakEven && (
                <div
                  class={`${styles.breakeven} ${s.winner === 'buy' ? '' : styles.neutral}`}
                  data-test-id="break-even-message"
                >
                  <div class={styles.breakevenIcon}>
                    <svg
                      width="24"
                      height="24"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div class={styles.breakevenText}>
                    <strong>After {s.breakEven} years, buying becomes cheaper than renting.</strong>
                    <p>
                      At this point, your home equity exceeds the cumulative cost advantage of
                      renting plus investment returns.
                    </p>
                  </div>
                </div>
              )}

              {/* Chart */}
              <div class={styles.chartSection} data-test-id="rent-buy-chart">
                <ExportChartButton
                  chart={chartRef()}
                  filename="rent-buy-comparison"
                  variant="inline"
                />
                <Chart
                  id="rentBuyChart"
                  type="line"
                  data={{
                    labels: results().map((r) => `Year ${r.year}`),
                    datasets: [
                      {
                        label: 'Renting Net Cost',
                        data: results().map((r) => r.rentNetCost),
                        borderColor: '#f0a860',
                        backgroundColor: 'rgba(240, 168, 96, 0.12)',
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2,
                      },
                      {
                        label: 'Buying Net Cost',
                        data: results().map((r) => r.buyNetCost),
                        borderColor: '#6e9bff',
                        backgroundColor: 'rgba(110, 155, 255, 0.12)',
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
                          callback: (v: number | string) =>
                            formatCurrency(typeof v === 'number' ? v : Number(v), currency as any),
                          color: chartColors().text,
                        },
                        grid: {
                          color: chartColors().border,
                        },
                        title: {
                          display: true,
                          text: 'Net Cost (lower is better)',
                          color: chartColors().text,
                        },
                      },
                      x: {
                        ticks: { color: chartColors().text, maxTicksLimit: 10 },
                        grid: { color: chartColors().border },
                      },
                    },
                    plugins: {
                      legend: { position: 'top', labels: { color: chartColors().text } },
                    },
                  }}
                  height={300}
                  width="100%"
                  onReady={(chart: any) => {
                    setChartRef(chart)
                  }}
                />
              </div>
            </>
          )
        })()
      ) : (
        <div class={styles.cta}>
          <p>Enter your values above to see the comparison</p>
        </div>
      )}
    </div>
  )
}
