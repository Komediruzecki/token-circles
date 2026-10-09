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

import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import ConfirmButton from '../components/ConfirmButton'
import { Field, FormNotice, SubmitButton } from '../components/form'
import OrbitalAccent from '../components/OrbitalAccent'
import OrbitalDivider from '../components/OrbitalDivider'
import SubscriptionCard from '../components/SubscriptionCard'
import SubscriptionCatalogModal from '../components/SubscriptionCatalogModal'
import { SubscriptionScanModal } from '../components/SubscriptionScan'
import ToggleField from '../components/ToggleField'
import { formatCurrency } from '../core/api'
import { apiDelete, apiHouseholdGet, apiPost, apiPut, errorStatus, showToast } from '../core/api'
import { plainMessage } from '../core/apiError'
import { useAppState } from '../core/appStore'
import { entityVersion } from '../core/dataVersions'
import { gatedSource } from '../core/pageVisibility'
import { monthlyEquivalent } from '../core/subscriptionMath'
import BillCalendar from './BillCalendar'
import { daysToDue, dueDateLabel, dueInWords, nextDue } from './billDue'
import { createBillForm } from './billForm'
import styles from './BillsPage.module.css'
import { createCategoryForm } from './categoryForm'
import { filterSubscriptions, subscriptionGroupCounts } from './subscriptionFilters'
import type { SubscriptionCardBill } from '../components/SubscriptionCard'
import type { BillKind } from './billForm'
import type { CategoryFormValues } from './categoryForm'
import type { SubscriptionFilter } from './subscriptionFilters'

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  yearly: 'Yearly',
}
const frequencyLabel = (frequency: string) => FREQUENCY_LABELS[frequency] ?? 'Monthly'

interface Bill {
  id: number
  name: string
  amount: number
  due_date: string
  /** When it falls due next (features/billDue.ts): the date the cards show. */
  next_due_date?: string | null
  category_id?: number | null
  category_name?: string
  category_color?: string
  account_id?: number
  frequency: 'monthly' | 'weekly' | 'biweekly' | 'yearly'
  paid: boolean
  autopay: boolean
  profile_id: number
  created_at: string
  type?: 'bill' | 'subscription'
  is_active?: number
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

  // Bills resource — fetches bills + expense categories
  const [billsResource, { refetch: refetchBills, mutate: mutateBills }] = createResource(
    // Gated on visibility: a profile switch refetches now only while this page is
    // visible; hidden, it is marked stale and refetches once on the next show. The
    // categories counter is tracked too, so a category created on any other surface
    // reaches this page's picker without a browser reload, and so is the bills counter:
    // a bill written anywhere, this page included, reloads the list through it. That is
    // why no write on this page refetches by hand.
    gatedSource('bills', () =>
      [state.profileVersion, entityVersion('categories'), entityVersion('bills')].join('|')
    ),
    async () => {
      const [allRes, categoryRes] = await Promise.all([
        apiHouseholdGet<Bill[]>('/api/bills'),
        apiHouseholdGet<Category[]>('/api/categories'),
      ])
      return {
        bills: allRes,
        categories: categoryRes.filter((c) => c.type === 'expense'),
      }
    }
  )
  // `.latest` keeps the previous value during a refetch and never re-triggers the page-level
  // <Suspense>, so period/profile changes update in place instead of flashing the fallback.
  const initialLoad = () => billsResource.loading && !billsResource.latest
  const bills = () => billsResource.latest?.bills ?? []
  const categories = () => billsResource.latest?.categories ?? []
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [showCatalog, setShowCatalog] = createSignal(false)
  const [showScan, setShowScan] = createSignal(false)
  const [showCategoryModal, setShowCategoryModal] = createSignal(false)
  // The bill the dialog edits, or null for a new one: its title and its button say which.
  const [editingBill, setEditingBill] = createSignal<Bill | null>(null)
  const closeBillModal = () => {
    setShowAddModal(false)
    setEditingBill(null)
  }
  // The dialog's values, field errors and notice (components/form), and its save
  // (features/billForm.ts). A refused save is said in the dialog, under the field it is about.
  const billForm = createBillForm({ onSaved: closeBillModal })
  const openAddModal = (kind: BillKind) => {
    setEditingBill(null)
    billForm.open(null, kind)
    setShowAddModal(true)
  }
  // The dialog's categories: this page's expense categories, and the bill's own when it is not one
  // of them (an income category set elsewhere), so that saving an edit does not clear it unseen.
  const categoryOptions = createMemo(() => {
    const list = categories()
    const bill = editingBill()
    const id = bill?.category_id
    if (!id || list.some((c) => c.id === id)) return list
    return [...list, { id, name: bill?.category_name ?? "This bill's category" }]
  })
  // The "+ Add Category" dialog over the bill form. What a save does, and what it says when the
  // save is refused, is categoryForm.ts, shared with Categories, Budgets and Goals. No refetch
  // after a save: the POST bumped the categories counter, which this page's resource tracks.
  const categoryForm = createCategoryForm({
    color: '#7182a8',
    onSaved: () => setShowCategoryModal(false),
  })

