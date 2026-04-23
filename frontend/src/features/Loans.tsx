/**
 * Loans Component
 * Manages loans, tracks payments, and calculates remaining balance
 */
import { createSignal, onMount } from 'solid-js'
import styles from '../components/LoansPage.module.css'
import { api as _api, formatCurrency } from '../core/api'

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
  const [loans, setLoans] = createSignal<Loan[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingLoan, setEditingLoan] = createSignal<Loan | null>(null)
  const [formData, setFormData] = createSignal({
    name: '',
    principal: '',
    interest_rate: '',
    term_months: '',
    start_date: '',
    status: 'active' as Loan['status'],
  })

  // Load loans
  const loadLoans = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/loans')
      const data = await response.json()
      // Transform Loan data to include missing fields
      setLoans(data.map((l: any) => ({
        id: l.id,
        name: l.name,
        principal: l.principal,
        interest_rate: l.interest_rate,
        term_months: l.term_months,
        start_date: l.start_date,
        status: 'active',
        remaining_balance: l.principal,
        total_paid: 0,
      })))
    } catch {
      console.error('Failed to load loans')
    } finally {
      setLoading(false)
    }
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      principal: parseFloat(formData().principal),
      interest_rate: parseFloat(formData().interest_rate),
      term_months: parseInt(formData().term_months),
      start_date: formData().start_date,
      status: formData().status,
    }

    try {
      await fetch('/api/loans', {
        method: editingLoan() ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setShowAddModal(false)
      setEditingLoan(null)
      setFormData({ name: '', principal: '', interest_rate: '', term_months: '', start_date: '', status: 'active' })
      loadLoans()
    } catch (error) {
      console.error('Failed to save loan', error)
    }
  }

  // Delete loan
  const deleteLoan = async (id: number) => {
    if (!confirm('Are you sure you want to delete this loan?')) return
    try {
      await fetch(`/api/loans/${id}`, { method: 'DELETE' })
      loadLoans()
    } catch (error) {
      console.error('Failed to delete loan', error)
    }
  }

  // Calculate estimated monthly payment
  const calculateMonthlyPayment = (principal: number, interestRate: number, termMonths: number): number => {
    if (interestRate === 0) return principal / termMonths
    const monthlyRate = interestRate / 100 / 12
    return (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1)
  }

  // Open edit modal
  const editLoan = (loan: Loan) => {
    setEditingLoan(loan)
    setFormData({
      name: loan.name,
      principal: loan.principal.toString(),
      interest_rate: loan.interest_rate.toString(),
      term_months: loan.term_months.toString(),
      start_date: loan.start_date.slice(0, 10),
      status: loan.status,
    })
    setShowAddModal(true)
  }

  // Calculate remaining balance
  const calculateRemaining = (loan: Loan): number => {
    const monthly = loan.monthly_payment || calculateMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
    const monthsPassed = Math.floor((new Date().getTime() - new Date(loan.start_date).getTime()) / (1000 * 60 * 60 * 24 * 30))
    const paidMonths = Math.min(monthsPassed, loan.term_months)
    return Math.max(0, loan.principal - (paidMonths * monthly))
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

  // Get status badge
  const getStatusBadge = (status: string): string => {
    const badges: Record<string, string> = {
      active: 'badge-primary',
      paid: 'badge-success',
      deferred: 'badge-warning',
    }
    return badges[status] || 'badge-default'
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

  // Calculate totals
  const totalPrincipal = () => loans().reduce((sum, l) => sum + l.principal, 0)
  const totalRemaining = () => loans().reduce((sum, l) => sum + calculateRemaining(l), 0)

  return (
    <div class={`page page-loans page-enter ${styles.loansPage}`}>
      <div class={styles.pageHeader}>
        <div class="header-top">
          <h1>Loans</h1>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Loan
          </button>
        </div>
        <p class="page-subtitle">Track your loans and manage payments</p>
      </div>

      {/* Summary Cards */}
      <div class="loans-summary">
        <div class="summary-card highlighted">
          <div class="summary-label">Total Borrowed</div>
          <div class="summary-value">{formatAmount(totalPrincipal())}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Remaining Balance</div>
          <div class="summary-value">{formatAmount(totalRemaining())}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Active Loans</div>
          <div class="summary-value">{loans().filter(l => l.status === 'active').length}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Paid Off</div>
          <div class="summary-value">{loans().filter(l => l.status === 'paid').length}</div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading loans...</div>
      ) : loans().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No loans yet</p>
          <p>Add your first loan to start tracking your debt.</p>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            Add Loan
          </button>
        </div>
      ) : (
        <div class="loans-grid">
          {loans().map((loan) => {
            const remaining = calculateRemaining(loan)
            const monthly = loan.monthly_payment || calculateMonthlyPayment(loan.principal, loan.interest_rate, loan.term_months)
            const progress = getProgress(loan)

            return (
              <div class="loan-card">
                <div class="loan-header">
                  <div class="loan-icon">🏦</div>
                  <div class="loan-info">
                    <h3 class="loan-name">{loan.name}</h3>
                    <span class={`badge ${getStatusBadge(loan.status)}`}>{getStatusLabel(loan.status)}</span>
                  </div>
                  <div class="loan-actions">
                    <button class="btn btn-sm btn-ghost" onClick={() => { editLoan(loan); }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost" onClick={() => deleteLoan(loan.id)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="loan-balance">
                  <div class="balance-label">Remaining Balance</div>
                  <div class="balance-amount">{formatAmount(remaining)}</div>
                </div>
                <div class="loan-details">
                  <div class="detail-row">
                    <span class="detail-label">Principal</span>
                    <span class="detail-value">{formatAmount(loan.principal)}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Interest Rate</span>
                    <span class="detail-value">{loan.interest_rate}%</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Monthly Payment</span>
                    <span class="detail-value">{formatAmount(monthly)}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Next Payment</span>
                    <span class="detail-value">
                      {loan.next_payment_date ? formatDate(loan.next_payment_date) : 'Not set'}
                    </span>
                  </div>
                </div>
                <div class="loan-progress">
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div class="progress-stats">
                    <span class="progress-percent">{progress}% paid</span>
                    <span class="progress-current">{formatAmount(loan.total_paid)} paid</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div class={styles.modalOverlay} onclick={(e) => { if (e.target === e.currentTarget) { setShowAddModal(false); setEditingLoan(null); setFormData({ name: '', principal: '', interest_rate: '', term_months: '', start_date: '', status: 'active' }) }}}>
          <div class={styles.modal} onclick={(e) => { e.stopPropagation(); }}>
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>{editingLoan() ? 'Edit Loan' : 'Add Loan'}</h3>
              <button class={styles.modalClose} onClick={() => { setShowAddModal(false); setEditingLoan(null); setFormData({ name: '', principal: '', interest_rate: '', term_months: '', start_date: '', status: 'active' }) }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class="form-group">
                <label class="form-label">Loan Name</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., Auto Loan, Student Loan"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Principal Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="15000.00"
                  value={formData().principal}
                  oninput={(e) => setFormData({ ...formData(), principal: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Interest Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="5.5"
                  value={formData().interest_rate}
                  oninput={(e) => setFormData({ ...formData(), interest_rate: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Term (months)</label>
                <input
                  type="number"
                  class="form-control"
                  placeholder="60"
                  value={formData().term_months}
                  oninput={(e) => setFormData({ ...formData(), term_months: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Start Date</label>
                <input
                  type="date"
                  class="form-control"
                  value={formData().start_date}
                  oninput={(e) => setFormData({ ...formData(), start_date: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Status</label>
                <select
                  class="form-control"
                  value={formData().status}
                  oninput={(e) => setFormData({ ...formData(), status: e.target.value as Loan['status'] })}
                >
                  <option value="active">Active</option>
                  <option value="deferred">Deferred</option>
                  <option value="paid">Paid Off</option>
                </select>
              </div>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={() => { setShowAddModal(false); setEditingLoan(null); setFormData({ name: '', principal: '', interest_rate: '', term_months: '', start_date: '', status: 'active' }) }}>
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
    </div>
  )
}