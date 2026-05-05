/**
 * Goals Component - EARS Specification
 *
 * GIVEN: A user is viewing the Goals page
 * WHEN: The page loads
 * THEN: The header displays "Goals" and shows all savings goals with progress bars
 *
 * GIVEN: A user wants to create a new savings goal
 * WHEN: They click the "Create Goal" button
 * THEN: A goal creation modal opens with fields for name, target amount, and target date
 *
 * GIVEN: A user has a savings goal
 * WHEN: They view the goal card
 * THEN: The progress bar shows current amount toward the target with a percentage
 *
 * GIVEN: A user adds a contribution to a goal
 * WHEN: They enter a contribution amount and save
 * THEN: The goal's current amount increases and progress percentage updates
 *
 * GIVEN: A user wants to edit a goal
 * WHEN: They click the edit button on a goal
 * THEN: The goal details populate the edit form with existing values
 *
 * GIVEN: A user wants to delete a goal
 * WHEN: They select a goal and confirm deletion
 * THEN: The goal is removed from the list
 */

/**
 * Goals Component
 * Handles savings goals with progress tracking
 */
import { createSignal, For, onMount } from 'solid-js'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import styles from '../components/GoalsPage.module.css'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../utils/api'

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
      const data = await apiGet<any[]>('/api/savings-goals')
      // Convert SavingsGoal (deadline) to Goal (target_date)
      setGoals(
        data.map((s) => ({
          id: s.id,
          name: s.name,
          target_amount: s.current_amount,
          current_amount: s.current_amount,
          target_date: s.deadline || new Date().toISOString().split('T')[0],
          monthly_contribution: s.monthly_contribution || '',
          profile_id: s.profile_id,
          created_at: s.created_at,
        }))
      )
    } catch (err) {
      console.error('Failed to load goals:', err)
      showToast('Failed to load goals', 'error')
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
      monthly_contribution: formData().monthly_contribution
        ? parseFloat(formData().monthly_contribution)
        : null,
    }

    try {
      if (editingGoal()) {
        await apiPut(`/api/savings-goals/${editingGoal()!.id}`, data)
        showToast('Goal updated successfully', 'success')
      } else {
        await apiPost('/api/savings-goals', data)
        showToast('Goal created successfully', 'success')
      }
      setShowAddModal(false)
      setEditingGoal(null)
      setFormData({ name: '', target_amount: '', target_date: '', monthly_contribution: '' })
      loadGoals()
    } catch (err) {
      console.error('Failed to save goal:', err)
      showToast('Failed to save goal', 'error')
    }
  }

  // Delete goal
  const deleteGoal = async (id: number) => {
    try {
      await apiDelete(`/api/savings-goals/${id}`)
      showToast('Goal deleted successfully', 'success')
      loadGoals()
    } catch (err) {
      console.error('Failed to delete goal:', err)
      showToast('Failed to delete goal', 'error')
    }
  }

  // Open edit modal
  const editGoal = (goal: Goal) => {
    setEditingGoal(goal)
    setFormData({
      name: goal.name,
      target_amount: goal.target_amount.toString(),
      target_date: goal.target_date,
      monthly_contribution: '',
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
          <h1 data-test-id="goals-header">Savings Goals</h1>
          <button data-test-id="add-goal-btn" class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Goal
          </button>
        </div>
        <p data-test-id="goals-subtitle" class={styles.pageSubtitle}>Track your savings progress towards financial goals</p>
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
        <div data-test-id="goals-grid" class={styles.goalsGrid}>
          <For each={goals()}>
            {(goal) => {
            const progress = getProgress(goal)
            return (
              <div data-test-id="goal-card" class={styles.goalCard}>
                <div class={styles.goalHeader}>
                  <div data-test-id="goal-icon" class={styles.goalIcon}>🎯</div>
                  <div class={styles.goalInfo}>
                    <h3 data-test-id="goal-name" class={styles.goalName}>{goal.name}</h3>
                    <p data-test-id="goal-date" class={styles.goalDate}>
                      {formatDate(goal.target_date)} • {daysUntil(goal.target_date)}
                    </p>
                  </div>
                  <div data-test-id="goal-actions" class={styles.goalActions}>
                    <button
                      data-test-id="goal-edit-btn"
                      class={styles.btnSm}
                      onClick={() => {
                        editGoal(goal)
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <ConfirmButton
                      class={styles.btnSm}
                      onConfirm={() => deleteGoal(goal.id)}
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
                <div class={styles.goalProgress}>
                  <div data-test-id="goal-progress-bar" class={styles.progressBar}>
                    <div class={styles.progressFill} style={{ width: `${progress}%` }} />
                  </div>
                  <div class={styles.progressStats}>
                    <span data-test-id="goal-progress-percent" class={styles.progressPercent}>{progress}%</span>
                    <span data-test-id="goal-progress-current" class={styles.progressCurrent}>
                      {formatCurrency(goal.current_amount)} of {formatCurrency(goal.target_amount)}
                    </span>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
        </div>
      )}

      {/* Goals Progress Chart */}
      {goals().length > 0 && (
        <div class={styles.goalsChartSection}>
          <h3>Goals Progress</h3>
          <div class={styles.chartWrapper}>
            <Chart
              id="goals-progress-chart"
              type="doughnut"
              data={{
                labels: goals().map((g) => g.name),
                datasets: [
                  {
                    data: goals().map((g) => g.current_amount),
                    backgroundColor: goals().map((g) => {
                      const progress = g.current_amount / g.target_amount
                      if (progress < 0.3) return '#dc2626'
                      if (progress < 0.6) return '#eab308'
                      if (progress < 0.9) return '#22c55e'
                      return '#8b5cf6'
                    }),
                    borderWidth: 0,
                  },
                ],
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
                      font: { size: 12 },
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (context: any) => {
                        const goal = goals()[context.dataIndex]
                        const progress = Math.round(
                          (goal.current_amount / goal.target_amount) * 100
                        )
                        return `${goal.name}: ${formatCurrency(goal.current_amount)} of ${formatCurrency(goal.target_amount)} (${progress}%)`
                      },
                    },
                  },
                },
              }}
              height={250}
              width="100%"
            />
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
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
              <h3 class={styles.modalTitle}>{editingGoal() ? 'Edit Goal' : 'New Goal'}</h3>
              <button
                class={styles.modalClose}
                onClick={() => {
                  setShowAddModal(false)
                  setEditingGoal(null)
                  setFormData({ name: '', target_amount: '', target_date: '', monthly_contribution: '' })
                }}
              >
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Goal Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Emergency Fund, Vacation"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Target Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="5000.00"
                  value={formData().target_amount}
                  oninput={(e) => setFormData({ ...formData(), target_amount: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Target Date</label>
                <input
                  type="date"
                  class={styles.formControl}
                  value={formData().target_date}
                  oninput={(e) => setFormData({ ...formData(), target_date: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Monthly Contribution</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="e.g., 500.00"
                  value={formData().monthly_contribution}
                  oninput={(e) =>
                    setFormData({ ...formData(), monthly_contribution: e.target.value })
                  }
                />
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingGoal(null)
                    setFormData({ name: '', target_amount: '', target_date: '', monthly_contribution: '' })
                  }}
                >
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
