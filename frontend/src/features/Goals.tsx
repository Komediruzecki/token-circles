/**
 * Goals Component
 * Handles savings goals with progress tracking
 */
import { createSignal, onMount } from 'solid-js'
import Chart from '../components/Chart'
import styles from '../components/GoalsPage.module.css'
import { formatCurrency } from '../core/api'

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
    monthly_contribution: '',
  })

  // Load goals
  const loadGoals = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/savings-goals')
      const data = await response.json()
      // Convert SavingsGoal (deadline) to Goal (target_date)
      setGoals(data.map((s: any) => ({
        id: s.id,
        name: s.name,
        target_amount: s.current_amount,
        current_amount: s.current_amount,
        target_date: s.deadline || new Date().toISOString().split('T')[0],
        monthly_contribution: s.monthly_contribution || '',
        profile_id: s.profile_id,
        created_at: s.created_at,
      })))
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
      monthly_contribution: formData().monthly_contribution ? parseFloat(formData().monthly_contribution) : null,
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
      setFormData({ name: '', target_amount: '', target_date: '', monthly_contribution: '' })
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
      monthly_contribution: goal.monthly_contribution ? goal.monthly_contribution.toString() : '',
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
    <div class={`page page-goals page-enter ${styles.goalsPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1>Savings Goals</h1>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Goal
          </button>
        </div>
        <p class={styles.pageSubtitle}>Track your savings progress towards financial goals</p>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading goals...</div>
      ) : goals().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No goals yet</p>
          <p>Create your first savings goal to start tracking.</p>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            Create Goal
          </button>
        </div>
      ) : (
        <div class={styles.goalsGrid}>
            {goals().map((goal) => {
              const progress = getProgress(goal)
              return (
              <div class={styles.goalCard}>
                <div class={styles.goalHeader}>
                  <div class={styles.goalIcon}>🎯</div>
                  <div class={styles.goalInfo}>
                    <h3 class={styles.goalName}>{goal.name}</h3>
                    <p class={styles.goalDate}>{formatDate(goal.target_date)} • {daysUntil(goal.target_date)}</p>
                  </div>
                  <div class={styles.goalActions}>
                    <button class="btn btn-sm btn-ghost" onClick={() => { editGoal(goal); }}>
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
                <div class={styles.goalProgress}>
                  <div class={styles.progressBar}>
                    <div
                      class={styles.progressFill}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div class={styles.progressStats}>
                    <span class={styles.progressPercent}>{progress}%</span>
                    <span class={styles.progressCurrent}>{formatCurrency(goal.current_amount)} of {formatCurrency(goal.target_amount)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Goals Progress Chart */}
      {goals().length > 0 && (
        <div class="goals-chart-section">
          <h3>Goals Progress</h3>
          <div class="chart-wrapper">
            <Chart
              id="goals-progress-chart"
              type="doughnut"
              data={{
                labels: goals().map((g) => g.name),
                datasets: [{
                  data: goals().map((g) => g.current_amount),
                  backgroundColor: goals().map((g) => {
                    const progress = g.current_amount / g.target_amount
                    if (progress < 0.3) return '#dc2626'
                    if (progress < 0.6) return '#eab308'
                    if (progress < 0.9) return '#22c55e'
                    return '#8b5cf6'
                  }),
                  borderWidth: 0
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'right',
                    labels: {
                      usePointStyle: true,
                      padding: 15,
                      font: { size: 12 }
                    }
                  },
                  tooltip: {
                    callbacks: {
                      label: (context: any) => {
                        const goal = goals()[context.dataIndex]
                        const progress = Math.round((goal.current_amount / goal.target_amount) * 100)
                        return `${goal.name}: ${formatCurrency(goal.current_amount)} of ${formatCurrency(goal.target_amount)} (${progress}%)`
                      }
                    }
                  }
                }
              }}
              height={250}
              width="100%"
            />
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div class={styles.modalOverlay} onclick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div class={styles.modal} onclick={(e) => { e.stopPropagation(); }}>
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>{editingGoal() ? 'Edit Goal' : 'New Goal'}</h3>
              <button class={styles.modalClose} onClick={() => { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', target_date: '' }) }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
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
              <div class="form-group">
                <label class="form-label">Monthly Contribution</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="e.g., 500.00"
                  value={formData().monthly_contribution}
                  oninput={(e) => setFormData({ ...formData(), monthly_contribution: e.target.value })}
                />
              </div>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={() => { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', target_date: '' }) }}>
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
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