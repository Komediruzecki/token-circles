/**
 * Bills Component - EARS Specification
 *
 * GIVEN: A user is viewing the Bills page
 * WHEN: The page loads
 * THEN: The header displays "Bills" and page subtitle "Track upcoming payments and never miss a due date"
 *
 * GIVEN: The user has unpaid bills
 * WHEN: The page displays bills
 * THEN: Bills are shown in the Upcoming Bills section with:
 *       - Bill name
 *       - Due date
 *       - Days until due (with special messages: "Due today", "Due tomorrow", "X days overdue", "Due in X days")
 *       - Amount in currency
 *       - Frequency (Monthly, Weekly, Biweekly)
 *       - Icon (regular or autopay badge)
 *       - Mark as Paid button
 *
 * GIVEN: The user has paid bills
 * WHEN: The page displays paid bills
 * THEN: Bills are shown in the Paid Bills section with:
 *       - Bill name
 *       - Due date
 *       - "Paid" status
 *       - Delete button
 *
 * GIVEN: The user has all bills
 * WHEN: The page displays all bills
 * THEN: All bills are shown in the All Bills section with the same details as unpaid bills,
 *       but without the Mark as Paid button (use Delete button instead for paid bills)
 *
 * GIVING: A new bill modal
 * WHEN: The user clicks "Add Bill" button
 * THEN: The modal opens with form fields:
 *       - Bill Name (required, text input)
 *       - Amount (required, number input)
 *       - Due Date (required, date input)
 *       - Category (select with existing expense categories)
 *       - + Add Category button
 *       - Frequency (select: Monthly, Weekly, Biweekly)
 *       - Autopay toggle
 *       - Cancel and Add Bill buttons in footer
 *
 * GIVING: A category modal
 * WHEN: The user clicks "+ Add Category"
 * THEN: The modal opens with form fields:
 *       - Category Name (required)
 *       - Type (select: Expense, Income)
 *       - Color (color picker)
 *       - Cancel and Add buttons
 *
 * ENSURING: Data integrity
 * WHEN: A bill is marked as paid
 * THEN: The bill is moved from upcoming/paid lists to paid list
 * WHEN: A bill is deleted
 * THEN: The bill is removed from all lists with confirmation
 */

import { createEffect, createMemo, createSignal, For, onMount } from 'solid-js'
import ConfirmButton from '../components/ConfirmButton'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import styles from './BillsPage.module.css'

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
  type?: 'bill' | 'subscription'
}

interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  color: string
  tax_deductible?: boolean
}

