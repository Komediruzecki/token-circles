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
import { createSignal, For, onMount } from 'solid-js'
import Badge from '../components/Badge'
import ConfirmButton from '../components/ConfirmButton'
import styles from '../components/HousingPage.module.css'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, showToast } from '../utils/api'

interface Housing {
  id: number
  type: 'rent' | 'mortgage' | 'hoa' | 'property_tax' | 'insurance' | 'other'
  property_name: string
  monthly_amount: number
  due_day: number
  due_month: number
  start_date: string
  autopay: boolean
  notes?: string
  profile_id: number
}

export default function HousingForm() {
  const [housings, setHousings] = createSignal<Housing[]>([])
  const [loading, setLoading] = createSignal(true)
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

  // Load housing expenses
  const loadHousings = async () => {
    setLoading(true)
    try {
      const result = await apiGet<{ housings: Housing[] }>('/api/housing')
      setHousings(result.housings || [])
    } catch (err) {
      console.error('Failed to load housing expenses:', err)
      showToast('Failed to load housing expenses', 'error')
    } finally {
      setLoading(false)
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
  const totalMonthlyCost = () => {
    return housings().reduce((sum, h) => sum + h.monthly_amount, 0)
  }

  // Get type icon
  const getTypeIcon = (type: string): string => {
    const icons: Record<string, string> = {
      rent: '🏠',
      mortgage: '🏦',
      hoa: '🏢',
      property_tax: '📊',
      insurance: '🛡️',
      other: '📋',
    }
    return icons[type] || '📋'
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

  onMount(() => {
    loadHousings()
  })

  return (
    <div class={`page page-housing page-enter ${styles.housingPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1>Housing</h1>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Expense
          </button>
        </div>
        <p class={styles.pageSubtitle}>Track all your housing-related expenses</p>
      </div>

      {/* Summary Cards */}
      <div class={styles.housingSummary}>
        <div class={`${styles.summaryCard} ${styles.highlighted}`}>
          <div class={styles.summaryLabel}>Monthly Total</div>
          <div class={styles.summaryValue}>{formatAmount(totalMonthlyCost())}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Active Expenses</div>
          <div class={styles.summaryValue}>{housings().length}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Autopay Enabled</div>
          <div class={styles.summaryValue}>{housings().filter((h) => h.autopay).length}</div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading housing expenses...</div>
      ) : housings().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No housing expenses yet</p>
          <p>Add your first housing expense to start tracking your housing costs.</p>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            Add Expense
          </button>
        </div>
      ) : (
        <div class={styles.housingList}>
          <For each={housings()}>
            {(housing) => (
              <div class={styles.housingCard}>
                <div class={styles.housingHeader}>
                  <div class={styles.housingIcon}>{getTypeIcon(housing.type)}</div>
                  <div class={styles.housingInfo}>
                    <h3 class={styles.housingName}>{housing.property_name}</h3>
                    <p class={styles.housingType}>{getTypeLabel(housing.type)}</p>
                  </div>
                  <div class={styles.housingActions}>
                    {housing.autopay ? <Badge status="success">Autopay</Badge> : <Badge status="default">Manual</Badge>}
                    <ConfirmButton
                      class={`${styles.btnSm} ${styles.btnGhost}`}
                      onConfirm={() => deleteHousing(housing.id)}
                      label={<svg
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>}
                    />
                  </div>
                </div>
                <div class={styles.housingAmount}>
                  <div class={styles.amountLabel}>Monthly Cost</div>
                  <div class={styles.amountValue}>{formatAmount(housing.monthly_amount)}</div>
                </div>
                <div class={styles.housingDetails}>
                  <div class={styles.detailItem}>
                    <span class={styles.detailLabel}>Due</span>
                    <span class={styles.detailValue}>
                      {housing.due_month} / {housing.due_day}
                    </span>
                  </div>
                  {housing.notes && (
                    <div class={styles.detailItem}>
                      <span class={styles.detailLabel}>Notes</span>
                      <span class={styles.detailValue}>{housing.notes}</span>
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
                    placeholder="1"
                    value={formData().due_day}
                    oninput={(e) =>
                      setFormData({ ...formData(), due_day: parseInt(e.target.value) || 1 })
                    }
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>
                  <span>🔄 Autopay</span>
                  <span style="font-size: 14px; color: var(--text-secondary)">
                    Automatically pay this expense
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
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Notes (optional)</label>
                <textarea
                  class={styles.formControl}
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
                <button type="submit" class={styles.btnPrimary}>
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
