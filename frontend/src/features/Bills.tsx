/**
 * Bills Component
 * Manages upcoming bills and payment tracking
 */
import { createSignal, onMount } from 'solid-js'
import styles from '../components/BillsPage.module.css'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, showToast } from '../utils/api'

interface Bill {
  id: number
  name: string
  amount: number
  due_date: string
  category?: string
  account_id?: number
  frequency: 'monthly' | 'weekly' | 'biweekly'
  paid: boolean
  autopay: boolean
  profile_id: number
  created_at: string
}

interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  color: string
  tax_deductible?: boolean
}

export default function Bills() {
  const [bills, setBills] = createSignal<Bill[]>([])
  const [upcoming, setUpcoming] = createSignal<Bill[]>([])
  const [paid, setPaid] = createSignal<Bill[]>([])
  const [categories, setCategories] = createSignal<Category[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [showCategoryModal, setShowCategoryModal] = createSignal(false)
  const [formData, setFormData] = createSignal({
    name: '',
    amount: '',
    due_date: '',
    category: '',
    frequency: 'monthly' as Bill['frequency'],
    autopay: false,
  })
  const [categoryForm, setCategoryForm] = createSignal({
    name: '',
    type: 'expense' as 'expense' | 'income',
    color: '#6b7280',
  })

  // Load bills
  const loadBills = async () => {
    setLoading(true)
    try {
      const [allRes, upcomingRes, paidRes] = await Promise.all([
        apiGet<Bill[]>('/api/bills'),
        apiGet<Bill[]>('/api/bills/upcoming'),
        apiGet<Bill[]>('/api/bills?paid=true'),
      ])
      setBills(allRes)
      // Handle upcoming bills which have next_due_date instead of due_date
      setUpcoming(
        upcomingRes.map((b) => ({
          ...b,
          due_date: b.due_date || (b as any).next_due_date || '2026-05-01',
        }))
      )
      setPaid(paidRes)
    } catch (err) {
      console.error('Failed to load bills:', err)
      showToast('Failed to load bills', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Load categories
  const loadCategories = async () => {
    try {
      const data = await apiGet<Category[]>('/api/categories')
      setCategories(data.filter((c) => c.type === 'expense'))
    } catch (err) {
      console.error('Failed to load categories', err)
    }
  }

  // Add category
  const addCategory = async (e: Event) => {
    e.preventDefault()
    try {
      await apiPost('/api/categories', categoryForm())
      showToast('Category added', 'success')
      setCategoryForm({ name: '', type: 'expense', color: '#6b7280' })
      setShowCategoryModal(false)
      loadCategories()
    } catch (err) {
      console.error('Failed to add category', err)
      showToast('Failed to add category', 'error')
    }
  }

  // Delete category
  const _deleteCategory = async (_id: number) => {
    if (!confirm('Delete this category? Bills linked to this category will be unaffected.')) return
    try {
      await apiDelete(`/api/categories/${_id}`)
      showToast('Category deleted', 'success')
      loadCategories()
    } catch (err) {
      console.error('Failed to delete category', err)
      showToast('Failed to delete category', 'error')
    }
  }

  // Open category modal
  const openCategoryModal = () => {
    setShowCategoryModal(true)
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      amount: parseFloat(formData().amount),
      due_date: formData().due_date,
      category: formData().category || undefined,
      frequency: formData().frequency,
      autopay: formData().autopay,
    }

    try {
      await apiPost('/api/bills', data)
      showToast('Bill saved successfully', 'success')
      setShowAddModal(false)
      setFormData({ name: '', amount: '', due_date: '', category: '', frequency: 'monthly', autopay: false })
      loadBills()
    } catch (err) {
      console.error('Failed to save bill:', err)
      showToast('Failed to save bill', 'error')
    }
  }

  // Mark bill as paid
  const markPaid = async (id: number) => {
    try {
      await apiPost(`/api/bills/${id}/mark-paid`, {})
      showToast('Bill marked as paid', 'success')
      loadBills()
    } catch (err) {
      console.error('Failed to mark bill as paid:', err)
      showToast('Failed to mark bill as paid', 'error')
    }
  }

  // Delete bill
  const deleteBill = async (id: number) => {
    if (!confirm('Are you sure you want to delete this bill?')) return
    try {
      await apiDelete(`/api/bills/${id}`)
      showToast('Bill deleted successfully', 'success')
      loadBills()
    } catch (err) {
      console.error('Failed to delete bill:', err)
      showToast('Failed to delete bill', 'error')
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
    <div class={`page page-bills page-enter ${styles.billsPage}`}>
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
        <p class={styles.pageSubtitle} data-test-id="bills-subtitle">
          Track upcoming payments and never miss a due date
        </p>
      </div>

      {/* Upcoming Section */}
      {upcoming().length > 0 && (
        <div data-test-id="bills-upcoming-section" class={styles.billsSection}>
          <h2 class={styles.sectionTitle}>
            <span>🔔</span> Upcoming Bills
            <span class={styles.sectionSubtitle}>{upcoming().length} bills</span>
          </h2>
          <div data-test-id="bills-list" class={styles.billsList}>
            {upcoming().map((bill) => (
              <div
                data-test-id="bill-card"
                class={`${styles.billCard} ${isOverdue(bill.due_date) ? styles.overdue : ''}`}
              >
                <div class={styles.billMain}>
                  <div class={styles.billIcon}>{bill.autopay ? '🤖' : '📝'}</div>
                  <div class={styles.billInfo}>
                    <h3 class={styles.billName}>{bill.name}</h3>
                    <p class={styles.billDetails}>
                      {formatDate(bill.due_date)} • {daysUntil(bill.due_date)} •{' '}
                      {bill.frequency === 'monthly'
                        ? 'Monthly'
                        : bill.frequency === 'weekly'
                          ? 'Weekly'
                          : 'Biweekly'}
                    </p>
                  </div>
                </div>
                <div
                  class={`${styles.billAmount} ${isOverdue(bill.due_date) ? styles.overdue : ''}`}
                >
                  <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                  {!bill.paid && (
                    <button
                      data-test-id="mark-paid-btn"
                      class={`${styles.btnPrimary} ${styles.btnSm}`}
                      onClick={() => markPaid(bill.id)}
                    >
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
        <div data-test-id="bills-paid-section" class={styles.billsSection}>
          <h2 class={styles.sectionTitle}>
            <span>✅</span> Paid Bills
            <span class={styles.sectionSubtitle}>{paid().length} bills</span>
          </h2>
          <div data-test-id="bills-list" class={styles.billsList}>
            {paid().map((bill) => (
              <div data-test-id="bill-card" class={`${styles.billCard} ${styles.paid}`}>
                <div class={styles.billMain}>
                  <div class={styles.billIcon}>✅</div>
                  <div class={styles.billInfo}>
                    <h3 class={styles.billName}>{bill.name}</h3>
                    <p class={styles.billDetails}>Paid {formatDate(bill.due_date)}</p>
                  </div>
                </div>
                <div class={styles.billAmount}>
                  <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                  <button
                    class={`${styles.btnSm} ${styles.btnGhost}`}
                    onClick={() => deleteBill(bill.id)}
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Bills Section */}
      <div data-test-id="bills-all-section" class={styles.billsSection}>
        <h2 class={styles.sectionTitle}>
          <span>📋</span> All Bills
          <span class={styles.sectionSubtitle}>{bills().length} total</span>
        </h2>
        {loading() ? (
          <div data-test-id="bills-loading" class={styles.emptyState}>
            Loading bills...
          </div>
        ) : bills().length === 0 ? (
          <div data-test-id="bills-empty" class={styles.emptyState}>
            <p>No bills yet</p>
            <p>Add your first bill to start tracking your payments.</p>
            <button
              data-test-id="add-bill-btn-empty"
              class={styles.btnPrimary}
              onClick={() => setShowAddModal(true)}
            >
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
                      {formatDate(bill.due_date)} •{' '}
                      {bill.frequency === 'monthly'
                        ? 'Monthly'
                        : bill.frequency === 'weekly'
                          ? 'Weekly'
                          : 'Biweekly'}
                      {bill.category && ` • ${bill.category}`}
                    </p>
                  </div>
                </div>
                <div class={styles.billAmount}>
                  <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                  <div class={styles.billActions}>
                    {!bill.paid ? (
                      <button
                        data-test-id="mark-paid-btn"
                        class={`${styles.btnPrimary} ${styles.btnSm}`}
                        onClick={() => markPaid(bill.id)}
                      >
                        {isOverdue(bill.due_date) ? 'Mark as Paid (Overdue)' : 'Mark Paid'}
                      </button>
                    ) : (
                      <button
                        data-test-id="delete-bill-btn"
                        class={`${styles.btnSm} ${styles.btnGhost}`}
                        onClick={() => deleteBill(bill.id)}
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
        <div
          class={styles.modalOverlay}
          onclick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false)
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
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
                <label class={styles.formLabel}>Category</label>
                <select
                  class={styles.formControl}
                  value={formData().category}
                  oninput={(e) => setFormData({ ...formData(), category: e.target.value })}
                >
                  <option value="">No category</option>
                  {categories().map((cat) => (
                    <option value={cat.name}>{cat.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  class={styles.btnLink}
                  style={{ marginTop: 8 }}
                  onClick={openCategoryModal}
                >
                  + Add Category
                </button>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Frequency</label>
                <select
                  class={styles.formControl}
                  value={formData().frequency}
                  oninput={(e) =>
                    setFormData({ ...formData(), frequency: e.target.value as Bill['frequency'] })
                  }
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
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => setShowAddModal(false)}
                >
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

      {/* Add Category Modal */}
      {showCategoryModal() && (
        <div
          class={styles.modalOverlay}
          onclick={(e) => {
            if (e.target === e.currentTarget) setShowCategoryModal(false)
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>Add Category</h3>
              <button class={styles.modalClose} onClick={() => setShowCategoryModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={addCategory}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Category Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Utilities, Entertainment"
                  value={categoryForm().name}
                  oninput={(e) => setCategoryForm({ ...categoryForm(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Type</label>
                <select
                  class={styles.formControl}
                  value={categoryForm().type}
                  oninput={(e) =>
                    setCategoryForm({ ...categoryForm(), type: e.target.value as 'expense' | 'income' })
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Color</label>
                <input
                  type="color"
                  class={styles.colorInput}
                  value={categoryForm().color}
                  oninput={(e) => setCategoryForm({ ...categoryForm(), color: e.target.value })}
                />
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => setShowCategoryModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
                  Add Category
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