  // Tab state: 'all' | 'subscriptions' | 'calendar'
  const [billTab, setBillTab] = createSignal<'all' | 'subscriptions' | 'calendar'>('all')

  // Memoized filtered lists
  const subscriptions = createMemo(() =>
    bills().filter((b) => (b.type || 'bill') === 'subscription')
  )
  const activeSubscriptions = createMemo(() => subscriptions().filter((b) => b.is_active !== 0))
  // Monthly total: normalize each subscription's price to its monthly equivalent
  // (yearly / 12, weekly * 52/12, ...) — summing raw amounts would count an annual
  // plan's full-year price as a monthly cost.
  const totalMonthlySubs = createMemo(() =>
    activeSubscriptions().reduce((sum, b) => sum + monthlyEquivalent(b.amount, b.frequency), 0)
  )

  // Filter pills above the gallery: All (default) · one per category · Paused.
  const [subFilter, setSubFilter] = createSignal<SubscriptionFilter>('all')
  const subGroupPills = createMemo(() => subscriptionGroupCounts(subscriptions()))
  const pausedSubscriptions = createMemo(() => subscriptions().filter((b) => b.is_active === 0))
  const visibleSubscriptions = createMemo(() => {
    const filter = subFilter()
    // A stale selection (last card of a category deleted, last paused sub resumed) falls
    // back to All instead of showing an inexplicable empty gallery.
    const gone =
      typeof filter === 'object'
        ? !subGroupPills().some((g) => g.label === filter.category)
        : filter === 'paused' && pausedSubscriptions().length === 0
    return filterSubscriptions(subscriptions(), gone ? 'all' : filter) as Bill[]
  })

  // One toggle for the card menu's Pause/Resume: pauses an active sub, resumes a paused one.
  const togglePause = async (id: number) => {
    const sub = bills().find((b) => b.id === id)
    if (!sub) return
    const next = sub.is_active === 0 ? 1 : 0
    try {
      // Send ONLY the mutation. Echoing the whole GET row back (the old `{ ...sub }`) failed
      // serverless validation on seeded rows (`recurring: 1` vs the boolean schema) and
      // re-submitted computed fields (`paid`, category joins) the update never meant to touch.
      // Both backends treat PUT as partial: the worker falls back `?? existing` per field.
      await apiPut(`/api/bills/${id}`, { is_active: next })
    } catch (err) {
      showToast(
        plainMessage(
          err,
          next === 0
            ? "Couldn't pause the subscription. Try again."
            : "Couldn't resume the subscription. Try again."
        ),
        'error'
      )
    }
  }
  const unpaidBills = createMemo(() =>
    bills().filter((b) => !b.paid && (b.type || 'bill') !== 'subscription')
  )
  const paidBills = createMemo(() =>
    bills().filter((b) => b.paid && (b.type || 'bill') !== 'subscription')
  )

