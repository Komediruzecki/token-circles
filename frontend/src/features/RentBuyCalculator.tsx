/**
 * Rent vs Buy Calculator Component
 * Compares 30-year costs of renting vs buying a home
 */
import { createSignal, onMount } from 'solid-js'
import Chart from '../components/Chart'
import { formatCurrency } from '../core/api'
import styles from './RentBuyCalculator.module.css'

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
  currency?: string
}

export default function RentBuyCalculator(props: Props) {
  const currency = props.currency || 'EUR'
  const [loading, setLoading] = createSignal(false)
  const [results, setResults] = createSignal<Result[]>([])
  const [breakEvenYear, setBreakEvenYear] = createSignal<number | null>(null)

  // Form state
  const [formData, setFormData] = createSignal({
    rentMonthly: 1200,
    rentIncrease: 3,
    investReturn: 7,
    homePrice: 300000,
    downPayment: 60000,
    loanTerm: 30,
    interestRate: 4,
    propertyTax: 3000,
    insurance: 1200,
    maintenance: 1,
    hoa: 200,
  })

  const [showResults, setShowResults] = createSignal(false)

  // Load saved calculator settings
  onMount(() => {
    const saved = localStorage.getItem('rentBuyCalculatorSettings')
    if (saved) {
      try {
        setFormData({ ...formData(), ...JSON.parse(saved) })
      } catch (e) {
        console.error('Failed to load calculator settings')
      }
    }
  })

  // Debounced calculation
  let debounceTimer: number | null = null

  const scheduleUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => calculate(), 400)
  }

  function handleInput(field: keyof typeof formData, value: number | string) {
    setFormData({ ...formData(), [field]: value })
    scheduleUpdate()
  }

  const calculate = () => {
    setLoading(true)
    // Save settings
    localStorage.setItem('rentBuyCalculatorSettings', JSON.stringify(formData()))

    try {
      const r = formData()
      const rentMonthly = r.rentMonthly
      const rentIncrease = (r.rentIncrease || 0) / 100
      const investReturn = (r.investReturn || 7) / 100

      const homePrice = r.homePrice
      const downPayment = r.downPayment
      const loanTerm = r.loanTerm
      const interestRate = (r.interestRate || 0) / 100
      const propertyTax = r.propertyTax
      const insurance = r.insurance
      const maintenancePct = (r.maintenance || 0) / 100
      const hoa = r.hoa

      const years = 30
      const monthlyRate = interestRate / 12
      const totalMonths = loanTerm * 12

      // Calculate monthly mortgage payment
      let monthlyPayment = 0
      if (monthlyRate > 0 && totalMonths > 0) {
        monthlyPayment =
          (homePrice - downPayment) *
          (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
          (Math.pow(1 + monthlyRate, totalMonths) - 1)
      } else if (totalMonths > 0) {
        monthlyPayment = (homePrice - downPayment) / totalMonths
      }

      // Track cumulative values
      let cumulativeRent = 0
      let cumulativeBuyCost = 0
      let investmentBalance = downPayment
      let cumulativePrincipal = downPayment
      let cumulativeInterest = 0
      let principalBalance = homePrice - downPayment

      const resultData: Result[] = []

      for (let year = 1; year <= years; year++) {
        const yearRent = rentMonthly * 12 * Math.pow(1 + rentIncrease, year - 1)

        // Calculate mortgage details for this year
        let yearPrincipal = 0
        let yearInterest = 0
        let yearTax = propertyTax
        let yearInsurance = insurance
        let yearMaintenance = homePrice * maintenancePct
        let yearHOA = hoa * 12

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
        cumulativeBuyCost += monthlyPayment * 12 + yearTax + yearInsurance + yearMaintenance + yearHOA
        cumulativePrincipal += yearPrincipal
        cumulativeInterest += yearInterest

        // Investment growth
        investmentBalance *= (1 + investReturn)

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

  const summary = getSummary()

  const downloadChart = () => {
    const canvas = document.getElementById('rentBuyChart') as HTMLCanvasElement
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = 'rent-buy-comparison.png'
    a.click()
  }

  return (
    <div class={styles.page}>
      <div class={styles.pageHeader}>
        <h1>💰 Rent vs Buy Calculator</h1>
        <p>Compare 30-year costs between renting and buying</p>
      </div>

      <div class={styles.calcContainer}>
        {/* Rent Inputs */}
        <div class={styles.calcSection}>
          <h3 class={styles.calcTitle}>🏠 Rent Scenario</h3>
          <div class={styles.formGrid}>
            <div class={styles.formGroup}>
              <label>Monthly Rent</label>
              <input
                type="number"
                step="0.01"
                value={formData().rentMonthly}
                oninput={(e) => handleInput('rentMonthly' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Rent Increase (%)</label>
              <input
                type="number"
                step="0.1"
                value={formData().rentIncrease}
                oninput={(e) => handleInput('rentIncrease' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Investment Return (%)</label>
              <input
                type="number"
                step="0.1"
                value={formData().investReturn}
                oninput={(e) => handleInput('investReturn' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Buy Inputs */}
        <div class={styles.calcSection}>
          <h3 class={styles.calcTitle}>🏡 Buy Scenario</h3>
          <div class={styles.formGrid}>
            <div class={styles.formGroup}>
              <label>Home Price</label>
              <input
                type="number"
                step="0.01"
                value={formData().homePrice}
                oninput={(e) => handleInput('homePrice' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Down Payment</label>
              <input
                type="number"
                step="0.01"
                value={formData().downPayment}
                oninput={(e) => handleInput('downPayment' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Loan Term (years)</label>
              <input
                type="number"
                value={formData().loanTerm}
                oninput={(e) => handleInput('loanTerm' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Interest Rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={formData().interestRate}
                oninput={(e) => handleInput('interestRate' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Property Tax</label>
              <input
                type="number"
                step="0.01"
                value={formData().propertyTax}
                oninput={(e) => handleInput('propertyTax' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual Insurance</label>
              <input
                type="number"
                step="0.01"
                value={formData().insurance}
                oninput={(e) => handleInput('insurance' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Maintenance (%)</label>
              <input
                type="number"
                step="0.1"
                value={formData().maintenance}
                oninput={(e) => handleInput('maintenance' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
            <div class={styles.formGroup}>
              <label>Annual HOA Fees</label>
              <input
                type="number"
                step="0.01"
                value={formData().hoa}
                oninput={(e) => handleInput('hoa' as keyof typeof formData, Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.loading}>Calculating...</div>
      ) : showResults() && summary ? (
        <>
          {/* Summary Cards */}
          <div class={styles.summaryGrid}>
            <div class={styles.summaryCard}>
              <div class={styles.summaryTitle}>Rent Scenario (30 years)</div>
              <div class={styles.summaryRow}>
                <span>Total Rent Paid</span>
                <span class={styles.summaryValue}>{formatCurrency(summary.rentCumulative, currency)}</span>
              </div>
              <div class={styles.summaryRow}>
                <span>Investment Value</span>
                <span class={styles.summaryValue}>{formatCurrency(summary.rentInvestmentValue, currency)}</span>
              </div>
              <div class={`${styles.summaryRow} highlight`}>
                <span>Net Cost</span>
                <span class={styles.summaryValue}>{formatCurrency(summary.rentNetCost, currency)}</span>
              </div>
            </div>
            <div class={styles.summaryCard}>
              <div class={styles.summaryTitle}>Buy Scenario (30 years)</div>
              <div class={styles.summaryRow}>
                <span>Total Mortgage + Costs</span>
                <span class={styles.summaryValue}>{formatCurrency(summary.buyCumulative, currency)}</span>
              </div>
              <div class={styles.summaryRow}>
                <span>Home Equity</span>
                <span class={styles.summaryValue}>{formatCurrency(summary.buyEquity, currency)}</span>
              </div>
              <div class={`${styles.summaryRow} highlight`}>
                <span>Net Cost</span>
                <span class={styles.summaryValue}>{formatCurrency(summary.buyNetCost, currency)}</span>
              </div>
            </div>
            <div class={`${styles.summaryCard} verdict`}>
              <div class={styles.summaryTitle}>Comparison</div>
              <div class={styles.summaryRow}>
                <span>Winner</span>
                <span class={`summaryValue ${summary.winner === 'buy' ? 'success' : 'warning'}`}>
                  {summary.winner === 'buy' ? 'Buying' : 'Renting'}
                </span>
              </div>
              <div class={styles.summaryRow}>
                <span>Savings</span>
                <span class={styles.summaryValue}>{formatCurrency(Math.abs(summary.savings), currency)}</span>
              </div>
              <div class={`${styles.summaryRow} highlight`}>
                <span>Break-even</span>
                <span class={styles.summaryValue}>
                  {summary.breakEven ? `Year ${summary.breakEven}` : 'Not reached'}
                </span>
              </div>
            </div>
          </div>

          {/* Break-even message */}
          {summary.breakEven && (
            <div class={`breakeven ${summary.winner === 'buy' ? '' : 'neutral'}`}>
              <div class="breakevenIcon">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div class="breakevenText">
                <strong>After {summary.breakEven} years, buying becomes cheaper than renting.</strong>
                <p>
                  At this point, your home equity exceeds the cumulative cost advantage of renting plus
                  investment returns.
                </p>
              </div>
            </div>
          )}

          {/* Chart */}
          <div class={styles.chartSection}>
            <button class={styles.btnSecondary} onClick={downloadChart}>
              Download Chart
            </button>
            <Chart
              id="rentBuyChart"
              type="line"
              data={{
                labels: results().map((r) => `Year ${r.year}`),
                datasets: [
                  {
                    label: 'Renting Net Cost',
                    data: results().map((r) => r.rentNetCost),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                  },
                  {
                    label: 'Buying Net Cost',
                    data: results().map((r) => r.buyNetCost),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
                      callback: (v) => formatCurrency(v, currency),
                      color: 'var(--text)',
                    },
                    grid: {
                      color: 'var(--border)',
                    },
                    title: {
                      display: true,
                      text: 'Net Cost (lower is better)',
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
        </>
      ) : (
        <div class={styles.cta}>
          <p>Enter your values above to see the comparison</p>
        </div>
      )}
    </div>
  )
}