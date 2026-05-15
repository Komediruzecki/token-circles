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
import { createEffect, createSignal, For, onMount } from 'solid-js'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import styles from '../components/GoalsPage.module.css'
import { formatCurrency } from '../core/api'
import { useAppState } from '../core/appStore'
import { theme } from '../core/theme'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../utils/api'

interface Goal {
  id: number
  name: string
  target_amount: number
  current_amount: number
  monthly_contribution: number
  target_date: string
  profile_id: number
  created_at: string
  category_id?: number | null
  category_name?: string
}

interface CategoryOption {
  id: number
  name: string
  color: string
  type: string
}

export default function Goals() {
  const state = useAppState()
  const [goals, setGoals] = createSignal<Goal[]>([])
  const [categories, setCategories] = createSignal<CategoryOption[]>([])
  const [loading, setLoading] = createSignal(true)
  const chartColors = () => theme.getChartColors()
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingGoal, setEditingGoal] = createSignal<Goal | null>(null)
  const [formData, setFormData] = createSignal({
    name: '',
    target_amount: '',
    target_date: '',
    monthly_contribution: '',
    category_id: '',
  })

  // Load goals
  const loadGoals = async () => {
    setLoading(true)
    try {
      const data = await apiGet<any[]>('/api/savings-goals')
      // Also get category names for each goal
      const cats = await apiGet<any[]>('/api/categories')
      const catMap = new Map<number, string>(cats.map((c: any) => [c.id, c.name]))
      setGoals(
        data.map((s) => ({
          id: s.id,
          name: s.name,
          target_amount: s.target_amount || 0,
          current_amount: s.current_amount || 0,
          monthly_contribution: s.monthly_contribution || 0,
          target_date: s.deadline || s.target_date || new Date().toISOString().split('T')[0],
          profile_id: s.profile_id,
          created_at: s.created_at,
          category_id: s.category_id || null,
          category_name: s.category_id ? catMap.get(s.category_id) : undefined,
        }))
      )
    } catch (err) {
      console.error('Failed to load goals:', err)
      showToast('Failed to load goals', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Load categories for selector
  const loadCategories = async () => {
    try {
      const cats = await apiGet<any[]>('/api/categories')
      setCategories(cats)
    } catch {
      // categories remain empty
    }
  }

  // Handle form submit (create or update)
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data: Record<string, unknown> = {
      name: formData().name,
      target_amount: parseFloat(formData().target_amount),
      target_date: formData().target_date,
      monthly_contribution: formData().monthly_contribution
        ? parseFloat(formData().monthly_contribution)
        : null,
    }
    const catId = formData().category_id ? parseInt(formData().category_id) : null
    if (catId) data.category_id = catId

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
      setFormData({
        name: '',
        target_amount: '',
        target_date: '',
        monthly_contribution: '',
        category_id: '',
      })
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
      monthly_contribution: goal.monthly_contribution ? goal.monthly_contribution.toString() : '',
      category_id: goal.category_id ? goal.category_id.toString() : '',
    })
    setShowAddModal(true)
  }

  // Progress percentage
  const getProgress = (goal: Goal): number => {
    if (!goal.target_amount || goal.target_amount <= 0) return 0
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
    loadCategories()
  })

  createEffect(() => {
    void state.profileVersion
    loadGoals()
    loadCategories()
  })

  return (
    <div class={`page page-goals page-enter ${styles.goalsPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="goals-header">Savings Goals</h1>
          <button
            data-test-id="add-goal-btn"
            class={styles.btnPrimary}
            onclick={() => setShowAddModal(true)}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Goal
          </button>
        </div>
        <p data-test-id="goals-subtitle" class={styles.pageSubtitle}>
          Track your savings progress towards financial goals
        </p>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading goals...</div>
      ) : goals().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No goals yet</p>
          <p>Create your first savings goal to start tracking.</p>
          <button class={styles.btnPrimary} onclick={() => setShowAddModal(true)}>
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
                    <div data-test-id="goal-icon" class={styles.goalIcon}>
                      <svg
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 4a6 6 0 100 12 6 6 0 000-12zm0 3a3 3 0 100 6 3 3 0 000-6z" />
                      </svg>
                    </div>
                    <div class={styles.goalInfo}>
                      <h3 data-test-id="goal-name" class={styles.goalName}>
                        {goal.name}
                      </h3>
                      <p data-test-id="goal-date" class={styles.goalDate}>
                        {formatDate(goal.target_date)} • {daysUntil(goal.target_date)}
                        {goal.category_name && (
                          <span class={styles.goalCategory}> • {goal.category_name}</span>
                        )}
                      </p>
                    </div>
                    <div data-test-id="goal-actions" class={styles.goalActions}>
                      <button
                        data-test-id="goal-edit-btn"
                        class={styles.btnSm}
                        onclick={() => {
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
                  <div class={styles.goalProgress}>
                    <div data-test-id="goal-progress-bar" class={styles.progressBar}>
                      <div class={styles.progressFill} style={{ width: `${progress}%` }} />
                    </div>
                    <div class={styles.progressStats}>
                      <span data-test-id="goal-progress-percent" class={styles.progressPercent}>
                        {progress}%
                      </span>
                      <span data-test-id="goal-progress-current" class={styles.progressCurrent}>
                        {formatCurrency(goal.current_amount)} of{' '}
                        {formatCurrency(goal.target_amount)}
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
                      const progress = g.target_amount > 0 ? g.current_amount / g.target_amount : 0
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
                      color: chartColors().text,
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (context: any) => {
                        const goal = goals()[context.dataIndex]
                        const progress =
                          goal.target_amount > 0
                            ? Math.round((goal.current_amount / goal.target_amount) * 100)
                            : 0
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

      {/* Goal Projection Timeline */}
      {goals().length > 0 && goals().some((g) => g.monthly_contribution > 0) && (
        <div class={styles.goalsChartSection}>
          <h3>Goal Projections</h3>
          <div class={styles.chartWrapper}>
            <Chart
              id="goals-projection-chart"
              type="line"
              data={{
                labels: (() => {
                  const maxMonths = Math.max(
                    ...goals()
                      .filter((g) => g.monthly_contribution > 0)
                      .map((g) => {
                        const remaining = g.target_amount - g.current_amount
                        const monthly = g.monthly_contribution || 1
                        return Math.ceil(remaining / monthly)
                      }),
                    1
                  )
                  return Array.from({ length: maxMonths + 1 }, (_, i) => `Month ${i}`)
                })(),
                datasets: goals()
                  .filter((g) => g.monthly_contribution > 0)
                  .map((g, idx) => {
                    const colors = [
                      '#6366f1',
                      '#10b981',
                      '#f59e0b',
                      '#ef4444',
                      '#8b5cf6',
                      '#06b6d4',
                    ]
                    const color = colors[idx % colors.length]
                    const monthly = g.monthly_contribution || 0
                    const remaining = g.target_amount - g.current_amount
                    const monthsNeeded = Math.ceil(remaining / monthly)
                    const data: (number | null)[] = [g.current_amount]
                    for (let m = 1; m <= monthsNeeded; m++) {
                      data.push(Math.min(g.current_amount + monthly * m, g.target_amount))
                    }
                    return {
                      label: g.name,
                      data,
                      borderColor: color,
                      backgroundColor: `${color}20`,
                      fill: true,
                      tension: 0.3,
                      borderWidth: 2,
                      pointRadius: 0,
                    }
                  }),
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    ticks: {
                      callback: (v: number | string) =>
                        formatCurrency(typeof v === 'number' ? v : Number(v), 'EUR'),
                      color: chartColors().text,
                    },
                    grid: { color: chartColors().border },
                    title: {
                      display: true,
                      text: 'Balance',
                      color: chartColors().text,
                    },
                  },
                  x: {
                    ticks: { color: chartColors().text, maxTicksLimit: 12 },
                    grid: { color: chartColors().border },
                    title: {
                      display: true,
                      text: 'Months from now',
                      color: chartColors().text,
                    },
                  },
                },
                plugins: {
                  legend: {
                    position: 'top',
                    labels: { color: chartColors().text, usePointStyle: true },
                  },
                },
              }}
              height={300}
              width="100%"
            />
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div
          class={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
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
                onclick={() => {
                  setShowAddModal(false)
                  setEditingGoal(null)
                  setFormData({
                    name: '',
                    target_amount: '',
                    target_date: '',
                    monthly_contribution: '',
                    category_id: '',
                  })
                }}
              >
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onsubmit={handleSubmit}>
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
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Linked Category (optional)</label>
                <select
                  class={styles.formControl}
                  value={formData().category_id}
                  onchange={(e) => setFormData({ ...formData(), category_id: e.target.value })}
                >
                  <option value="">None — manual tracking</option>
                  <For each={categories()}>
                    {(cat) => (
                      <option value={cat.id}>
                        {cat.name} ({cat.type})
                      </option>
                    )}
                  </For>
                </select>
                <p
                  style={{
                    'font-size': '11px',
                    color: 'var(--text-secondary)',
                    'margin-top': '4px',
                  }}
                >
                  Transactions to this category will count toward goal progress
                </p>
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onclick={() => {
                    setShowAddModal(false)
                    setEditingGoal(null)
                    setFormData({
                      name: '',
                      target_amount: '',
                      target_date: '',
                      monthly_contribution: '',
                      category_id: '',
                    })
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