  // Open category modal
  const openCategoryModal = () => {
    categoryForm.open()
    setShowCategoryModal(true)
  }

  // Open the dialog on a bill, from its card or a subscription card's menu.
  const openEditModal = (idOrBill: number | Bill) => {
    const bill = typeof idOrBill === 'number' ? bills().find((b) => b.id === idOrBill) : idOrBill
    if (!bill) return
    setEditingBill(bill)
    billForm.open(bill)
    setShowAddModal(true)
  }

  const [markingPaid, setMarkingPaid] = createSignal<Set<number>>(new Set())

  // Mark bill as paid
  const markPaid = async (id: number) => {
    // Optimistic update: mark as paid locally immediately
    mutateBills((prev) =>
      prev
        ? { ...prev, bills: prev.bills.map((b) => (b.id === id ? { ...b, paid: true } : b)) }
        : prev
    )
    setMarkingPaid(new Set([...markingPaid(), id]))

    try {
      await apiPost(`/api/bills/${id}/mark-paid`, {})
      showToast('Bill marked as paid', 'success')
    } catch (err) {
      console.error('Failed to mark bill as paid:', err)
      showToast(plainMessage(err, "Couldn't mark the bill paid. Try again."), 'error')
      // Revert the optimistic update. A failed write bumps no counter, so this is the one
      // refetch on this page that has to be asked for.
      await refetchBills()
    } finally {
      const next = new Set(markingPaid())
      next.delete(id)
      setMarkingPaid(next)
    }
  }

  // Delete bill. One deleted in another tab or on another device first answers 404: gone is what
  // was asked, so the page says so and drops the card. A failed write bumps no counter, so this
  // refetch has to be asked for.
  const deleteBill = async (id: number) => {
    try {
      await apiDelete(`/api/bills/${id}`)
      showToast('Bill deleted successfully', 'success')
    } catch (err) {
      if (errorStatus(err) === 404) {
        showToast('That bill was already deleted.', 'info')
        await refetchBills()
        return
      }
      console.error('Failed to delete bill:', err)
      showToast(plainMessage(err, "Couldn't delete the bill. Try again."), 'error')
    }
  }

  /** Unpaid, and its day has passed. */
  const isOverdue = (bill: Bill): boolean => !bill.paid && daysToDue(bill) < 0

