/**
 * Goals Component
 * Handles savings goals with progress tracking
 */

import { createSignal, onMount } from 'solid-js'
import { formatCurrency } from '../core/api'
import { api } from '../core/api'

interface Goal {
  id: number
  name: string
  target_amount: number
  current_amount: number
  target_date: string
  profile_id: number
  created_at: string
}

export default function Goals() {
  const [goals, setGoals] = createSignal<Goal[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingGoal, setEditingGoal] = createSignal<Goal | null>(null)
  const [formData, setFormData] = createSignal({
    name: '',
    target_amount: '',
    target_date: '',
  })

  // Load goals
  const loadGoals = async () => {
    setLoading(true)
    try {
      const data = await api.getGoals?.() || await fetch('/api/savings-goals').then(r => r.json())
      setGoals(data)
    } catch {
      console.error('Failed to load goals')
    } finally {
      setLoading(false)
    }
  }

  // Handle form submit (create or update)
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      target_amount: parseFloat(formData().target_amount),
      target_date: formData().target_date,
    }

    try {
      if (editingGoal()) {
        await fetch(`/api/savings-goals/${editingGoal()!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      } else {
        await fetch('/api/savings-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      }
      setShowAddModal(false)
      setEditingGoal(null)
      setFormData({ name: '', target_amount: '', target_date: '' })
      loadGoals()
    } catch (error) {
      console.error('Failed to save goal', error)
    }
  }

  // Delete goal
  const deleteGoal = async (id: number) => {
    if (!confirm('Are you sure you want to delete this goal?')) return
    try {
      await fetch(`/api/savings-goals/${id}`, { method: 'DELETE' })
      loadGoals()
    } catch (error) {
      console.error('Failed to delete goal', error)
    }
  }

  // Open edit modal
  const editGoal = (goal: Goal) => {
    setEditingGoal(goal)
    setFormData({
      name: goal.name,
      target_amount: goal.target_amount.toString(),
      target_date: goal.target_date.slice(0, 10),
    })
    setShowAddModal(true)
  }

  // Progress percentage
  const getProgress = (goal: Goal): number => {
    return Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
  }

  // Days until target date
  const daysUntil = (dateStr: string): string => {
    const target = new Date(dateStr)
    const today = new Date()
    const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return `${Math.abs(diff)} days overdue`
    if (diff === 0) return 'Due today'
    if (diff === 1) return 'Due tomorrow'
    return `Due in ${diff} days`
  }

  // Format date
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  onMount(() => {
    loadGoals()
  })

  return (
    <div class="page page-goals page-enter">
      <div class="page-header">
        <div class="header-top">
          <h1>Savings Goals</h1>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Goal
          </button>
        </div>
        <p class="page-subtitle">Track your savings progress towards financial goals</p>
      </div>

      {loading() ? (
        <div class="empty-state">Loading goals...</div>
      ) : goals().length === 0 ? (
        <div class="empty-state">
          <p>No goals yet</p>
          <p>Create your first savings goal to start tracking.</p>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            Create Goal
          </button>
        </div>
      ) : (
        <div class="goals-grid">
          {goals().map((goal) => {
            const progress = getProgress(goal)
            return (
              <div class="goal-card">
                <div class="goal-header">
                  <div class="goal-icon">🎯</div>
                  <div class="goal-info">
                    <h3 class="goal-name">{goal.name}</h3>
                    <p class="goal-date">{formatDate(goal.target_date)} • {daysUntil(goal.target_date)}</p>
                  </div>
                  <div class="goal-actions">
                    <button class="btn btn-sm btn-ghost" onClick={() => editGoal(goal)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost" onClick={() => deleteGoal(goal.id)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="goal-progress">
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div class="progress-stats">
                    <span class="progress-percent">{progress}%</span>
                    <span class="progress-current">{formatCurrency(goal.current_amount)} of {formatCurrency(goal.target_amount)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div class="modal" onclick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">{editingGoal() ? 'Edit Goal' : 'New Goal'}</h3>
              <button class="modal-close" onClick={() => { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', target_date: '' }) }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" onSubmit={handleSubmit}>
              <div class="form-group">
                <label class="form-label">Goal Name</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., Emergency Fund, Vacation"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Target Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="5000.00"
                  value={formData().target_amount}
                  oninput={(e) => setFormData({ ...formData(), target_amount: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Target Date</label>
                <input
                  type="date"
                  class="form-control"
                  value={formData().target_date}
                  oninput={(e) => setFormData({ ...formData(), target_date: e.target.value })}
                  required
                />
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onClick={() => { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', target_date: '' }) }}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  {editingGoal() ? 'Update' : 'Create'} Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}