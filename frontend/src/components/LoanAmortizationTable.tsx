/**
 * LoanAmortizationTable Component
 * Displays detailed amortization schedule for a loan
 */
import { createSignal, createEffect, onMount } from 'solid-js'
import Chart from './Chart'
import styles from './LoansPage.module.css'
import { api as _api, formatCurrency } from '../core/api'
import { apiPost, showToast } from '../utils/api'

interface AmortizationRow {
  month: number
  date: string
  payment: number
  principal: number
  interest: number
  balance: number
  rate: number
  prepayment?: number
  note?: string
}

interface AmortizationResult {
  summary: {
    totalPaid: number
    totalInterest: number
    payoffDate?: string
    interestSaved?: number
    monthsSaved?: number
    avgMonthlyPayment?: number
  }
  schedule: AmortizationRow[]
}

interface Loan {
  id: number
  name: string
  principal: number
  interest_rate: number
  term_months: number
  start_date: string
  prepayments?: any[]
  rate_periods?: any[]
}

interface Props {
  loanId: number
  loan: Loan
  showDetailed?: boolean
}

export default function LoanAmortizationTable(props: Props) {
  const [loading, setLoading] = createSignal(false)
  const [result, setResult] = createSignal<AmortizationResult | null>(null)
  const [showDetailed, setShowDetailed] = createSignal(props.showDetailed || false)

  const loadAmortizationData = async () => {
    setLoading(true)
    try {
      const res = await apiPost<AmortizationResult>(`/api/loans/${props.loanId}/calculate`, {})
      setResult(res)
      setShowDetailed(false) // Reset detailed view when loading new data
    } catch (err) {
      console.error('Failed to load amortization data:', err)
      showToast('Failed to load amortization data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const toggleDetailed = () => {
    setShowDetailed(!showDetailed())
  }

  // Load amortization data on mount and when loan changes
  onMount(() => {
    loadAmortizationData()
  })

  const s = result()?.summary
  const schedule = result()?.schedule || []

  return (
    <div class={styles.loanAmortizationSection}>
      {schedule.length === 0 ? (
        <p class={styles.emptyState}>No amortization data available</p>
      ) : (
        <>
          {/* Action Buttons */}
          <div style="display: flex; gap: 8px; margin-bottom: 16px;">
            <button
              class={`${styles.btnSecondary} ${styles.btnSm}`}
              onClick={loadAmortizationData}
              disabled={loading()}
              title="Recalculate with current loan data"
            >
              Recalculate
            </button>
            <button
              class={`${styles.btnPrimary} ${styles.btnSm}`}
              onClick={toggleDetailed}
            >
              {showDetailed() ? 'Hide Amortization' : 'View Amortization'}
            </button>
          </div>

          {/* Summary Cards */}
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px;">
            <div class={styles.summaryCard}>
              <div class={styles.summaryLabel}>Total Paid</div>
              <div class={styles.summaryValue}>{formatCurrency(s?.totalPaid || 0)}</div>
            </div>
            <div class={styles.summaryCard}>
              <div class={styles.summaryLabel}>Total Interest</div>
              <div class={styles.summaryValue} style={{ color: 'var(--expense)' }}>
                {formatCurrency(s?.totalInterest || 0)}
              </div>
            </div>
            <div class={styles.summaryCard}>
              <div class={styles.summaryLabel}>Payoff Date</div>
              <div class={styles.summaryValue} style={{ fontWeight: 600 }}>
                {s?.payoffDate || '-'}
              </div>
            </div>
            <div class={styles.summaryCard}>
              <div class={styles.summaryLabel}>Interest Saved</div>
              <div class={styles.summaryValue} style={{ color: 'var(--success)' }}>
                {formatCurrency(s?.interestSaved || 0)}
              </div>
            </div>
          </div>

          {/* Prepayments Section */}
          {props.loan.prepayments && props.loan.prepayments.length > 0 && (
            <div style="margin-bottom: 16px;">
              <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Prepayments</h4>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                {props.loan.prepayments.map((p) => {
                  const loanStart = new Date(props.loan.start_date)
                  const prepayDate = new Date(loanStart)
                  prepayDate.setMonth(prepayDate.getMonth() + p.month - 1)
                  return (
                    <div
                      style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--bg); border-radius: var(--radius);"
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {formatDate(prepayDate.toISOString().split('T')[0])}
                      </span>
                      <span style={{ fontWeight: 600, color: 'var(--success)' }}>
                        +{formatCurrency(p.amount)}
                      </span>
                      {p.note && (
                        <span style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                          {p.note}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Rate Periods Section */}
          {props.loan.rate_periods && props.loan.rate_periods.length > 0 && (
            <div style="margin-bottom: 16px;">
              <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Rate Periods</h4>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                {props.loan.rate_periods.map((rp) => {
                  const loanStart = new Date(props.loan.start_date)
                  const rateDate = new Date(loanStart)
                  rateDate.setMonth(rateDate.getMonth() + rp.start_month - 1)
                  return (
                    <div
                      style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--bg); border-radius: var(--radius);"
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {formatDate(rateDate.toISOString().split('T')[0])}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        ({rp.start_month}{rp.end_month ? ` - ${rp.end_month}` : '+'} mo)
                      </span>
                      <span style={{ fontWeight: 600 }}>{rp.rate}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Charts */}
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
            <div>
              <canvas id={`loan-chart-principal-${props.loanId}`} style={{ height: 220 }} />
            </div>
            <div>
              <canvas id={`loan-chart-balance-${props.loanId}`} style={{ height: 220 }} />
            </div>
          </div>

          {/* Basic Amortization Table */}
          <div>
            <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Amortization Schedule</h4>
            <div class={styles.amortTable}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Payment</th>
                    <th>Principal</th>
                    <th>Interest</th>
                    <th>Balance</th>
                    <th>Rate</th>
                    <th>Prepayment</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((row, idx) => {
                    const prev = idx > 0 ? schedule[idx - 1] : null
                    const rateChanged = prev && prev.rate !== row.rate
                    const hasPrepayment = row.prepayment && row.prepayment > 0
                    const note = hasPrepayment ? 'Prepayment' : rateChanged ? `Rate: ${row.rate}%` : ''

                    return (
                      <tr
                        class={{
                          [styles.prepaymentRow]: hasPrepayment,
                          [styles.rateChangeRow]: rateChanged,
                        }}
                      >
                        <td>{row.month}</td>
                        <td>{formatDate(row.date)}</td>
                        <td class={styles.tdAmount}>{formatCurrency(row.payment)}</td>
                        <td class={`${styles.tdAmount} ${styles.income}`}>
                          {formatCurrency(row.principal)}
                        </td>
                        <td class={`${styles.tdAmount} ${styles.expense}`}>
                          {formatCurrency(row.interest)}
                        </td>
                        <td style={{ fontWeight: 600 }}>{formatCurrency(row.balance)}</td>
                        <td>{row.rate.toFixed(3)}%</td>
                        {hasPrepayment ? (
                          <td class={styles.tdAmount} style={{ color: 'var(--success)', fontWeight: 600 }}>
                            {formatCurrency(row.prepayment)}
                          </td>
                        ) : (
                          <td>-</td>
                        )}
                        {note ? (
                          <td style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                            {note}
                          </td>
                        ) : (
                          <td></td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style="margin-top: 8px; font-size: 12px; color: 'var(--text-secondary)'; display: flex; gap: 16px;">
              <span>
                <span
                  style={{
                    background: 'rgba(245, 158, 11, 0.15)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    marginRight: 4,
                  }}
                >
                  &nbsp;
                </span>
                Rate Change
              </span>
              <span>
                <span
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    marginRight: 4,
                  }}
                >
                  &nbsp;
                </span>
                Prepayment
              </span>
            </div>
          </div>

          {/* Detailed Amortization Table */}
          {showDetailed() && (
            <div style="margin-top: 24px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                  <h4 style="margin: 0; font-size: 16px; font-weight: 600;">Detailed Amortization Schedule</h4>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {props.loan.name} - {schedule.length} payments
                  </span>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <button
                    class={`${styles.btnSecondary} ${styles.btnSm}`}
                    onClick={() => setShowDetailed(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              {isLongTable(schedule) ? (
                <div class={styles.amortDetailedWrap}>
                  <table class={styles.amortDetailedTable}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Payment</th>
                        <th>Principal</th>
                        <th>Interest</th>
                        <th>Balance</th>
                        <th>Rate</th>
                        <th>Prepayment</th>
                        <th>Cum. Principal</th>
                        <th>Cum. Interest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generateDetailedRows(schedule, formatCurrency).map((row) => (
                        <tr class={row.isYearMarker ? styles.yearMarker : ''}>
                          <td>{row.month}</td>
                          <td>{row.date}</td>
                          <td class={styles.tdAmount}>{row.payment}</td>
                          <td class={`${styles.tdAmount} ${styles.income}`}>{row.principal}</td>
                          <td class={`${styles.tdAmount} ${styles.expense}`}>{row.interest}</td>
                          <td style={{ fontWeight: 600 }}>{row.balance}</td>
                          <td>{row.rate}</td>
                          {row.prepayment > 0 ? (
                            <td class={styles.tdAmount} style={{ color: 'var(--success)', fontWeight: 600 }}>
                              {row.prepayment}
                            </td>
                          ) : (
                            <td>-</td>
                          )}
                          <td>{row.cumPrincipal}</td>
                          <td>{row.cumInterest}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr class={styles.totalsRow}>
                        <td colSpan={2}><strong>Totals</strong></td>
                        <td class={styles.tdAmount}><strong>{s?.totalPaid ? formatCurrency(s.totalPaid) : '-'}</strong></td>
                        <td class={`${styles.tdAmount} ${styles.income}`}><strong>{s?.totalPaid ? formatCurrency(s.totalPaid - s.totalInterest) : '-'}</strong></td>
                        <td class={`${styles.tdAmount} ${styles.expense}`}><strong>{formatCurrency(s?.totalInterest || 0)}</strong></td>
                        <td colSpan={5}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <table class={styles.amortDetailedTable}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Payment</th>
                      <th>Principal</th>
                      <th>Interest</th>
                      <th>Balance</th>
                      <th>Rate</th>
                      <th>Prepayment</th>
                      <th>Cum. Principal</th>
                      <th>Cum. Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generateDetailedRows(schedule, formatCurrency).map((row) => (
                      <tr class={row.isYearMarker ? styles.yearMarker : ''}>
                        <td>{row.month}</td>
                        <td>{row.date}</td>
                        <td class={styles.tdAmount}>{row.payment}</td>
                        <td class={`${styles.tdAmount} ${styles.income}`}>{row.principal}</td>
                        <td class={`${styles.tdAmount} ${styles.expense}`}>{row.interest}</td>
                        <td style={{ fontWeight: 600 }}>{row.balance}</td>
                        <td>{row.rate}</td>
                        {row.prepayment > 0 ? (
                          <td class={styles.tdAmount} style={{ color: 'var(--success)', fontWeight: 600 }}>
                            {row.prepayment}
                          </td>
                        ) : (
                          <td>-</td>
                        )}
                        <td>{row.cumPrincipal}</td>
                        <td>{row.cumInterest}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr class={styles.totalsRow}>
                      <td colSpan={2}><strong>Totals</strong></td>
                      <td class={styles.tdAmount}><strong>{s?.totalPaid ? formatCurrency(s.totalPaid) : '-'}</strong></td>
                      <td class={`${styles.tdAmount} ${styles.income}`}><strong>{s?.totalPaid ? formatCurrency(s.totalPaid - s.totalInterest) : '-'}</strong></td>
                      <td class={`${styles.tdAmount} ${styles.expense}`}><strong>{formatCurrency(s?.totalInterest || 0)}</strong></td>
                      <td colSpan={5}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
              <div style="margin-top: 12px; font-size: 12px; color: 'var(--text-secondary)'; display: flex; gap: 16px;">
                <span>
                  <span style={{ background: 'rgba(16, 185, 129, 0.2)', padding: '2px 6px', borderRadius: 4, marginRight: 4 }}>
                    &nbsp;
                  </span>
                  Year End
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Helper to render charts after data is loaded
function renderCharts(loanId: number, result: AmortizationResult, formatCurrency: (val: number) => string) {
  if (!result.schedule.length) return

  // Principal vs Interest stacked bar
  const prinCtx = document.getElementById(`loan-chart-principal-${loanId}`)
  if (prinCtx) {
    const rows = result.schedule.filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
    new (window as any).Chart(prinCtx, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.month.toString()),
        datasets: [
          {
            label: 'Principal',
            data: rows.map((r) => r.principal),
            backgroundColor: 'rgba(34, 197, 94, 0.8)',
            borderRadius: 2,
          },
          {
            label: 'Interest',
            data: rows.map((r) => r.interest),
            backgroundColor: 'rgba(239, 68, 68, 0.8)',
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        stacked: true,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 }, color: 'var(--text)' },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
            },
          },
        },
        scales: {
          y: {
            stacked: true,
            ticks: { callback: (v: any) => formatCurrency(v) },
            grid: { color: 'rgba(0, 0, 0, 0.1)' },
          },
          x: { grid: { color: 'rgba(0, 0, 0, 0.1)' } },
        },
      },
    })
  }

  // Balance over time
  const balCtx = document.getElementById(`loan-chart-balance-${loanId}`)
  if (balCtx) {
    const rows = result.schedule.filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
    new (window as any).Chart(balCtx, {
      type: 'line',
      data: {
        labels: rows.map((r) => r.month.toString()),
        datasets: [
          {
            label: 'Remaining Balance',
            data: rows.map((r) => r.balance),
            borderColor: 'var(--primary)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: { label: (ctx: any) => ` Balance: ${formatCurrency(ctx.raw)}` },
          },
        },
        scales: {
          y: {
            ticks: { callback: (v: any) => formatCurrency(v) },
            grid: { color: 'rgba(0, 0, 0, 0.1)' },
          },
          x: { grid: { color: 'rgba(0, 0, 0, 0.1)' } },
        },
      },
    })
  }
}

function isLongTable(schedule: AmortizationRow[]): boolean {
  return schedule.length > 24
}

function generateDetailedRows(
  schedule: AmortizationRow[],
  formatCurrency: (val: number) => string
): any[] {
  const data: any[] = []
  const startDate = new Date(schedule[0]?.date || new Date())
  let cumulativeInterest = 0
  let cumulativePrincipal = 0
  const initialBalance = schedule[0]?.balance || schedule[0]?.principal || 0

  schedule.forEach((row) => {
    cumulativeInterest += row.interest
    cumulativePrincipal += row.principal

    const paymentDate = new Date(startDate)
    paymentDate.setMonth(paymentDate.getMonth() + row.month - 1)

    data.push({
      month: row.month,
      date: formatDate(paymentDate.toISOString().split('T')[0]),
      payment: formatCurrency(row.payment + (row.prepayment || 0)),
      principal: formatCurrency(row.principal),
      interest: formatCurrency(row.interest),
      balance: formatCurrency(row.balance),
      rate: row.rate.toFixed(3),
      prepayment: row.prepayment && row.prepayment > 0 ? formatCurrency(row.prepayment) : '-',
      cumPrincipal: formatCurrency(cumulativePrincipal),
      cumInterest: formatCurrency(cumulativeInterest),
      isYearMarker: row.month % 12 === 0,
    })
  })

  return data
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}