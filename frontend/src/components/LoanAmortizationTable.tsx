/**
 * LoanAmortizationTable Component
 * Displays detailed amortization schedule for a loan
 */
import { createEffect, createSignal, For, on, onMount } from 'solid-js'
import Chart from '../components/Chart'
import { api as _api, apiPost, formatCurrency, showToast } from '../core/api'
import { theme } from '../core/theme'
import styles from '../features/LoansPage.module.css'

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
  recalculateKey?: number
}

export default function LoanAmortizationTable(props: Props) {
  const [loading, setLoading] = createSignal(false)
  const [result, setResult] = createSignal<AmortizationResult | null>(null)
  const [showDetailed, setShowDetailed] = createSignal(props.showDetailed || false)
  const chartColors = () => theme.getChartColors()

  const loadAmortizationData = async () => {
    setLoading(true)
    try {
      const res = await apiPost<AmortizationResult>(`/api/loans/${props.loanId}/calculate`, {})
      setResult(res)
    } catch (_err) {
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

  // Recalculate when prepayments change or loan changes
  createEffect(
    on(
      () => [props.recalculateKey, props.loanId],
      () => {
        loadAmortizationData()
      }
    )
  )

  return (
    <div class={styles.loanAmortizationSection}>
      {(() => {
        const schedule = result()?.schedule || []
        if (schedule.length === 0) {
          return <p class={styles.emptyState}>No amortization data available</p>
        }
        const s = result()?.summary
        return (
          <>
            {/* Action Buttons */}
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
              <button
                class={`${styles.btnSecondary} ${styles.btnSm}`}
                onclick={loadAmortizationData}
                disabled={loading()}
                title="Recalculate with current loan data"
              >
                Recalculate
              </button>
              <button class={`${styles.btnPrimary} ${styles.btnSm}`} onclick={toggleDetailed}>
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
                <div class={styles.summaryValue} style={{ 'font-weight': 600 }}>
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
                  <For each={props.loan.prepayments}>
                    {(p) => {
                      const loanStart = new Date(props.loan.start_date)
                      const prepayDate = new Date(loanStart)
                      prepayDate.setMonth(prepayDate.getMonth() + p.month - 1)
                      return (
                        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--bg); border-radius: var(--radius);">
                          <span style={{ 'font-size': '12px', color: 'var(--text-secondary)' }}>
                            {formatDate(prepayDate.toISOString().split('T')[0])}
                          </span>
                          <span style={{ 'font-weight': 600, color: 'var(--success)' }}>
                            +{formatCurrency(p.amount)}
                          </span>
                          {p.note && (
                            <span
                              style={{
                                'font-size': '11px',
                                color: 'var(--warning)',
                                'font-weight': '600',
                              }}
                            >
                              {p.note}
                            </span>
                          )}
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            )}

            {/* Rate Periods Section */}
            {props.loan.rate_periods && props.loan.rate_periods.length > 0 && (
              <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Rate Periods</h4>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <For each={props.loan.rate_periods}>
                    {(rp) => {
                      const loanStart = new Date(props.loan.start_date)
                      const rateDate = new Date(loanStart)
                      rateDate.setMonth(rateDate.getMonth() + rp.start_month - 1)
                      return (
                        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--bg); border-radius: var(--radius);">
                          <span style={{ 'font-size': '12px', color: 'var(--text-secondary)' }}>
                            {formatDate(rateDate.toISOString().split('T')[0])}
                          </span>
                          <span style={{ 'font-size': '11px', color: 'var(--text-secondary)' }}>
                            ({rp.start_month}
                            {rp.end_month ? ` - ${rp.end_month}` : '+'} mo)
                          </span>
                          <span style={{ 'font-weight': 600 }}>{rp.rate}%</span>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            )}

            {/* Charts */}
            <div
              style={{
                display: 'grid',
                'grid-template-columns': '1fr 1fr',
                gap: '16px',
                'margin-bottom': '24px',
              }}
            >
              <div
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  'border-radius': 'var(--radius)',
                  padding: '12px',
                }}
              >
                <h4
                  style={{
                    'font-size': '13px',
                    'font-weight': 600,
                    margin: '0 0 8px 0',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Monthly Payment Breakdown
                </h4>
                <Chart
                  type="bar"
                  data={{
                    labels: schedule.map((r) => `M${r.month}`),
                    datasets: [
                      {
                        label: 'Principal',
                        data: schedule.map((r) => r.principal),
                        backgroundColor: 'rgba(34, 197, 94, 0.7)',
                        borderColor: '#22c55e',
                        borderWidth: 0,
                        borderRadius: 2,
                      },
                      {
                        label: 'Interest',
                        data: schedule.map((r) => r.interest),
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderColor: '#ef4444',
                        borderWidth: 0,
                        borderRadius: 2,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: {
                          font: { size: 10 },
                          maxTicksLimit: 12,
                          autoSkip: true,
                          color: chartColors().text,
                        },
                      },
                      y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: {
                          callback: (v: any) => formatCurrency(v),
                          color: chartColors().text,
                        },
                        grid: { color: chartColors().grid },
                      },
                    },
                    plugins: {
                      legend: {
                        position: 'top',
                        labels: {
                          usePointStyle: true,
                          padding: 12,
                          font: { size: 11 },
                          color: chartColors().legend,
                        },
                      },
                    },
                  }}
                  height={240}
                  width="100%"
                />
              </div>
              <div
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  'border-radius': 'var(--radius)',
                  padding: '12px',
                }}
              >
                <h4
                  style={{
                    'font-size': '13px',
                    'font-weight': 600,
                    margin: '0 0 8px 0',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Balance Over Time
                </h4>
                <Chart
                  type="line"
                  data={{
                    labels: schedule.map((r) => `M${r.month}`),
                    datasets: [
                      {
                        label: 'Balance',
                        data: schedule.map((r) => r.balance),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 1,
                        borderWidth: 2,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: {
                        ticks: { color: chartColors().text },
                        grid: { color: chartColors().grid },
                      },
                      y: {
                        beginAtZero: true,
                        ticks: {
                          callback: (v: any) => formatCurrency(v),
                          color: chartColors().text,
                        },
                        grid: { color: chartColors().grid },
                      },
                    },
                    plugins: {
                      legend: { display: false },
                    },
                  }}
                  height={240}
                  width="100%"
                />
              </div>
            </div>

            {/* CSV Export */}
            <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '16px' }}>
              <button
                class={`${styles.btnSecondary} ${styles.btnSm}`}
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '6px',
                  'font-size': '12px',
                  padding: '6px 12px',
                }}
                onclick={() => {
                  exportAmortizationCSV(schedule, props.loan.name)
                }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </button>
            </div>

            {/* Basic Amortization Table */}
            <div>
              <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">
                Amortization Schedule
              </h4>
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
                    <For each={schedule}>
                      {(row, index) => {
                        const prev = index() > 0 ? schedule[index() - 1] : null
                        const rateChanged = prev && prev.rate !== row.rate
                        const hasPrepayment = row.prepayment && row.prepayment > 0
                        const note = hasPrepayment
                          ? 'Prepayment'
                          : rateChanged
                            ? `Rate: ${row.rate}%`
                            : ''

                        return (
                          <tr
                            classList={{
                              [styles.prepaymentRow]: !!hasPrepayment,
                              [styles.rateChangeRow]: !!rateChanged,
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
                            <td style={{ 'font-weight': 600 }}>{formatCurrency(row.balance)}</td>
                            <td>{row.rate.toFixed(3)}%</td>
                            {hasPrepayment ? (
                              <td
                                class={styles.tdAmount}
                                style={{ color: 'var(--success)', 'font-weight': 600 }}
                              >
                                {formatCurrency(row.prepayment as number)}
                              </td>
                            ) : (
                              <td>-</td>
                            )}
                            {note ? (
                              <td
                                style={{
                                  'font-size': '11px',
                                  color: 'var(--warning)',
                                  'font-weight': 600,
                                }}
                              >
                                {note}
                              </td>
                            ) : (
                              <td></td>
                            )}
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
              <div style="margin-top: 8px; font-size: '12px'; color: 'var(--text-secondary)'; display: flex; gap: 16px;">
                <span>
                  <span
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      padding: '2px 6px',
                      'border-radius': '4px',
                      'margin-right': '4px',
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
                      'border-radius': '4px',
                      'margin-right': '4px',
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
                    <h4 style="margin: 0; font-size: 16px; font-weight: 600;">
                      Detailed Amortization Schedule
                    </h4>
                    <span style={{ 'font-size': '12px', color: 'var(--text-secondary)' }}>
                      {props.loan.name} - {schedule.length} payments
                    </span>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <button
                      class={`${styles.btnSecondary} ${styles.btnSm}`}
                      onclick={() => setShowDetailed(false)}
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
                        <For each={generateDetailedRows(schedule, formatCurrency)}>
                          {(row) => (
                            <tr class={row.isYearMarker ? styles.yearMarker : ''}>
                              <td>{row.month}</td>
                              <td>{row.date}</td>
                              <td class={styles.tdAmount}>{row.payment}</td>
                              <td class={`${styles.tdAmount} ${styles.income}`}>{row.principal}</td>
                              <td class={`${styles.tdAmount} ${styles.expense}`}>{row.interest}</td>
                              <td style={{ 'font-weight': 600 }}>{row.balance}</td>
                              <td>{row.rate}</td>
                              {row.prepayment > 0 ? (
                                <td
                                  class={styles.tdAmount}
                                  style={{ color: 'var(--success)', 'font-weight': 600 }}
                                >
                                  {row.prepayment}
                                </td>
                              ) : (
                                <td>-</td>
                              )}
                              <td>{row.cumPrincipal}</td>
                              <td>{row.cumInterest}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                      <tfoot>
                        <tr class={styles.totalsRow}>
                          <td colSpan={2}>
                            <strong>Totals</strong>
                          </td>
                          <td class={styles.tdAmount}>
                            <strong>{s?.totalPaid ? formatCurrency(s.totalPaid) : '-'}</strong>
                          </td>
                          <td class={`${styles.tdAmount} ${styles.income}`}>
                            <strong>
                              {s?.totalPaid ? formatCurrency(s.totalPaid - s.totalInterest) : '-'}
                            </strong>
                          </td>
                          <td class={`${styles.tdAmount} ${styles.expense}`}>
                            <strong>{formatCurrency(s?.totalInterest || 0)}</strong>
                          </td>
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
                      <For each={generateDetailedRows(schedule, formatCurrency)}>
                        {(row) => (
                          <tr class={row.isYearMarker ? styles.yearMarker : ''}>
                            <td>{row.month}</td>
                            <td>{row.date}</td>
                            <td class={styles.tdAmount}>{row.payment}</td>
                            <td class={`${styles.tdAmount} ${styles.income}`}>{row.principal}</td>
                            <td class={`${styles.tdAmount} ${styles.expense}`}>{row.interest}</td>
                            <td style={{ 'font-weight': 600 }}>{row.balance}</td>
                            <td>{row.rate}</td>
                            {row.prepayment > 0 ? (
                              <td
                                class={styles.tdAmount}
                                style={{ color: 'var(--success)', 'font-weight': 600 }}
                              >
                                {row.prepayment}
                              </td>
                            ) : (
                              <td>-</td>
                            )}
                            <td>{row.cumPrincipal}</td>
                            <td>{row.cumInterest}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                    <tfoot>
                      <tr class={styles.totalsRow}>
                        <td colSpan={2}>
                          <strong>Totals</strong>
                        </td>
                        <td class={styles.tdAmount}>
                          <strong>{s?.totalPaid ? formatCurrency(s.totalPaid) : '-'}</strong>
                        </td>
                        <td class={`${styles.tdAmount} ${styles.income}`}>
                          <strong>
                            {s?.totalPaid ? formatCurrency(s.totalPaid - s.totalInterest) : '-'}
                          </strong>
                        </td>
                        <td class={`${styles.tdAmount} ${styles.expense}`}>
                          <strong>{formatCurrency(s?.totalInterest || 0)}</strong>
                        </td>
                        <td colSpan={5}></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
                <div style="margin-top: 12px; font-size: '12px'; color: 'var(--text-secondary)'; display: flex; gap: 16px;">
                  <span>
                    <span
                      style={{
                        background: 'rgba(16, 185, 129, 0.2)',
                        padding: '2px 6px',
                        'border-radius': '4px',
                        'margin-right': '4px',
                      }}
                    >
                      &nbsp;
                    </span>
                    Year End
                  </span>
                </div>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}

function exportAmortizationCSV(schedule: AmortizationRow[], loanName: string) {
  const headers = [
    'Month',
    'Date',
    'Payment',
    'Principal',
    'Interest',
    'Balance',
    'Rate',
    'Prepayment',
    'Note',
  ]
  const rows = schedule.map((r) => [
    r.month,
    r.date,
    r.payment.toFixed(2),
    r.principal.toFixed(2),
    r.interest.toFixed(2),
    r.balance.toFixed(2),
    r.rate.toFixed(3),
    r.prepayment ? r.prepayment.toFixed(2) : '0',
    r.note || '',
  ])
  const escapeCsv = (v: string | number) => {
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [
    headers.map(escapeCsv).join(','),
    ...rows.map((r) => r.map(escapeCsv).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${loanName.replace(/\s+/g, '_')}_amortization.csv`
  link.click()
  URL.revokeObjectURL(url)
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
