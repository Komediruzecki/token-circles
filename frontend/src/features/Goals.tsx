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
import { createEffect, createMemo, createSignal, For, onMount } from 'solid-js'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import GoalRing from '../components/GoalRing'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { CATEGORY_PALETTE } from '../core/brandPalette'
import { theme } from '../core/theme'
import styles from './GoalsPage.module.css'

interface Goal {
  id: number
  name: string
  target_amount: number
  current_amount: number
  monthly_contribution: number
  target_date: string
  tracking_start_date?: string | null
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
  const [showCategoryModal, setShowCategoryModal] = createSignal(false)
  const [categoryForm, setCategoryForm] = createSignal({
    name: '',
    type: 'expense',
    color: '#6e9bff',
  })
  const [editingGoal, setEditingGoal] = createSignal<Goal | null>(null)
  const [formData, setFormData] = createSignal({
    name: '',
    target_amount: '',
    target_date: '',
    monthly_contribution: '',
    category_id: '',
    tracking_start_date: '',
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
          tracking_start_date: s.tracking_start_date || null,
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
    if (catId) {
      data.category_id = catId
      // Category goals track from this date on; default to today when unset.
      data.tracking_start_date =
        formData().tracking_start_date || new Date().toISOString().split('T')[0]
    } else {
      data.category_id = null
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
      setFormData({
        name: '',
        target_amount: '',
        target_date: '',
        monthly_contribution: '',
        category_id: '',
        tracking_start_date: '',
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

  // Add category from within goal modal
  const addCategory = async (e: Event) => {
    e.preventDefault()
    try {
      await apiPost('/api/categories', {
        name: categoryForm().name,
        type: categoryForm().type,
        color: categoryForm().color,
      })
      setShowCategoryModal(false)
      setCategoryForm({ name: '', type: 'expense', color: '#6e9bff' })
      loadCategories()
    } catch (err) {
      console.error('Failed to create category:', err)
      showToast('Failed to create category', 'error')
    }
  }

  // Accept both '.' and ',' as the decimal separator (a native number input rejects
  // '.' and clears on ',' in comma-decimal locales).
  const sanitizeDecimal = (s: string): string => {
    let out = s.replace(/,/g, '.').replace(/[^0-9.]/g, '')
    const first = out.indexOf('.')
    if (first !== -1) out = out.slice(0, first + 1) + out.slice(first + 1).replace(/\./g, '')
    return out
  }

  // Contribute to manually tracked goal
  const [contributingGoalId, setContributingGoalId] = createSignal<number | null>(null)
  const [contributeAmount, setContributeAmount] = createSignal('')

  const startContribute = (goalId: number) => {
    setContributingGoalId(goalId)
    setContributeAmount('')
  }

  const cancelContribute = () => {
    setContributingGoalId(null)
    setContributeAmount('')
  }

  const submitContribute = async (goalId: number) => {
    const parsed = parseFloat(contributeAmount())
    if (isNaN(parsed) || parsed <= 0) {
      showToast('Please enter a valid positive amount', 'error')
      return
    }
    try {
      await apiPost(`/api/savings-goals/${goalId}/contribute`, { amount: parsed })
      showToast('Contribution added', 'success')
      setContributingGoalId(null)
      setContributeAmount('')
      loadGoals()
    } catch (err) {
      console.error('Failed to contribute:', err)
      showToast('Failed to add contribution', 'error')
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
      tracking_start_date: goal.tracking_start_date || '',
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

  // Memoized chart data
  const projectionGoals = createMemo(() => goals().filter((g) => g.monthly_contribution > 0))
  const projectionMaxMonths = createMemo(() =>
    Math.max(
      ...projectionGoals().map((g) =>
        Math.ceil((g.target_amount - g.current_amount) / (g.monthly_contribution || 1))
      ),
      1
    )
  )
  const projectionLabels = createMemo(() => {
    const now = new Date()
    return Array.from({ length: projectionMaxMonths() + 1 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    })
  })

  return (
    <div data-test-id="page-goals" class={`page page-goals page-enter ${styles.goalsPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="goals-header" data-tour="goals-header">
            Savings Goals
          </h1>
          <button
            data-test-id="add-goal-btn"
            data-tour="goals-add"
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

      <div data-tour="goals-list">
        {loading() ? (
          <div class={styles.emptyState}>Loading goals...</div>
        ) : goals().length === 0 ? (
          <div data-test-id="goals-empty" class={styles.emptyState}>
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
                        {!goal.category_id && contributingGoalId() !== goal.id && (
                          <button
                            data-test-id="goal-contribute-btn"
                            class={`${styles.btnPrimary} ${styles.btnSm}`}
                            title="Add money toward this goal"
                            onclick={() => {
                              startContribute(goal.id)
                            }}
                          >
                            <svg
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                              style="margin-right:4px;vertical-align:middle"
                            >
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            Add Funds
                          </button>
                        )}
                        <span data-test-id="goal-delete-btn">
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
                        </span>
                      </div>
                    </div>
                    {contributingGoalId() === goal.id && (
                      <div class={styles.contributeForm}>
                        <input
                          type="text"
                          inputmode="decimal"
                          class={styles.formControl}
                          placeholder="Amount..."
                          value={contributeAmount()}
                          oninput={(e) =>
                            setContributeAmount(sanitizeDecimal(e.currentTarget.value))
                          }
                          onkeydown={(e) => {
                            if (e.key === 'Enter') submitContribute(goal.id)
                            if (e.key === 'Escape') cancelContribute()
                          }}
                          autofocus
                        />
                        <button
                          class={`${styles.btnPrimary} ${styles.btnSm}`}
                          onclick={() => submitContribute(goal.id)}
                        >
                          Add
                        </button>
                        <button
                          class={`${styles.btnSecondary} ${styles.btnSm}`}
                          onclick={cancelContribute}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <div data-test-id="goal-progress-bar" class={styles.goalProgress}>
                      <GoalRing
                        compact
                        name={goal.name}
                        current={goal.current_amount}
                        target={goal.target_amount}
                        deadline={goal.target_date}
                        size={116}
                      />
                      <div class={styles.progressStats}>
                        <span data-test-id="goal-progress-percent" class={styles.progressPercent}>
                          {progress}%
                        </span>
                        <span data-test-id="goal-progress-current" class={styles.progressCurrent}>
                          {formatCurrency(goal.current_amount)} of{' '}
                          <span data-test-id="goal-progress-target">
                            {formatCurrency(goal.target_amount)}
                          </span>
                        </span>
                        {goal.category_id && (
                          <p class={styles.goalTrackHint}>
                            Progress tracks automatically from your
                            {goal.category_name ? ` ${goal.category_name}` : ''} transactions — add
                            spending in that category to move it.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        )}
      </div>

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
                      // Brand progress ramp: salmon → dawn → mint → azure (met).
                      if (progress < 0.3) return '#ff9d9d'
                      if (progress < 0.6) return '#f0a860'
                      if (progress < 0.9) return '#59d2a2'
                      return '#6e9bff'
                    }),
                    borderWidth: 0,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                // Doughnuts default to radius '100%', so the ring touches the canvas edge
                // exactly and sub-pixel rounding shaves the bottom flat. Keep a margin.
                // (radius is a doughnut-controller option the generic options type lacks.)
                ...({ radius: '88%' } as Record<string, unknown>),
                layout: { padding: 6 },
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
      {projectionGoals().length > 0 && (
        <div class={styles.goalsChartSection}>
          <h3>Goal Projections</h3>
          <div class={styles.chartWrapper}>
            <Chart
              id="goals-projection-chart"
              type="line"
              data={{
                labels: projectionLabels(),
                datasets: projectionGoals().map((g, idx) => {
                  const color = CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length]
                  const monthly = g.monthly_contribution || 0
                  const remaining = g.target_amount - g.current_amount
                  // Already met (or over) the target: no months to project.
                  const monthsNeeded = remaining <= 0 ? 0 : Math.ceil(remaining / monthly)
                  const data: (number | null)[] = [g.current_amount]
                  for (let m = 1; m <= monthsNeeded; m++) {
                    data.push(Math.min(g.current_amount + monthly * m, g.target_amount))
                  }
                  // Achievement label: "reached" when already met, else the projected month.
                  const now = new Date()
                  const achieveLabel =
                    monthsNeeded <= 0
                      ? 'reached'
                      : new Date(
                          now.getFullYear(),
                          now.getMonth() + monthsNeeded,
                          1
                        ).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                  return {
                    label: `${g.name} — target ${achieveLabel}`,
                    data,
                    borderColor: color,
                    backgroundColor: `${color}20`,
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: data.map((_, i) => (i === monthsNeeded ? 4 : 0)),
                    pointBackgroundColor: data.map((_, i) =>
                      i === monthsNeeded ? color : 'transparent'
                    ),
                    pointBorderColor: data.map((_, i) =>
                      i === monthsNeeded ? '#fff' : 'transparent'
                    ),
                    pointBorderWidth: 2,
                  }
                }),
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                  intersect: false,
                  mode: 'index',
                },
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
                      text: 'Projected timeline',
                      color: chartColors().text,
                    },
                  },
                },
                plugins: {
                  legend: {
                    position: 'top',
                    labels: { color: chartColors().text, usePointStyle: true },
                  },
                  tooltip: {
                    callbacks: {
                      label: (ctx: any) => {
                        const dataset = ctx.dataset
                        const val = dataset.data[ctx.dataIndex]
                        const isLast = ctx.dataIndex === dataset.data.length - 1
                        const isPlateau =
                          !isLast &&
                          val === dataset.data[ctx.dataIndex + 1] &&
                          val === dataset.data[Math.min(ctx.dataIndex + 2, dataset.data.length - 1)]
                        let label = `${dataset.label?.split(' — ')[0] || dataset.label}: ${formatCurrency(val)}`
                        if (isLast) label += ' (goal reached)'
                        else if (isPlateau) label += ' (goal reached)'
                        return label
                      },
                    },
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
          data-test-id="goals-modal"
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
              <h3 data-test-id="goals-modal-title" class={styles.modalTitle}>
                {editingGoal() ? 'Edit Goal' : 'New Goal'}
              </h3>
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
                    tracking_start_date: '',
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
                  data-test-id="goals-form-name"
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Emergency Fund, Vacation"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  autofocus
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Target Amount</label>
                <input
                  data-test-id="goals-form-target"
                  type="text"
                  inputmode="decimal"
                  class={styles.formControl}
                  placeholder="5000.00"
                  value={formData().target_amount}
                  oninput={(e) =>
                    setFormData({
                      ...formData(),
                      target_amount: sanitizeDecimal(e.currentTarget.value),
                    })
                  }
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Target Date</label>
                <input
                  data-test-id="goals-form-date"
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
                  type="text"
                  inputmode="decimal"
                  class={styles.formControl}
                  placeholder="e.g., 500.00"
                  value={formData().monthly_contribution}
                  oninput={(e) =>
                    setFormData({
                      ...formData(),
                      monthly_contribution: sanitizeDecimal(e.currentTarget.value),
                    })
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
                <button
                  type="button"
                  class={styles.btnLink}
                  style={{ 'margin-top': '8px' }}
                  onClick={() => setShowCategoryModal(true)}
                >
                  + Add Category
                </button>
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
              {formData().category_id && (
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Count transactions from</label>
                  <input
                    type="date"
                    class={styles.formControl}
                    value={formData().tracking_start_date || new Date().toISOString().split('T')[0]}
                    oninput={(e) =>
                      setFormData({ ...formData(), tracking_start_date: e.currentTarget.value })
                    }
                  />
                  <p
                    style={{
                      'font-size': '11px',
                      color: 'var(--text-secondary)',
                      'margin-top': '4px',
                    }}
                  >
                    Only category transactions on/after this date count. Defaults to today so past
                    history doesn't fill the goal — set it earlier to include prior activity.
                  </p>
                </div>
              )}
              <div data-test-id="goals-modal-footer" class={styles.modalFooter}>
                <button
                  data-test-id="goals-modal-cancel"
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
                      tracking_start_date: '',
                    })
                  }}
                >
                  Cancel
                </button>
                <button data-test-id="goals-modal-submit" type="submit" class={styles.btnPrimary}>
                  {editingGoal() ? 'Update' : 'Create'} Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Category Modal (from goal creation) */}
      {showCategoryModal() && (
        <div
          class={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
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
              <button class={styles.modalClose} onclick={() => setShowCategoryModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onsubmit={addCategory}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Category Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Vacation Fund"
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
                  onclick={() => setShowCategoryModal(false)}
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
    </div>
  )
}
