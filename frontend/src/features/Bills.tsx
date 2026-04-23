/**
 * Bills Component
 * Manages upcoming bills and payment tracking
 */
import { createSignal, onMount } from 'solid-js'
import styles from '../components/BillsPage.module.css'
import { formatCurrency } from '../core/api'

interface Bill {
  id: number
  name: string
  amount: number
  due_date: string
  account_id?: number
  category?: string
  frequency: 'monthly' | 'weekly' | 'biweekly'
  paid: boolean
  autopay: boolean
  profile_id: number
  created_at: string
}

export default function Bills() {
  const [bills, setBills] = createSignal<Bill[]>([])
  const [upcoming, setUpcoming] = createSignal<Bill[]>([])
  const [paid, setPaid] = createSignal<Bill[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [formData, setFormData] = createSignal({
    name: '',
    amount: '',
    due_date: '',
    frequency: 'monthly' as Bill['frequency'],
    autopay: false,
  })

  // Load bills
  const loadBills = async () => {
    setLoading(true)
    try {
      const [allRes, upcomingRes, paidRes] = await Promise.all([
        fetch('/api/bills').then(r => r.json()),
        fetch('/api/bills/upcoming').then(r => r.json()),
        fetch('/api/bills?paid=true').then(r => r.json()),
      ])
      setBills(allRes)
      // Handle upcoming bills which have next_due_date instead of due_date
      setUpcoming(upcomingRes.map((b: any) => ({
        ...b,
        due_date: b.due_date || b.next_due_date || '2026-05-01'
      })))
      setPaid(paidRes)
    } catch {
      console.error('Failed to load bills')
    } finally {
      setLoading(false)
    }
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      amount: parseFloat(formData().amount),
      due_date: formData().due_date,
      frequency: formData().frequency,
      autopay: formData().autopay,
    }

    try {
      await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setShowAddModal(false)
      setFormData({ name: '', amount: '', due_date: '', frequency: 'monthly', autopay: false })
      loadBills()
    } catch (error) {
      console.error('Failed to save bill', error)
    }
  }

  // Mark bill as paid
  const markPaid = async (id: number) => {
    try {
      await fetch(`/api/bills/${id}/mark-paid`, { method: 'POST' })
      loadBills()
    } catch (error) {
      console.error('Failed to mark bill as paid', error)
    }
  }

  // Delete bill
  const deleteBill = async (id: number) => {
    if (!confirm('Are you sure you want to delete this bill?')) return
    try {
      await fetch(`/api/bills/${id}`, { method: 'DELETE' })
      loadBills()
    } catch (error) {
      console.error('Failed to delete bill', error)
    }
  }

  // Days until due
  const daysUntil = (dateStr: string): string => {
    const target = new Date(dateStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    target.setHours(0, 0, 0, 0)
    const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return `${Math.abs(diff)} days overdue`
    if (diff === 0) return 'Due today'
    if (diff === 1) return 'Due tomorrow'
    return `Due in ${diff} days`
  }

  const isOverdue = (dateStr: string): boolean => {
    const target = new Date(dateStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    target.setHours(0, 0, 0, 0)
    return target < today
  }

  // Format date
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) {
      console.error('Invalid date:', dateStr, 'Date object:', date)
      return 'Invalid Date'
    }
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  onMount(() => {
    loadBills()
  })

  return (
    <div class={`page-bills page-enter ${styles.billsPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1>Bills</h1>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Bill
          </button>
        </div>
        <p class={styles.pageSubtitle}>Track upcoming payments and never miss a due date</p>
      </div>

      {/* Upcoming Section */}
      {upcoming().length > 0 && (
        <div class={styles.billsSection}>
          <h2 class={styles.sectionTitle}>
            <span>🔔</span> Upcoming Bills
            <span class={styles.sectionSubtitle}>{upcoming().length} bills</span>
          </h2>
          <div class={styles.billsList}>
            {upcoming().map((bill) => (
              <div class={`${styles.billCard} ${isOverdue(bill.due_date) ? styles.overdue : ''}`}>
                <div class={styles.billMain}>
                  <div class={styles.billIcon}>{bill.autopay ? '🤖' : '📝'}</div>
                  <div class={styles.billInfo}>
                    <h3 class={styles.billName}>{bill.name}</h3>
                    <p class={styles.billDetails}>
                      {formatDate(bill.due_date)} • {daysUntil(bill.due_date)} • {bill.frequency === 'monthly' ? 'Monthly' : bill.frequency === 'weekly' ? 'Weekly' : 'Biweekly'}
                    </p>
                  </div>
                </div>
                <div class={`${styles.billAmount} ${isOverdue(bill.due_date) ? styles.overdue : ''}`}>
                  <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                  {!bill.paid && (
                    <button class={`${styles.btnPrimary} ${styles.btnSm}`} onClick={() => markPaid(bill.id)}>
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paid Section */}
      {paid().length > 0 && (
        <div class={styles.billsSection}>
          <h2 class={styles.sectionTitle}>
            <span>✅</span> Paid Bills
            <span class={styles.sectionSubtitle}>{paid().length} bills</span>
          </h2>
          <div class={styles.billsList}>
            {paid().map((bill) => (
              <div class={`${styles.billCard} ${styles.paid}`}>
                <div class={styles.billMain}>
                  <div class={styles.billIcon}>✅</div>
                  <div class={styles.billInfo}>
                    <h3 class={styles.billName}>{bill.name}</h3>
                    <p class={styles.billDetails}>
                      Paid {formatDate(bill.due_date)}
                    </p>
                  </div>
                </div>
                <div class={styles.billAmount}>
                  <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                  <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => deleteBill(bill.id)}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Bills Section */}
      <div class={styles.billsSection}>
        <h2 class={styles.sectionTitle}>
          <span>📋</span> All Bills
          <span class={styles.sectionSubtitle}>{bills().length} total</span>
        </h2>
        {loading() ? (
          <div class={styles.emptyState}>Loading bills...</div>
        ) : bills().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No bills yet</p>
            <p>Add your first bill to start tracking your payments.</p>
            <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
              Add Bill
            </button>
          </div>
        ) : (
          <div class={styles.billsList}>
            {bills().map((bill) => (
              <div class={styles.billCard}>
                <div class={styles.billMain}>
                  <div class={styles.billIcon}>{bill.autopay ? '🤖' : '📝'}</div>
                  <div class={styles.billInfo}>
                    <h3 class={styles.billName}>{bill.name}</h3>
                    <p class={styles.billDetails}>
                      {formatDate(bill.due_date)} • {bill.frequency === 'monthly' ? 'Monthly' : bill.frequency === 'weekly' ? 'Weekly' : 'Biweekly'}
                      {bill.category && ` • ${bill.category}`}
                    </p>
                  </div>
                </div>
                <div class={styles.billAmount}>
                  <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                  <div class="bill-actions">
                    {!bill.paid ? (
                      <button class={`${styles.btnPrimary} ${styles.btnSm}`} onClick={() => markPaid(bill.id)}>
                        {isOverdue(bill.due_date) ? 'Mark as Paid (Overdue)' : 'Mark Paid'}
                      </button>
                    ) : (
                      <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => deleteBill(bill.id)}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Bill Modal */}
      {showAddModal() && (
        <div class={styles.modalOverlay} onclick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div class={styles.modal} onclick={(e) => { e.stopPropagation(); }}>
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>Add Bill</h3>
              <button class={styles.modalClose} onClick={() => setShowAddModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Bill Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Rent, Electricity, Internet"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="500.00"
                  value={formData().amount}
                  oninput={(e) => setFormData({ ...formData(), amount: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Due Date</label>
                <input
                  type="date"
                  class={styles.formControl}
                  value={formData().due_date}
                  oninput={(e) => setFormData({ ...formData(), due_date: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Frequency</label>
                <select
                  class={styles.formControl}
                  value={formData().frequency}
                  oninput={(e) => setFormData({ ...formData(), frequency: e.target.value as Bill['frequency'] })}
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>
                  <span>🤖 Autopay</span>
                  <span style="font-size: 14px; color: var(--text-secondary)">
                    Automatically pay this bill
                  </span>
                </label>
                <label class={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={formData().autopay}
                    oninput={(e) => setFormData({ ...formData(), autopay: e.target.checked })}
                  />
                  <span class={styles.toggleSlider}></span>
                </label>
              </div>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
                  Add Bill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Bill Modal - disabled as unused - kept for future use */}
    </div>
  )
}