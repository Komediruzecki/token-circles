/**
 * Loans Component - EARS Specification
 *
 * GIVEN: A user is viewing the Loans page
 * WHEN: The page loads
 * THEN: The header displays "Loans" and shows all loans with summary cards
 *
 * GIVEN: A user wants to add a new loan
 * WHEN: They click the "Add Loan" button
 * THEN: An "Add Loan" modal opens with fields for loan name, principal, interest rate, and term
 *
 * GIVEN: A user adds a loan with monthly payments
 * WHEN: They enter loan details and save
 * THEN: The loan appears in the loans grid showing total borrowed, remaining balance, and monthly payment
 *
 * GIVEN: A user wants to view the amortization schedule
 * WHEN: They click on a loan's "View Schedule" button
 * THEN: The amortization table modal opens showing all payment periods
 *
 * GIVEN: A user makes a payment on a loan
 * WHEN: They click the "Mark Paid" button on a payment
 * THEN: The payment status updates and remaining balance decreases
 *
 * GIVEN: A user wants to delete a loan
 * WHEN: They select a loan and confirm deletion
 * THEN: The loan is removed from the list
 */

/**
 * Loans Component
 * Manages loans, tracks payments, and calculates remaining balance
 */
import { createEffect, createMemo, createSignal, For, onMount } from 'solid-js'
import Badge from '../components/Badge'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import LoanAmortizationTable from '../components/LoanAmortizationTable'
import { api as _api, formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { theme } from '../core/theme'
import styles from './LoansPage.module.css'
import type { LoanDetail, LoanPrepayment } from '../types/models'

interface Loan {
  id: number
  name: string
  principal: number
  interest_rate: number
  term_months: number
  start_date: string
  status: 'active' | 'paid' | 'deferred'
  remaining_balance: number
  total_paid: number
  monthly_payment?: number
  next_payment_date?: string
  profile_id: number
}

export default function Loans() {
  const state = useAppState()
  const [loans, setLoans] = createSignal<Loan[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingLoan, setEditingLoan] = createSignal<Loan | null>(null)
  const [showAmortization, setShowAmortization] = createSignal(false)
  const [amortizationLoan, setAmortizationLoan] = createSignal<Loan | null>(null)
  const [amortizationRecalculateKey, setAmortizationRecalculateKey] = createSignal(0)
  const [showPrepayments, setShowPrepayments] = createSignal(false)
  const [prepaymentsLoanId, setPrepaymentsLoanId] = createSignal<number>(0)
  const [prepayments, setPrepayments] = createSignal<any[]>([])
  const [prepaymentForm, setPrepaymentForm] = createSignal({
    month: '',
    amount: '',
    note: '',
  })
  interface RatePeriod {
    rate: string
    start_month: number
    end_month: number | null
  }

  const [formData, setFormData] = createSignal({
    name: '',
    principal: '',
    interest_rate: '',
    term_months: '',
    start_date: '',
    status: 'active' as Loan['status'],
    rate_periods: [] as RatePeriod[],
  })

  const emptyForm = () => ({
    name: '',
    principal: '',
    interest_rate: '',
    term_months: '',
    start_date: '',
    status: 'active' as Loan['status'],
    rate_periods: [] as RatePeriod[],
  })

  // Load loans
  const loadLoans = async () => {
    setLoading(true)
    try {
      const data = await apiGet<any[]>('/api/loans')
      // Transform Loan data to include missing fields
      setLoans(
        data.map((l) => ({
          id: l.id,
          name: l.name,
          principal: l.principal,
          interest_rate: l.interest_rate,
          term_months: l.term_months,
          start_date: l.start_date,
          profile_id: l.profile_id || 1,
          status: 'active',
          remaining_balance: l.principal,
          total_paid: 0,
        }))
      )
    } catch (err) {
      console.error('Failed to load loans:', err)
      showToast('Failed to load loans', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Prepayment management
  const loadPrepayments = async (loanId: number) => {
    try {
      const full = await apiGet<LoanDetail>(`/api/loans/${loanId}`)
      setPrepayments((full as LoanDetail).prepayments || [])
    } catch {
      setPrepayments([])
    }
  }

  const addPrepayment = async (loanId: number) => {
    const f = prepaymentForm()
    const month = parseInt(f.month)
    const amount = parseFloat(f.amount)
    if (!month || !amount) {
      showToast('Month and amount are required', 'error')
      return
    }
    try {
      await apiPost(`/api/loans/${loanId}/prepayments`, {
        month,
        amount,
        note: f.note || '',
      })
      showToast('Prepayment added', 'success')
      setPrepaymentForm({ month: '', amount: '', note: '' })
      loadPrepayments(loanId)
      setAmortizationRecalculateKey((k) => k + 1)
      if (amortizationLoan()?.id === loanId) {
        const fresh = await apiGet<LoanDetail>(`/api/loans/${loanId}`)
        setAmortizationLoan({ ...amortizationLoan()!, prepayments: fresh.prepayments || [] })
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add prepayment', 'error')
    }
  }

  const deletePrepayment = async (loanId: number, prepayId: number) => {
    try {
      await apiDelete(`/api/loans/${loanId}/prepayments/${prepayId}`)
      showToast('Prepayment deleted', 'success')
      loadPrepayments(loanId)
      setAmortizationRecalculateKey((k) => k + 1)
      if (amortizationLoan()?.id === loanId) {
        const fresh = await apiGet<LoanDetail>(`/api/loans/${loanId}`)
        setAmortizationLoan({ ...amortizationLoan()!, prepayments: fresh.prepayments || [] })
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete prepayment', 'error')
    }
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      principal: parseFloat(formData().principal),
      interest_rate: parseFloat(formData().interest_rate.replace(',', '.')) || 0,
      term_months: parseInt(formData().term_months),
      start_date: formData().start_date,
      status: formData().status,
      rate_periods: formData().rate_periods.map((rp) => ({
        ...rp,
        rate: parseFloat(rp.rate.replace(',', '.')) || 0,
      })),
    }

    try {
      if (editingLoan()) {
        await apiPut(`/api/loans/${editingLoan()!.id}`, data)
        showToast('Loan updated successfully', 'success')
      } else {
        await apiPost('/api/loans', data)
        showToast('Loan created successfully', 'success')
      }
      setShowAddModal(false)
      setEditingLoan(null)
      setFormData(emptyForm())
      loadLoans()
    } catch (err) {
      console.error('Failed to save loan:', err)
      showToast('Failed to save loan', 'error')
    }
  }

  // Delete loan
  const deleteLoan = async (id: number) => {
    try {
      await apiDelete(`/api/loans/${id}`)
      showToast('Loan deleted successfully', 'success')
      loadLoans()
    } catch (err) {
      console.error('Failed to delete loan:', err)
      showToast('Failed to delete loan', 'error')
    }
  }

  // Calculate estimated monthly payment
  const calculateMonthlyPayment = (
    principal: number,
    interestRate: number,
    termMonths: number
  ): number => {
    if (!termMonths || termMonths <= 0) return 0
    if (interestRate === 0) return principal / termMonths
    const monthlyRate = interestRate / 100 / 12
    return (
      (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1)
    )
  }

  // Open edit modal
  const editLoan = async (loan: Loan) => {
    setEditingLoan(loan)
    let ratePeriods: RatePeriod[] = []
    try {
      const full = await apiGet<LoanDetail>(`/api/loans/${loan.id}`)
      ratePeriods = ((full as LoanDetail).rate_periods || []).map((rp) => ({
        rate: String(rp.rate),
        start_month: rp.start_month,
        end_month: rp.end_month || null,
      }))
    } catch {
      /* use empty rate periods */
    }
    setFormData({
      name: loan.name,
      principal: loan.principal.toString(),
      interest_rate: loan.interest_rate.toString(),
      term_months: loan.term_months.toString(),
      start_date: loan.start_date.slice(0, 10),
      status: loan.status,
      rate_periods: ratePeriods,
    })
    setShowAddModal(true)
  }

  // Calculate remaining balance
  const calculateRemaining = (loan: Loan): number => {
    const monthly =
      loan.monthly_payment ||
      calculateMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
    const monthsPassed = Math.floor(
      (new Date().getTime() - new Date(loan.start_date).getTime()) / (1000 * 60 * 60 * 24 * 30)
    )
    const paidMonths = Math.min(monthsPassed, loan.term_months)
    return Math.max(0, loan.principal - paidMonths * monthly)
  }

  // Progress percentage
  const getProgress = (loan: Loan): number => {
    const remaining = calculateRemaining(loan)
    return Math.min(100, Math.round(((loan.principal - remaining) / loan.principal) * 100))
  }

  // Format date
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // Format currency
  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  // Get status for Badge component
  const getLoanBadgeStatus = (status: string): 'primary' | 'success' | 'warning' | 'default' => {
    const statusMap: Record<string, 'primary' | 'success' | 'warning' | 'default'> = {
      active: 'primary',
      paid: 'success',
      deferred: 'warning',
    }
    return statusMap[status] || 'default'
  }

  // Get status label
  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      active: 'Active',
      paid: 'Paid Off',
      deferred: 'Deferred',
    }
    return labels[status] || status
  }

  onMount(() => {
    loadLoans()
  })

  createEffect(() => {
    void state.profileVersion
    loadLoans()
  })

  const chartColors = () => theme.getChartColors()

  // Calculate totals
  const totalPrincipal = createMemo(() => loans().reduce((sum, l) => sum + l.principal, 0))
  const totalRemaining = createMemo(() =>
    loans().reduce((sum, l) => sum + calculateRemaining(l), 0)
  )

  return (
    <div class={`page page-loans page-enter ${styles.loansPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="loans-header">Loans</h1>
          <button
            data-test-id="add-loan-btn"
            class={styles.btnPrimary}
            onclick={() => setShowAddModal(true)}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Loan
          </button>
        </div>
        <p data-test-id="loans-subtitle" class={styles.pageSubtitle}>
          Track your loans and manage payments
        </p>
      </div>

      {/* Summary Cards */}
      <div class={styles.loansSummary}>
        <div class={styles.summaryCard} style={{ 'border-color': 'var(--primary)' }}>
          <div class={styles.summaryLabel}>Total Borrowed</div>
          <div class={styles.summaryValue}>{formatAmount(totalPrincipal())}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Remaining Balance</div>
          <div class={styles.summaryValue}>{formatAmount(totalRemaining())}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Active Loans</div>
          <div class={styles.summaryValue}>
            {loans().filter((l) => l.status === 'active').length}
          </div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Paid Off</div>
          <div class={styles.summaryValue}>{loans().filter((l) => l.status === 'paid').length}</div>
        </div>
      </div>

      {loading() ? (
        <div data-test-id="loading-state" class={styles.emptyState}>
          Loading loans...
        </div>
      ) : loans().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No loans yet</p>
          <p>Add your first loan to start tracking your debt.</p>
          <button class={styles.btnPrimary} onclick={() => setShowAddModal(true)}>
            Add Loan
          </button>
        </div>
      ) : (
        <div class={styles.loansGrid}>
          <For each={loans()}>
            {(loan) => {
              const remaining = calculateRemaining(loan)
              const monthly =
                loan.monthly_payment ||
                calculateMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
              const progress = getProgress(loan)

              return (
                <div class={styles.loanCard}>
                  <div class={styles.loanHeader}>
                    <div class={styles.loanIcon}>
                      <svg
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </div>
                    <div class={styles.loanInfo}>
                      <h3 class={styles.loanName}>{loan.name}</h3>
                      <Badge status={getLoanBadgeStatus(loan.status)}>
                        {getStatusLabel(loan.status)}
                      </Badge>
                    </div>
                    <div class={styles.loanActions}>
                      <button
                        class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        title="Prepayments"
                        onclick={() => {
                          setPrepaymentsLoanId(loan.id)
                          loadPrepayments(loan.id)
                          setShowPrepayments(true)
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <button
                        class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        title="View Amortization"
                        onclick={() => {
                          setAmortizationLoan(loan)
                          setAmortizationRecalculateKey((k) => k + 1)
                          setShowAmortization(true)
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      </button>
                      <button
                        class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        onclick={() => {
                          editLoan(loan)
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <ConfirmButton
                        class={`${styles.btnSm} ${styles.btnGhost}`}
                        onConfirm={() => deleteLoan(loan.id)}
                        label={
                          <svg
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        }
                      />
                    </div>
                  </div>
                  <div class={styles.loanBalance}>
                    <div class={styles.balanceLabel}>Remaining Balance</div>
                    <div class={styles.balanceAmount}>{formatAmount(remaining)}</div>
                  </div>
                  <div class={styles.loanDetails}>
                    <div class={styles.detailRow}>
                      <span class={styles.detailLabel}>Principal</span>
                      <span class={styles.detailValue}>{formatAmount(loan.principal)}</span>
                    </div>
                    <div class={styles.detailRow}>
                      <span class={styles.detailLabel}>Interest Rate</span>
                      <span class={styles.detailValue}>{loan.interest_rate}%</span>
                    </div>
                    <div class={styles.detailRow}>
                      <span class={styles.detailLabel}>Monthly Payment</span>
                      <span class={styles.detailValue}>{formatAmount(monthly)}</span>
                    </div>
                    <div class={styles.detailRow}>
                      <span class={styles.detailLabel}>Next Payment</span>
                      <span class={styles.detailValue}>
                        {loan.next_payment_date ? formatDate(loan.next_payment_date) : 'Not set'}
                      </span>
                    </div>
                  </div>
                  <div class={styles.loanProgress}>
                    <div class={styles.progressBar}>
                      <div class={styles.progressFill} style={{ width: `${progress}%` }} />
                    </div>
                    <div class={styles.progressStats}>
                      <span class={styles.progressPercent}>{progress}% paid</span>
                      <span class={styles.progressCurrent}>
                        {formatAmount(loan.total_paid)} paid
                      </span>
                    </div>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      )}

      {/* Loan Charts */}
      {loans().length > 0 && (
        <div class={styles.loanAmortizationSection}>
          <h3>Loan Overview</h3>
          <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' }}>
            <div class={styles.amortizationChartWrapper}>
              <h4
                style={{
                  'font-size': '13px',
                  'font-weight': 600,
                  margin: '0 0 12px 0',
                  color: 'var(--text-secondary)',
                }}
              >
                Principal vs Remaining
              </h4>
              <Chart
                type="bar"
                data={{
                  labels: loans().map((l) => l.name),
                  datasets: [
                    {
                      label: 'Principal',
                      data: loans().map((l) => l.principal),
                      backgroundColor: 'rgba(34, 197, 94, 0.7)',
                      borderColor: '#22c55e',
                      borderWidth: 0,
                      borderRadius: 4,
                    },
                    {
                      label: 'Remaining',
                      data: loans().map((l) => calculateRemaining(l)),
                      backgroundColor: 'rgba(220, 38, 38, 0.7)',
                      borderColor: '#dc2626',
                      borderWidth: 0,
                      borderRadius: 4,
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
                        callback: (value: any) => formatAmount(value),
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
                        padding: 15,
                        font: { size: 12 },
                        color: chartColors().legend,
                      },
                    },
                  },
                }}
                height={250}
                width="100%"
              />
            </div>
            <div class={styles.amortizationChartWrapper}>
              <h4
                style={{
                  'font-size': '13px',
                  'font-weight': 600,
                  margin: '0 0 12px 0',
                  color: 'var(--text-secondary)',
                }}
              >
                Debt Distribution
              </h4>
              <Chart
                type="doughnut"
                data={{
                  labels: loans().map((l) => l.name),
                  datasets: [
                    {
                      data: loans().map((l) => l.principal),
                      backgroundColor: [
                        '#22c55e',
                        '#3b82f6',
                        '#f59e0b',
                        '#ef4444',
                        '#8b5cf6',
                        '#ec4899',
                        '#06b6d4',
                        '#84cc16',
                      ],
                      borderColor: chartColors().grid,
                      borderWidth: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 11 },
                        color: chartColors().legend,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (ctx: any) => {
                          const val = ctx.parsed
                          const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0)
                          const pct = total > 0 ? `${Math.round((val / total) * 100)}%` : '0%'
                          return ` ${formatAmount(val)} (${pct})`
                        },
                      },
                    },
                  },
                }}
                height={250}
                width="100%"
              />
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div
          class={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onclick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddModal(false)
              setEditingLoan(null)
              setFormData(emptyForm())
            }
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>{editingLoan() ? 'Edit Loan' : 'Add Loan'}</h3>
              <button
                class={styles.modalClose}
                onclick={() => {
                  setShowAddModal(false)
                  setEditingLoan(null)
                  setFormData({
                    name: '',
                    principal: '',
                    interest_rate: '',
                    term_months: '',
                    start_date: '',
                    status: 'active',
                    rate_periods: [],
                  })
                }}
              >
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Loan Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Auto Loan, Student Loan"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  autofocus
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Principal Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="15000.00"
                  value={formData().principal}
                  oninput={(e) => setFormData({ ...formData(), principal: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Interest Rate (%)</label>
                <input
                  type="text"
                  inputmode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  class={styles.formControl}
                  placeholder="5.5"
                  value={formData().interest_rate}
                  oninput={(e) => setFormData({ ...formData(), interest_rate: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Term (months)</label>
                <input
                  type="number"
                  class={styles.formControl}
                  placeholder="60"
                  value={formData().term_months}
                  oninput={(e) => setFormData({ ...formData(), term_months: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Start Date</label>
                <input
                  type="date"
                  class={styles.formControl}
                  value={formData().start_date}
                  oninput={(e) => setFormData({ ...formData(), start_date: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Status</label>
                <select
                  class={styles.formControl}
                  value={formData().status}
                  onchange={(e) =>
                    setFormData({ ...formData(), status: e.target.value as Loan['status'] })
                  }
                >
                  <option value="active">Active</option>
                  <option value="deferred">Deferred</option>
                  <option value="paid">Paid Off</option>
                </select>
              </div>
              {/* Rate Periods */}
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Rate Periods</label>
                <div
                  style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '8px',
                    'margin-bottom': '8px',
                  }}
                >
                  <For each={formData().rate_periods}>
                    {(rp: RatePeriod, idx) => (
                      <div
                        style={{
                          display: 'flex',
                          'align-items': 'center',
                          gap: '8px',
                          padding: '8px',
                          background: 'var(--bg)',
                          'border-radius': '8px',
                          'font-size': '13px',
                        }}
                      >
                        <input
                          type="text"
                          inputmode="decimal"
                          pattern="[0-9]*[.,]?[0-9]*"
                          placeholder="Rate %"
                          value={rp.rate}
                          style={{
                            width: '80px',
                            padding: '6px',
                            border: '1px solid var(--border)',
                            'border-radius': '4px',
                            background: 'var(--bg)',
                            color: 'var(--text)',
                            'font-size': '13px',
                          }}
                          oninput={(e) => {
                            rp.rate = e.target.value
                          }}
                        />
                        <span style={{ 'font-size': '12px', color: 'var(--text-secondary)' }}>
                          from month
                        </span>
                        <input
                          type="number"
                          placeholder="Start"
                          value={rp.start_month}
                          style={{
                            width: '60px',
                            padding: '6px',
                            border: '1px solid var(--border)',
                            'border-radius': '4px',
                            background: 'var(--bg)',
                            color: 'var(--text)',
                            'font-size': '13px',
                          }}
                          oninput={(e) => {
                            rp.start_month = parseInt(e.target.value) || 0
                          }}
                        />
                        <input
                          type="number"
                          placeholder="End (opt)"
                          value={rp.end_month ?? ''}
                          style={{
                            width: '70px',
                            padding: '6px',
                            border: '1px solid var(--border)',
                            'border-radius': '4px',
                            background: 'var(--bg)',
                            color: 'var(--text)',
                            'font-size': '13px',
                          }}
                          oninput={(e) => {
                            const val = e.target.value
                            rp.end_month = val ? parseInt(val) : null
                          }}
                        />
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--danger)',
                            cursor: 'pointer',
                            padding: '4px',
                            'border-radius': '4px',
                          }}
                          onclick={() => {
                            const i = idx()
                            const updated = formData().rate_periods.filter(
                              (_: RatePeriod, j: number) => j !== i
                            )
                            setFormData({ ...formData(), rate_periods: updated })
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
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
                </div>
                <button
                  type="button"
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    'font-size': '12px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    'border-radius': 'var(--radius)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                  onclick={() => {
                    setFormData({
                      ...formData(),
                      rate_periods: [
                        ...formData().rate_periods,
                        {
                          rate: formData().interest_rate,
                          start_month: 1,
                          end_month: null,
                        },
                      ],
                    })
                  }}
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add Rate Period
                </button>
              </div>

              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onclick={() => {
                    setShowAddModal(false)
                    setEditingLoan(null)
                    setFormData(emptyForm())
                  }}
                >
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
                  {editingLoan() ? 'Update' : 'Add'} Loan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Amortization Table */}
      {showAmortization() && amortizationLoan() && (
        <LoanAmortizationTable
          loanId={amortizationLoan()!.id}
          loan={amortizationLoan()!}
          showDetailed={false}
          recalculateKey={amortizationRecalculateKey()}
        />
      )}

      {/* Prepayments Modal */}
      {showPrepayments() &&
        (() => {
          const loan = loans().find((l) => l.id === prepaymentsLoanId())
          if (!loan) return null
          return (
            <div
              class={styles.modalOverlay}
              onclick={(e) => {
                if (e.target === e.currentTarget) setShowPrepayments(false)
              }}
            >
              <div
                class={styles.modal}
                onclick={(e) => {
                  e.stopPropagation()
                }}
              >
                <div class={styles.modalHeader}>
                  <h3 class={styles.modalTitle}>Prepayments - {loan.name}</h3>
                  <button class={styles.modalClose} onclick={() => setShowPrepayments(false)}>
                    <svg
                      width="24"
                      height="24"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div class={styles.modalBody}>
                  {/* Existing Prepayments */}
                  {prepayments().length > 0 ? (
                    <div style={{ 'margin-bottom': '16px' }}>
                      <label class={styles.formLabel}>Existing Prepayments</label>
                      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                        <For each={prepayments()}>
                          {(p: LoanPrepayment) => (
                            <div
                              style={{
                                display: 'flex',
                                'align-items': 'center',
                                'justify-content': 'space-between',
                                padding: '10px 12px',
                                background: 'var(--bg)',
                                'border-radius': '8px',
                                'font-size': '13px',
                                border: '1px solid var(--border)',
                              }}
                            >
                              <div
                                style={{ display: 'flex', gap: '16px', 'align-items': 'center' }}
                              >
                                <span style={{ 'font-weight': 600, color: 'var(--text)' }}>
                                  Month {p.month}
                                </span>
                                <span style={{ color: 'var(--primary)' }}>
                                  {formatCurrency(p.amount)}
                                </span>
                                {p.note ? (
                                  <span
                                    style={{ color: 'var(--text-secondary)', 'font-size': '12px' }}
                                  >
                                    {p.note}
                                  </span>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  cursor: 'pointer',
                                  padding: '4px',
                                  'border-radius': '4px',
                                }}
                                onclick={() => deletePrepayment(loan.id, p.id)}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  ) : (
                    <p
                      style={{
                        color: 'var(--text-secondary)',
                        'font-size': '13px',
                        'margin-bottom': '16px',
                      }}
                    >
                      No prepayments recorded yet.
                    </p>
                  )}

                  {/* Add Prepayment Form */}
                  <div style={{ 'border-top': '1px solid var(--border)', 'padding-top': '16px' }}>
                    <label class={styles.formLabel}>Add Prepayment</label>
                    <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '8px' }}>
                      <input
                        type="number"
                        min="1"
                        class={styles.formControl}
                        placeholder="Month #"
                        value={prepaymentForm().month}
                        style={{ width: '100px' }}
                        oninput={(e) =>
                          setPrepaymentForm({ ...prepaymentForm(), month: e.target.value })
                        }
                      />
                      <input
                        type="number"
                        step="0.01"
                        class={styles.formControl}
                        placeholder="Amount"
                        value={prepaymentForm().amount}
                        style={{ width: '140px' }}
                        oninput={(e) =>
                          setPrepaymentForm({ ...prepaymentForm(), amount: e.target.value })
                        }
                      />
                      <input
                        type="text"
                        class={styles.formControl}
                        placeholder="Note (optional)"
                        value={prepaymentForm().note}
                        style={{ flex: 1 }}
                        oninput={(e) =>
                          setPrepaymentForm({ ...prepaymentForm(), note: e.target.value })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      class={styles.btnPrimary}
                      style={{ 'font-size': '13px' }}
                      onclick={() => addPrepayment(loan.id)}
                    >
                      Add Prepayment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