export default function Bills() {
  const state = useAppState()
  const [bills, setBills] = createSignal<Bill[]>([])
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
    type: 'bill' as 'bill' | 'subscription',
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
      const allRes = await apiGet<Bill[]>('/api/bills')
      setBills(allRes)
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

  // Tab state: 'all' | 'subscriptions'
  const [billTab, setBillTab] = createSignal<'all' | 'subscriptions'>('all')

  // Memoized filtered lists
  const subscriptions = createMemo(() =>
    bills().filter((b: any) => (b.type || 'bill') === 'subscription')
  )
  const activeSubscriptions = createMemo(() =>
    subscriptions().filter((b: any) => b.is_active !== 0)
  )
  const totalMonthlySubs = createMemo(() =>
    activeSubscriptions().reduce((sum, b) => sum + b.amount, 0)
  )
  const unpaidBills = createMemo(() =>
    bills().filter((b: any) => !b.paid && (b.type || 'bill') !== 'subscription')
  )
  const paidBills = createMemo(() =>
    bills().filter((b: any) => b.paid && (b.type || 'bill') !== 'subscription')
  )

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
      type: formData().type,
    }

    try {
      await apiPost('/api/bills', data)
      showToast('Bill saved successfully', 'success')
      setShowAddModal(false)
      setFormData({
        name: '',
        amount: '',
        due_date: '',
        category: '',
        frequency: 'monthly',
        autopay: false,
        type: 'bill',
      })
      loadBills()
    } catch (err) {
      console.error('Failed to save bill:', err)
      showToast('Failed to save bill', 'error')
    }
  }

  const [markingPaid, setMarkingPaid] = createSignal<Set<number>>(new Set())

  // Mark bill as paid
  const markPaid = async (id: number) => {
    // Optimistic update: mark as paid locally immediately
    setBills(bills().map((b) => (b.id === id ? { ...b, paid: true } : b)))
    setMarkingPaid(new Set([...markingPaid(), id]))

    try {
      await apiPost(`/api/bills/${id}/mark-paid`, {})
      showToast('Bill marked as paid', 'success')
      // Reload to get fresh data from server
      await loadBills()
    } catch (err) {
      console.error('Failed to mark bill as paid:', err)
      showToast('Failed to mark bill as paid', 'error')
      // Revert optimistic update on failure
      await loadBills()
    } finally {
      const next = new Set(markingPaid())
      next.delete(id)
      setMarkingPaid(next)
    }
  }

  // Delete bill
  const deleteBill = async (id: number) => {
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
    loadCategories()
  })

  createEffect(() => {
    void state.profileVersion
    loadBills()
    loadCategories()
  })

  return (
    <div class={`${styles.billsPage} page page-bills page-enter`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="bills-header">Bills</h1>
          <button
            data-test-id="add-bill-btn"
            class={styles.btnPrimary}
            onClick={() => {
              setFormData({
                ...formData(),
                type: billTab() === 'subscriptions' ? 'subscription' : 'bill',
              })
              setShowAddModal(true)
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {billTab() === 'subscriptions' ? 'Add Subscription' : 'Add Bill'}
          </button>
        </div>
        <p data-test-id="bills-subtitle" class={styles.pageSubtitle}>
          Track upcoming payments and never miss a due date
        </p>
      </div>

      {/* Tab navigation */}
      <div class={styles.tabs}>
        <button
          class={`${styles.tabBtn} ${billTab() === 'all' ? styles.tabActive : ''}`}
          onClick={() => setBillTab('all')}
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Regular Bills
        </button>
        <button
          class={`${styles.tabBtn} ${billTab() === 'subscriptions' ? styles.tabActive : ''}`}
          onClick={() => setBillTab('subscriptions')}
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          Subscriptions
          {activeSubscriptions().length > 0 && (
            <span class={styles.tabBadge}>{activeSubscriptions().length}</span>
          )}
        </button>
      </div>

      {loading() ? (
        <div data-test-id="loading-state" class={styles.emptyState}>
          Loading bills...
        </div>
      ) : billTab() === 'subscriptions' ? (
        <div class={styles.billsGrid}>
          {/* Subscription Summary Card */}
          <div class={styles.subscriptionSummary}>
            <div class={styles.subSummaryRow}>
              <div class={styles.subSummaryCard}>
                <span class={styles.subSummaryLabel}>Active Subs</span>
                <span class={styles.subSummaryValue}>{activeSubscriptions().length}</span>
              </div>
              <div class={styles.subSummaryCard}>
                <span class={styles.subSummaryLabel}>Monthly Total</span>
                <span class={styles.subSummaryValue}>{formatCurrency(totalMonthlySubs())}</span>
              </div>
            </div>
          </div>

          {/* Active Subscriptions */}
          {activeSubscriptions().length > 0 && (
            <div data-test-id="active-subscriptions-section" class={styles.billsSection}>
              <h2 class={styles.sectionTitle}>
                Active Subscriptions{' '}
                <span class={styles.sectionSubtitle}>{activeSubscriptions().length} active</span>
              </h2>
              <div class={styles.billsList}>
                <For each={activeSubscriptions()}>
                  {(sub) => (
                    <div
                      class={`${styles.billCard} ${styles.subscriptionCard} ${sub.paid ? styles.paid : ''}`}
                    >
                      <div class={styles.billMain}>
                        <div class={styles.billIcon}>
                          <svg
                            width="18"
                            height="18"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                        </div>
                        <div class={styles.billInfo}>
                          <h3 class={styles.billName}>{sub.name}</h3>
                          <p class={styles.billDetails}>
                            {formatDate(sub.due_date)} •{' '}
                            {sub.frequency === 'monthly'
                              ? 'Monthly'
                              : sub.frequency === 'weekly'
                                ? 'Weekly'
                                : 'Biweekly'}
                            {sub.category && ` • ${sub.category}`}
                          </p>
                        </div>
                      </div>
                      <div class={styles.billAmount}>
                        <div class={styles.amountValue}>{formatCurrency(sub.amount)}</div>
                        <div class={styles.billActions}>
                          <button
                            class={`${styles.btnPrimary} ${styles.btnSm}`}
                            onClick={() => markPaid(sub.id)}
                            disabled={markingPaid().has(sub.id)}
                          >
                            {markingPaid().has(sub.id) ? 'Paying...' : 'Mark Paid'}
                          </button>
                          <button
                            class={`${styles.btnGhost} ${styles.btnSm}`}
                            title="Pause subscription"
                            onClick={async () => {
                              await apiPut(`/api/bills/${sub.id}`, {
                                ...sub,
                                is_active: 0,
                                type: sub.type,
                              })
                              await loadBills()
                            }}
                          >
                            <svg
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <ConfirmButton
                            class={`${styles.btnSm} ${styles.btnGhost}`}
                            onConfirm={() => deleteBill(sub.id)}
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
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}

          {/* Paused Subscriptions */}
          {subscriptions().filter((s: any) => s.is_active === 0).length > 0 && (
            <div class={styles.billsSection}>
              <h2 class={styles.sectionTitle}>
                Paused{' '}
                <span class={styles.sectionSubtitle}>
                  {subscriptions().filter((s: any) => s.is_active === 0).length} paused
                </span>
              </h2>
              <div class={styles.billsList}>
                <For each={subscriptions().filter((s: any) => s.is_active === 0)}>
                  {(sub) => (
                    <div class={`${styles.billCard} ${styles.paused}`}>
                      <div class={styles.billMain}>
                        <div class={styles.billIcon}>
                          <svg
                            width="18"
                            height="18"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div class={styles.billInfo}>
                          <h3 class={styles.billName}>{sub.name}</h3>
                          <p class={styles.billDetails}>
                            {formatDate(sub.due_date)} • {formatCurrency(sub.amount)}/
                            {sub.frequency === 'monthly'
                              ? 'mo'
                              : sub.frequency === 'weekly'
                                ? 'wk'
                                : 'biwk'}
                          </p>
                        </div>
                      </div>
                      <div class={styles.billAmount}>
                        <button
                          class={`${styles.btnPrimary} ${styles.btnSm}`}
                          onClick={async () => {
                            await apiPut(`/api/bills/${sub.id}`, {
                              ...sub,
                              is_active: 1,
                              type: sub.type,
                            })
                            await loadBills()
                          }}
                        >
                          Resume
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}

          {subscriptions().length === 0 && (
            <div class={styles.emptyState}>
              <p>No subscriptions yet</p>
              <p>Add streaming services, software subscriptions, and other recurring services.</p>
              <button
                class={styles.btnPrimary}
                onClick={() => {
                  setFormData({
                    name: '',
                    amount: '',
                    due_date: '',
                    category: '',
                    frequency: 'monthly',
                    autopay: false,
                    type: 'subscription',
                  })
                  setShowAddModal(true)
                }}
              >
                Add Subscription
              </button>
            </div>
          )}
        </div>
      ) : bills().length === 0 ? (
        <div data-test-id="bills-empty" class={styles.emptyState}>
          <p>No bills yet</p>
          <p>Add your first bill to start tracking your payments.</p>
          <button
            data-test-id="bills-add-btn-empty"
            class={styles.btnPrimary}
            onClick={() => {
              setFormData({ ...formData(), type: 'bill' })
              setShowAddModal(true)
            }}
          >
            Add Bill
          </button>
        </div>
      ) : (
        <div class={styles.billsGrid}>
          {/* Unpaid Bills Section */}
          {unpaidBills().length > 0 && (
            <div data-test-id="bills-upcoming-section" class={styles.billsSection}>
              <h2 class={styles.sectionTitle}>
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
                </svg>{' '}
                Unpaid Bills
                <span class={styles.sectionSubtitle}>{unpaidBills().length} bills</span>
              </h2>
              <div data-test-id="bills-list" class={styles.billsList}>
                <For each={unpaidBills()}>
                  {(bill) => (
                    <div
                      data-test-id="bill-card"
                      class={`${styles.billCard} ${isOverdue(bill.due_date) ? styles.overdue : ''}`}
                    >
                      <div class={styles.billMain}>
                        <div data-test-id="bill-icon" class={styles.billIcon}>
                          {bill.autopay ? (
                            <svg
                              width="18"
                              height="18"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          ) : (
                            <svg
                              width="18"
                              height="18"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div class={styles.billInfo}>
                          <h3 data-test-id="bill-name" class={styles.billName}>
                            {bill.name}
                          </h3>
                          <p data-test-id="bill-details" class={styles.billDetails}>
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
                        data-test-id="bill-amount-container"
                        class={`${styles.billAmount} ${isOverdue(bill.due_date) ? styles.overdue : ''}`}
                      >
                        <div class={styles.amountValue}>{formatCurrency(bill.amount)}</div>
                        <button
                          data-test-id="bill-mark-paid-btn"
                          class={`${styles.btnPrimary} ${styles.btnSm}`}
                          onClick={() => markPaid(bill.id)}
                          disabled={markingPaid().has(bill.id)}
                        >
                          {markingPaid().has(bill.id) ? 'Paying...' : 'Mark Paid'}
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}

          {/* Paid Bills Section */}
          {paidBills().length > 0 && (
            <div data-test-id="bills-paid-section" class={styles.billsSection}>
              <h2 class={styles.sectionTitle}>
                <span>
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </span>{' '}
                Paid Bills
                <span class={styles.sectionSubtitle}>{paidBills().length} paid</span>
              </h2>
              <div class={styles.billsList}>
                <For each={paidBills()}>
                  {(bill) => (
                    <div
                      class={`${styles.billCard} ${bill.paid ? styles.paid : ''} ${isOverdue(bill.due_date) && !bill.paid ? styles.overdue : ''}`}
                    >
                      <div class={styles.billMain}>
                        <div data-test-id="bill-icon" class={styles.billIcon}>
                          {bill.autopay ? (
                            <svg
                              width="18"
                              height="18"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          ) : (
                            <svg
                              width="18"
                              height="18"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div class={styles.billInfo}>
                          <h3 data-test-id="bill-name" class={styles.billName}>
                            {bill.name}
                            {bill.paid && <span class={styles.paidBadge}>Paid</span>}
                          </h3>
                          <p data-test-id="bill-details" class={styles.billDetails}>
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
                              data-test-id="bill-mark-paid-btn"
                              class={`${styles.btnPrimary} ${styles.btnSm}`}
                              onClick={() => markPaid(bill.id)}
                              disabled={markingPaid().has(bill.id)}
                            >
                              {markingPaid().has(bill.id)
                                ? 'Paying...'
                                : isOverdue(bill.due_date)
                                  ? 'Mark as Paid (Overdue)'
                                  : 'Mark Paid'}
                            </button>
                          ) : (
                            <ConfirmButton
                              class={`${styles.btnSm} ${styles.btnGhost}`}
                              onConfirm={() => deleteBill(bill.id)}
                              label={
                                <svg
                                  width="16"
                                  height="16"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              }
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </div>
      )}

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
                  autofocus
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
                  <For each={categories()}>
                    {(cat) => <option value={cat.name}>{cat.name}</option>}
                  </For>
                </select>
                <button
                  type="button"
                  class={styles.btnLink}
                  style={{ 'margin-top': '8px' }}
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
                <label class={styles.formLabel}>Type</label>
                <select
                  class={styles.formControl}
                  value={formData().type}
                  oninput={(e) =>
                    setFormData({ ...formData(), type: e.target.value as 'bill' | 'subscription' })
                  }
                >
                  <option value="bill">Regular Bill</option>
                  <option value="subscription">Subscription</option>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>
                  <span>
                    <svg
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>{' '}
                    Autopay
                  </span>
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
                  autofocus
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Type</label>
                <select
                  class={styles.formControl}
                  value={categoryForm().type}
                  oninput={(e) =>
                    setCategoryForm({
                      ...categoryForm(),
                      type: e.target.value as 'expense' | 'income',
                    })
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
