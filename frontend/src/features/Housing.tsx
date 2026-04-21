/**
 * Housing Component
 * Manages housing-related expenses and property information
 */

import { createSignal, onMount } from 'solid-js'
import { formatCurrency } from '../core/api'

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
      const data = await fetch('/api/housing').then(r => r.json()) || []
      setHousings(data)
    } catch {
      console.error('Failed to load housing expenses')
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
      await fetch('/api/housing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setShowAddModal(false)
      setFormData({ type: 'rent', property_name: '', monthly_amount: '', due_day: 1, due_month: new Date().getMonth() + 1, autopay: false, notes: '' })
      loadHousings()
    } catch (error) {
      console.error('Failed to save housing expense', error)
    }
  }

  // Delete housing expense
  const deleteHousing = async (id: number) => {
    if (!confirm('Are you sure you want to delete this expense?')) return
    try {
      await fetch(`/api/housing/${id}`, { method: 'DELETE' })
      loadHousings()
    } catch (error) {
      console.error('Failed to delete housing expense', error)
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
    <div class="page page-housing page-enter">
      <div class="page-header">
        <div class="header-top">
          <h1>Housing</h1>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Expense
          </button>
        </div>
        <p class="page-subtitle">Track all your housing-related expenses</p>
      </div>

      {/* Summary Cards */}
      <div class="housing-summary">
        <div class="summary-card highlighted">
          <div class="summary-label">Monthly Total</div>
          <div class="summary-value">{formatAmount(totalMonthlyCost())}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Active Expenses</div>
          <div class="summary-value">{housings().length}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Autopay Enabled</div>
          <div class="summary-value">
            {housings().filter(h => h.autopay).length}
          </div>
        </div>
      </div>

      {loading() ? (
        <div class="empty-state">Loading housing expenses...</div>
      ) : housings().length === 0 ? (
        <div class="empty-state">
          <p>No housing expenses yet</p>
          <p>Add your first housing expense to start tracking your housing costs.</p>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            Add Expense
          </button>
        </div>
      ) : (
        <div class="housing-list">
          {housings().map((housing) => (
            <div class="housing-card">
              <div class="housing-header">
                <div class="housing-icon">{getTypeIcon(housing.type)}</div>
                <div class="housing-info">
                  <h3 class="housing-name">{housing.property_name}</h3>
                  <p class="housing-type">{getTypeLabel(housing.type)}</p>
                </div>
                <div class="housing-actions">
                  <span class={`badge ${housing.autopay ? 'badge-success' : 'badge-default'}`}>
                    {housing.autopay ? '🔄 Autopay' : 'Manual'}
                  </span>
                  <button class="btn btn-sm btn-ghost" onClick={() => deleteHousing(housing.id)}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="housing-amount">
                <div class="amount-label">Monthly Cost</div>
                <div class="amount-value">{formatAmount(housing.monthly_amount)}</div>
              </div>
              <div class="housing-details">
                <div class="detail-item">
                  <span class="detail-label">Due</span>
                  <span class="detail-value">
                    {housing.due_month} / {housing.due_day}
                  </span>
                </div>
                {housing.notes && (
                  <div class="detail-item">
                    <span class="detail-label">Notes</span>
                    <span class="detail-value">{housing.notes}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Housing Modal */}
      {showAddModal() && (
        <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div class="modal" onclick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">Add Housing Expense</h3>
              <button class="modal-close" onClick={() => setShowAddModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" onSubmit={handleSubmit}>
              <div class="form-group">
                <label class="form-label">Expense Type</label>
                <select
                  class="form-control"
                  value={formData().type}
                  oninput={(e) => setFormData({ ...formData(), type: e.target.value as Housing['type'] })}
                >
                  <option value="rent">Rent</option>
                  <option value="mortgage">Mortgage</option>
                  <option value="hoa">HOA Fees</option>
                  <option value="property_tax">Property Tax</option>
                  <option value="insurance">Insurance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Property / Description</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., Main Apartment, Monthly Payment"
                  value={formData().property_name}
                  oninput={(e) => setFormData({ ...formData(), property_name: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Monthly Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="1200.00"
                  value={formData().monthly_amount}
                  oninput={(e) => setFormData({ ...formData(), monthly_amount: e.target.value })}
                  required
                />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Due Month</label>
                  <select
                    class="form-control"
                    value={formData().due_month}
                    oninput={(e) => setFormData({ ...formData(), due_month: parseInt(e.target.value) })}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option value={i + 1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
                    ))}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Due Day</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    class="form-control"
                    placeholder="1"
                    value={formData().due_day}
                    oninput={(e) => setFormData({ ...formData(), due_day: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">
                  <span>🔄 Autopay</span>
                  <span style="font-size: 14px; color: var(--text-secondary)">
                    Automatically pay this expense
                  </span>
                </label>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    checked={formData().autopay}
                    oninput={(e) => setFormData({ ...formData(), autopay: e.target.checked })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="form-group">
                <label class="form-label">Notes (optional)</label>
                <textarea
                  class="form-control"
                  placeholder="Additional details..."
                  value={formData().notes}
                  oninput={(e) => setFormData({ ...formData(), notes: e.target.value })}
                  rows={2}
                />
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
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