  return (
    <div class={`${styles.billsPage} page page-bills page-enter`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="bills-header" data-tour="bills-header">
            Bills
          </h1>
          <div class={styles.headerActions}>
            <Show when={billTab() === 'subscriptions'}>
              <button
                data-test-id="scan-subscriptions-btn"
                class={styles.btnSecondary}
                onClick={() => setShowScan(true)}
              >
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 12L18 6" stroke-linecap="round" />
                  <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
                </svg>
                Scan transactions
              </button>
              <button
                data-test-id="browse-catalog-btn"
                class={styles.btnSecondary}
                onClick={() => setShowCatalog(true)}
              >
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
                Browse catalog
              </button>
            </Show>
            <button
              data-test-id="add-bill-btn"
              data-tour="bills-add"
              class={styles.btnPrimary}
              onClick={() => {
                openAddModal(billTab() === 'subscriptions' ? 'subscription' : 'bill')
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              {billTab() === 'subscriptions' ? 'Add Subscription' : 'Add Bill'}
            </button>
          </div>
        </div>
        <p data-test-id="bills-subtitle" class={styles.pageSubtitle}>
          Track upcoming payments and never miss a due date
        </p>
      </div>

      {/* Tab navigation */}
      <div class={styles.tabs} data-tour="bills-tabs">
        <button
          class={`${styles.tabBtn} ${billTab() === 'all' ? styles.tabActive : ''}`}
          data-test-id="bills-tab-all"
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
          data-test-id="bills-tab-subscriptions"
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
        <button
          class={`${styles.tabBtn} ${billTab() === 'calendar' ? styles.tabActive : ''}`}
          onClick={() => setBillTab('calendar')}
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Calendar
        </button>
      </div>

      {initialLoad() && bills().length === 0 ? (
        <div data-test-id="loading-state" class={styles.emptyState}>
          Loading bills...
        </div>
      ) : billTab() === 'calendar' ? (
        <BillCalendar />
      ) : billTab() === 'subscriptions' ? (
        <div class={styles.subscriptionView}>
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
              <div class={styles.subSummaryCard}>
                <span class={styles.subSummaryLabel}>Categories</span>
                <span class={styles.subSummaryValue}>{subGroupPills().length}</span>
              </div>
            </div>
          </div>

          {/* Filter pills + one flat gallery, instead of per-category sections */}
          {subscriptions().length > 0 && (
            <>
              <div class={styles.subFilterRow} data-test-id="sub-filter-row">
                <button
                  class={`${styles.filterPill} ${subFilter() === 'all' ? styles.filterPillActive : ''}`}
                  type="button"
                  aria-pressed={subFilter() === 'all'}
                  onClick={() => setSubFilter('all')}
                >
                  All
                  <span class={styles.filterPillCount}>{activeSubscriptions().length}</span>
                </button>
                <For each={subGroupPills()}>
                  {(group) => {
                    const active = () => {
                      const f = subFilter()
                      return typeof f === 'object' && f.category === group.label
                    }
                    return (
                      <button
                        class={`${styles.filterPill} ${active() ? styles.filterPillActive : ''}`}
                        type="button"
                        aria-pressed={active()}
                        onClick={() => setSubFilter({ category: group.label })}
                      >
                        {group.label}
                        <span class={styles.filterPillCount}>{group.count}</span>
                      </button>
                    )
                  }}
                </For>
                <Show when={pausedSubscriptions().length > 0}>
                  <button
                    class={`${styles.filterPill} ${subFilter() === 'paused' ? styles.filterPillActive : ''}`}
                    type="button"
                    aria-pressed={subFilter() === 'paused'}
                    onClick={() => setSubFilter('paused')}
                  >
                    Paused
                    <span class={styles.filterPillCount}>{pausedSubscriptions().length}</span>
                  </button>
                </Show>
              </div>

              <div class={styles.subscriptionGallery}>
                <For each={visibleSubscriptions()}>
                  {(sub) => (
                    <SubscriptionCard
                      subscription={sub as SubscriptionCardBill}
                      onMarkPaid={markPaid}
                      onPause={togglePause}
                      onDelete={deleteBill}
                      onEdit={openEditModal}
                      markingPaid={markingPaid}
                    />
                  )}
                </For>
              </div>
            </>
          )}

          {subscriptions().length === 0 && (
            <div class={styles.emptyState}>
              <p>No subscriptions yet</p>
              <p>Add streaming services, software subscriptions, and other recurring services.</p>
              <button
                class={styles.btnPrimary}
                onClick={() => {
                  openAddModal('subscription')
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
              openAddModal('bill')
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
              <OrbitalDivider
                id="bills-sec-unpaid"
                label="Unpaid Bills"
                meta={`${unpaidBills().length} bills`}
              />
              <div data-test-id="bills-list" class={styles.billsList}>
                <For each={unpaidBills()}>
                  {(bill) => (
                    <div
                      data-test-id="bill-card"
                      class={`${styles.billCard} ${isOverdue(bill) ? styles.overdue : ''}`}
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
                            <span data-test-id="bill-due-date">{dueDateLabel(nextDue(bill))}</span>{' '}
                            • {dueInWords(daysToDue(bill))} •{' '}
                            <span data-test-id="bill-frequency">
                              {frequencyLabel(bill.frequency)}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div
                        data-test-id="bill-amount-container"
                        class={`${styles.billAmount} ${isOverdue(bill) ? styles.overdue : ''}`}
                      >
                        <div data-test-id="bill-amount" class={styles.amountValue}>
                          {formatCurrency(bill.amount)}
                        </div>
                        <div class={styles.billActions}>
                          <button
                            data-test-id="bill-mark-paid-btn"
                            class={`${styles.btnPrimary} ${styles.btnSm}`}
                            onClick={() => markPaid(bill.id)}
                            disabled={markingPaid().has(bill.id)}
                          >
                            {markingPaid().has(bill.id) ? 'Paying...' : 'Mark Paid'}
                          </button>
                          <button
                            data-test-id="bill-edit-btn"
                            class={`${styles.btnGhost} ${styles.btnSm}`}
                            onClick={() => {
                              openEditModal(bill)
                            }}
                            title="Edit bill"
                          >
                            Edit
                          </button>
                        </div>
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
              <OrbitalDivider
                id="bills-sec-paid"
                label="Paid Bills"
                meta={`${paidBills().length} paid`}
              />
              <div class={styles.billsList}>
                <For each={paidBills()}>
                  {(bill) => (
                    <div
                      class={`${styles.billCard} ${bill.paid ? styles.paid : ''} ${isOverdue(bill) ? styles.overdue : ''}`}
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
                            {bill.paid && (
                              <span data-test-id="bill-status" class={styles.paidBadge}>
                                Paid
                              </span>
                            )}
                          </h3>
                          <p data-test-id="bill-details" class={styles.billDetails}>
                            <span data-test-id="bill-due-date">
                              Next due {dueDateLabel(nextDue(bill))}
                            </span>{' '}
                            •{' '}
                            <span data-test-id="bill-frequency">
                              {frequencyLabel(bill.frequency)}
                            </span>
                            {bill.category_name && ` • ${bill.category_name}`}
                          </p>
                        </div>
                      </div>
                      <div class={styles.billAmount}>
                        <div data-test-id="bill-amount" class={styles.amountValue}>
                          {formatCurrency(bill.amount)}
                        </div>
                        <div class={styles.billActions}>
                          <button
                            data-test-id="bill-edit-btn"
                            class={`${styles.btnGhost} ${styles.btnSm}`}
                            onClick={() => {
                              openEditModal(bill)
                            }}
                            title="Edit bill"
                          >
                            Edit
                          </button>
                          {!bill.paid ? (
                            <button
                              data-test-id="bill-mark-paid-btn"
                              class={`${styles.btnPrimary} ${styles.btnSm}`}
                              onClick={() => markPaid(bill.id)}
                              disabled={markingPaid().has(bill.id)}
                            >
                              {markingPaid().has(bill.id)
                                ? 'Paying...'
                                : isOverdue(bill)
                                  ? 'Mark as Paid (Overdue)'
                                  : 'Mark Paid'}
                            </button>
                          ) : (
                            <span data-test-id="bill-delete-btn">
                              <ConfirmButton
                                class={`${styles.btnSm} ${styles.btnGhost}`}
                                onConfirm={() => deleteBill(bill.id)}
                                message="Delete this bill? This can’t be undone."
                                aria-label="Delete bill"
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
                            </span>
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
            if (e.target === e.currentTarget) closeBillModal()
          }}
        >
          <div
            class={styles.modal}
            data-test-id="bill-modal"
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle} data-test-id="bill-modal-title">
                {editingBill() ? 'Edit' : 'Add'}{' '}
                {billForm.values.type === 'subscription' ? 'Subscription' : 'Bill'}
              </h3>
              <OrbitalAccent />
              <button class={styles.modalClose} onClick={closeBillModal}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} {...billForm.attrs}>
              <FormNotice form={billForm} testId="bill-form-notice" />
              <Field
                form={billForm}
                name="name"
                label="Bill Name"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    class={styles.formControl}
                    data-test-id="bill-form-name"
                    placeholder="e.g., Rent, Electricity, Internet"
                    value={billForm.values.name}
                    onInput={(e) => billForm.set('name', e.currentTarget.value)}
                    autofocus
                    required
                  />
                )}
              </Field>
              <Field
                form={billForm}
                name="amount"
                label="Amount"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    inputmode="decimal"
                    class={styles.formControl}
                    data-test-id="bill-form-amount"
                    placeholder="500.00"
                    value={billForm.values.amount}
                    onInput={(e) => billForm.set('amount', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={billForm}
                name="due_date"
                label="Due Date"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="date"
                    class={styles.formControl}
                    data-test-id="bill-form-date"
                    value={billForm.values.due_date}
                    onInput={(e) => billForm.set('due_date', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={billForm}
                name="category_id"
                label="Category"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <>
                    <select
                      {...control}
                      class={styles.formControl}
                      data-test-id="bill-form-category"
                      value={billForm.values.category_id}
                      onInput={(e) => billForm.set('category_id', e.currentTarget.value)}
                    >
                      <option value="">No category</option>
                      <For each={categoryOptions()}>
                        {(cat) => (
                          <option
                            value={String(cat.id)}
                            selected={String(cat.id) === billForm.values.category_id}
                          >
                            {cat.name}
                          </option>
                        )}
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
                  </>
                )}
              </Field>
              <Field
                form={billForm}
                name="frequency"
                label="Frequency"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <select
                    {...control}
                    class={styles.formControl}
                    data-test-id="bill-form-frequency"
                    value={billForm.values.frequency}
                    onInput={(e) => billForm.set('frequency', e.currentTarget.value)}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                )}
              </Field>
              <Field
                form={billForm}
                name="type"
                label="Type"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <select
                    {...control}
                    class={styles.formControl}
                    data-test-id="bill-form-type"
                    value={billForm.values.type}
                    onInput={(e) => billForm.set('type', e.currentTarget.value as BillKind)}
                  >
                    <option value="bill">Regular Bill</option>
                    <option value="subscription">Subscription</option>
                  </select>
                )}
              </Field>
              <div class={styles.formGroup}>
                <ToggleField
                  title="Autopay"
                  description="Indicate that this bill is handled automatically."
                  checked={() => billForm.values.autopay}
                  onChange={(v) => billForm.set('autopay', v)}
                />
              </div>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={closeBillModal}>
                  Cancel
                </button>
                <SubmitButton
                  class={styles.btnPrimary}
                  data-test-id="bill-form-submit"
                  busy={billForm.submitting()}
                  busyLabel={editingBill() ? 'Saving…' : 'Adding…'}
                >
                  {editingBill() ? 'Update' : 'Add'}{' '}
                  {billForm.values.type === 'subscription' ? 'Subscription' : 'Bill'}
                </SubmitButton>
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
            <form class={styles.modalBody} {...categoryForm.attrs}>
              <FormNotice form={categoryForm} />
              <Field
                form={categoryForm}
                name="name"
                label="Category Name"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    class={styles.formControl}
                    placeholder="e.g., Utilities, Entertainment"
                    value={categoryForm.values.name}
                    onInput={(e) => categoryForm.set('name', e.currentTarget.value)}
                    autofocus
                    required
                  />
                )}
              </Field>
              <Field
                form={categoryForm}
                name="type"
                label="Type"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <select
                    {...control}
                    class={styles.formControl}
                    value={categoryForm.values.type}
                    onInput={(e) =>
                      categoryForm.set('type', e.currentTarget.value as CategoryFormValues['type'])
                    }
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                )}
              </Field>
              <Field
                form={categoryForm}
                name="color"
                label="Color"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="color"
                    class={styles.colorInput}
                    value={categoryForm.values.color}
                    onInput={(e) => categoryForm.set('color', e.currentTarget.value)}
                  />
                )}
              </Field>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => setShowCategoryModal(false)}
                >
                  Cancel
                </button>
                <SubmitButton
                  class={styles.btnPrimary}
                  busy={categoryForm.submitting()}
                  busyLabel="Adding…"
                >
                  Add Category
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Bill Modal - disabled as unused - kept for future use */}

      <SubscriptionCatalogModal
        isOpen={showCatalog}
        onClose={() => setShowCatalog(false)}
        categories={categories}
      />

      <SubscriptionScanModal isOpen={showScan} onClose={() => setShowScan(false)} />
    </div>
  )
}
