/**
 * Housing Component - EARS Specification
 *
 * GIVEN: A user is viewing the Housing page
 * WHEN: The page loads
 * THEN: The header displays "Housing" and shows monthly housing costs with icons
 *
 * GIVEN: A user wants to add a housing expense
 * WHEN: They click the "Add Expense" button
 * THEN: An "Add Expense" modal opens with fields for expense type, amount, and due date
 *
 * GIVEN: A user has set up autopay
 * WHEN: They toggle the autopay switch
 * THEN: The expense is marked with an autopay badge
 *
 * GIVEN: A user has multiple housing expenses
 * WHEN: The page displays the expenses list
 * THEN: It shows total monthly cost, number of active expenses, and autopay count
 *
 * GIVEN: A user wants to delete a housing expense
 * WHEN: They select an expense and confirm deletion
 * THEN: The expense is removed from the list
 */

/**
 * Housing Component
 * Manages housing-related expenses and property information
 */
import { createMemo, createSignal, For } from 'solid-js'
import Badge from '../components/Badge'
import ConfirmButton from '../components/ConfirmButton'
import OrbitalAccent from '../components/OrbitalAccent'
import OrbitalDivider from '../components/OrbitalDivider'
import RenewalCycle from '../components/RenewalCycle'
import ToggleField from '../components/ToggleField'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { paletteColor } from '../core/brandPalette'
import { refetchOnActive } from '../core/pageVisibility'
import styles from './HousingPage.module.css'

interface Housing {
  id: number
  type: 'rent' | 'mortgage' | 'hoa' | 'property_tax' | 'insurance' | 'other'
  property_name?: string
  name?: string
  monthly_amount: number | string
  due_day: number
  due_month: number
  due_date?: string
  start_date?: string
  autopay: boolean | number
  notes?: string
  profile_id: number
}

function getPropertyName(h: Housing): string {
  return h.property_name || h.name || 'Unknown'
}

function getMonthlyAmount(h: Housing): number {
  return Math.abs(parseFloat(String(h.monthly_amount || 0)))
}

export default function HousingForm() {
  const state = useAppState()
  const [housings, setHousings] = createSignal<Housing[]>([])
  const [initialLoad, setInitialLoad] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [formData, setFormData] = createSignal({
    type: 'rent',
    property_name: '',
    monthly_amount: '',
    due_day: 1,
    due_month: new Date().getMonth() + 1,
    autopay: false,
    notes: '',
  })

  // Subscriptions tracker
  interface SubBill {
    id: number
    name: string
    amount: number
    due_date: string
    frequency: string
    is_active: number
    category_name?: string
    category_color?: string
    notes?: string
  }
  const [subscriptions, setSubscriptions] = createSignal<SubBill[]>([])
  const activeSubs = createMemo(() => subscriptions().filter((s) => s.is_active !== 0))
  const totalSubsCost = createMemo(() => activeSubs().reduce((sum, s) => sum + s.amount, 0))

  const loadSubscriptions = async () => {
    try {
      const data = await apiGet<SubBill[]>('/api/bills?type=subscription')
      setSubscriptions(Array.isArray(data) ? data : [])
    } catch {
      // subscriptions remain as-is
    }
  }

  // Load housing expenses
  const loadHousings = async () => {
    try {
      const result = await apiGet<{ housings: Housing[] }>('/api/housing')
      setHousings(result.housings || [])
    } catch (err) {
      console.error('Failed to load housing expenses:', err)
      showToast('Failed to load housing expenses', 'error')
    } finally {
      setInitialLoad(false)
    }
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      type: formData().type,
      property_name: formData().property_name,
      monthly_amount: parseFloat(formData().monthly_amount),
      due_day: formData().due_day,
      due_month: formData().due_month,
      autopay: formData().autopay,
      notes: formData().notes,
    }

    try {
      await apiPost('/api/housing', data)
      showToast('Housing expense saved', 'success')
      setShowAddModal(false)
      setFormData({
        type: 'rent',
        property_name: '',
        monthly_amount: '',
        due_day: 1,
        due_month: new Date().getMonth() + 1,
        autopay: false,
        notes: '',
      })
      loadHousings()
    } catch (err) {
      console.error('Failed to save housing expense:', err)
      showToast('Failed to save housing expense', 'error')
    }
  }

  // Delete housing expense
  const deleteHousing = async (id: number) => {
    try {
      await apiDelete(`/api/housing/${id}`)
      showToast('Housing expense deleted', 'success')
      loadHousings()
    } catch (err) {
      console.error('Failed to delete housing expense:', err)
      showToast('Failed to delete housing expense', 'error')
    }
  }

  // Calculate total monthly housing cost
  const totalMonthlyCost = createMemo(() => {
    return housings().reduce((sum, h) => sum + getMonthlyAmount(h), 0)
  })

  // Get type icon SVG
  const getTypeIcon = (type: string) => {
    const paths: Record<string, string> = {
      rent: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
      mortgage:
        'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
      hoa: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
      property_tax:
        'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
      insurance: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
      other:
        'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    }
    const d = paths[type] || paths.other
    return (
      <svg
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path d={d} />
      </svg>
    )
  }

  // Get type label
  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      rent: 'Rent',
      mortgage: 'Mortgage',
      hoa: 'HOA Fees',
      property_tax: 'Property Tax',
      insurance: 'Insurance',
      other: 'Other',
    }
    return labels[type] || 'Other'
  }

  // Format currency
  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  // Load on mount and reload on profile change — but only while visible. A hidden
  // page defers its refetch until it is next shown (keep-alive fan-out guard).
  refetchOnActive(
    'housing',
    () => {
      void state.profileVersion
    },
    () => {
      void loadHousings()
      void loadSubscriptions()
    }
  )

  return (
    <div class={`page page-housing page-enter ${styles.housingPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="housing-header" data-tour="calc-housing">
            Housing
          </h1>
          <button
            data-test-id="add-housing-btn"
            class={styles.btnPrimary}
            onClick={() => setShowAddModal(true)}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Expense
          </button>
        </div>
        <p data-test-id="housing-subtitle" class={styles.pageSubtitle}>
          Track all your housing-related expenses
        </p>
      </div>

      {/* Summary Cards */}
      <div class={styles.housingSummary} data-test-id="housing-summary">
        <div
          class={`${styles.summaryCard} ${styles.highlighted}`}
          data-test-id="housing-summary-total"
        >
          <div class={styles.summaryLabel}>Monthly Total</div>
          <div class={styles.summaryValue} data-test-id="housing-summary-total-value">
            {formatAmount(totalMonthlyCost())}
          </div>
        </div>
        <div class={styles.summaryCard} data-test-id="housing-summary-active">
          <div class={styles.summaryLabel}>Active Expenses</div>
          <div class={styles.summaryValue}>{housings().length}</div>
        </div>
        <div class={styles.summaryCard} data-test-id="housing-summary-autopay">
          <div class={styles.summaryLabel}>Autopay Enabled</div>
          <div class={styles.summaryValue}>
            {housings().filter((h) => h.autopay === true || h.autopay === 1).length}
          </div>
        </div>
      </div>

      {/* Subscription Tracker */}
      {activeSubs().length > 0 && (
        <>
          <OrbitalDivider
            id="housing-sec-subs"
            label="Subscription Tracker"
            meta={`${formatCurrency(totalSubsCost())}/mo`}
          />
          <div class={styles.subscriptionSection}>
            <div class={styles.subscriptionBody}>
              <RenewalCycle
                subs={activeSubs().map((s) => ({
                  name: s.name,
                  amount: s.amount,
                  due_date: s.due_date,
                  category_color: s.category_color,
                }))}
                total={totalSubsCost()}
              />
              <div class={styles.subscriptionList}>
                <For each={activeSubs()}>
                  {(sub, i) => (
                    <div class={styles.subItem}>
                      <div class={styles.subItemInfo}>
                        <span
                          class={styles.subDot}
                          style={{ background: sub.category_color || paletteColor(i()) }}
                        />
                        <div>
                          <div class={styles.subItemName}>{sub.name}</div>
                          <div class={styles.subItemMeta}>
                            {sub.frequency === 'monthly'
                              ? 'Monthly'
                              : sub.frequency === 'weekly'
                                ? 'Weekly'
                                : 'Biweekly'}
                            {sub.due_date &&
                              ` · Due ${new Date(sub.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                          </div>
                        </div>
                      </div>
                      <div class={styles.subItemAmount}>{formatCurrency(sub.amount)}</div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </>
      )}

      {initialLoad() && housings().length === 0 ? (
        <div class={styles.emptyState}>Loading housing expenses...</div>
      ) : housings().length === 0 ? (
        <div class={styles.emptyState} data-test-id="housing-empty">
          <p>No housing expenses yet</p>
          <p>Add your first housing expense to start tracking your housing costs.</p>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            Add Expense
          </button>
        </div>
      ) : (
        <div class={styles.housingList} data-test-id="housing-list">
          <For each={housings()}>
            {(housing) => (
              <div class={styles.housingCard} data-test-id="housing-card">
                <div class={styles.housingHeader}>
                  <div class={styles.housingIcon}>{getTypeIcon(housing.type)}</div>
                  <div class={styles.housingInfo}>
                    <h3 class={styles.housingName} data-test-id="housing-card-name">
                      {getPropertyName(housing)}
                    </h3>
                    <p class={styles.housingType} data-test-id="housing-card-type">
                      {getTypeLabel(housing.type)}
                    </p>
                  </div>
                  <div class={styles.housingActions}>
                    <span data-test-id="housing-card-autopay">
                      {housing.autopay === true || housing.autopay === 1 ? (
                        <Badge status="success">Autopay</Badge>
                      ) : (
                        <Badge status="default">Manual</Badge>
                      )}
                    </span>
                    <span data-test-id="housing-card-delete">
                      <ConfirmButton
                        class={`${styles.btnSm} ${styles.btnGhost}`}
                        onConfirm={() => deleteHousing(housing.id)}
                        message="Delete this housing entry? This can’t be undone."
                        aria-label="Delete housing entry"
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
                    </span>
                  </div>
                </div>
                <div class={styles.housingAmount}>
                  <div class={styles.amountLabel}>Monthly Cost</div>
                  <div class={styles.amountValue} data-test-id="housing-card-amount">
                    {formatAmount(getMonthlyAmount(housing))}
                  </div>
                </div>
                <div class={styles.housingDetails}>
                  <div class={styles.detailItem}>
                    <span class={styles.detailLabel}>Due</span>
                    <span class={styles.detailValue} data-test-id="housing-card-due">
                      {housing.due_date
                        ? housing.due_date
                        : `${housing.due_month} / ${housing.due_day}`}
                    </span>
                  </div>
                  {housing.notes && (
                    <div class={styles.detailItem}>
                      <span class={styles.detailLabel}>Notes</span>
                      <span class={styles.detailValue} data-test-id="housing-card-notes">
                        {housing.notes}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </For>
        </div>
      )}

      {/* Add Housing Modal */}
      {showAddModal() && (
        <div
          class={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          data-test-id="housing-modal"
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
              <h3 class={styles.modalTitle}>Add Housing Expense</h3>
              <OrbitalAccent />
              <button class={styles.modalClose} onClick={() => setShowAddModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Expense Type</label>
                <select
                  class={styles.formControl}
                  data-test-id="housing-type-select"
                  value={formData().type}
                  oninput={(e) =>
                    setFormData({ ...formData(), type: e.target.value as Housing['type'] })
                  }
                >
                  <option value="rent">Rent</option>
                  <option value="mortgage">Mortgage</option>
                  <option value="hoa">HOA Fees</option>
                  <option value="property_tax">Property Tax</option>
                  <option value="insurance">Insurance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Property / Description</label>
                <input
                  type="text"
                  class={styles.formControl}
                  data-test-id="housing-property-input"
                  placeholder="e.g., Main Apartment, Monthly Payment"
                  value={formData().property_name}
                  oninput={(e) => setFormData({ ...formData(), property_name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Monthly Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  data-test-id="housing-amount-input"
                  placeholder="1200.00"
                  value={formData().monthly_amount}
                  oninput={(e) => setFormData({ ...formData(), monthly_amount: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Due Month</label>
                  <select
                    class={styles.formControl}
                    data-test-id="housing-due-month-select"
                    value={formData().due_month}
                    oninput={(e) =>
                      setFormData({ ...formData(), due_month: parseInt(e.target.value) })
                    }
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option value={i + 1}>
                        {new Date(0, i).toLocaleString('default', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Due Day</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    class={styles.formControl}
                    data-test-id="housing-due-day-input"
                    placeholder="1"
                    value={formData().due_day}
                    oninput={(e) =>
                      setFormData({ ...formData(), due_day: parseInt(e.target.value) || 1 })
                    }
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <ToggleField
                  title="Autopay"
                  description="Indicate that this housing expense is handled automatically."
                  data-test-id="housing-autopay-toggle"
                  checked={() => formData().autopay}
                  onChange={(v) => setFormData({ ...formData(), autopay: v })}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Notes (optional)</label>
                <textarea
                  class={styles.formControl}
                  data-test-id="housing-notes-input"
                  placeholder="Additional details..."
                  value={formData().notes}
                  oninput={(e) => setFormData({ ...formData(), notes: e.target.value })}
                  rows={2}
                />
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary} data-test-id="housing-submit-btn">
                  Add Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
