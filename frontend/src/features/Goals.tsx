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
import { createMemo, createSignal, For } from 'solid-js'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import { Field, FormNotice, SubmitButton } from '../components/form'
import GoalRing from '../components/GoalRing'
import OrbitalDivider from '../components/OrbitalDivider'
import { formatCurrency } from '../core/api'
import { apiDelete, apiHouseholdGet, showToast } from '../core/api'
import { plainMessage } from '../core/apiError'
import { useAppState } from '../core/appStore'
import { CATEGORY_PALETTE } from '../core/brandPalette'
import { entityVersion } from '../core/dataVersions'
import { refetchOnActive } from '../core/pageVisibility'
import { theme } from '../core/theme'
import { localToday } from '../utils/period'
import { createCategoryForm } from './categoryForm'
import { createContributionForm, createGoalForm } from './goalForm'
import styles from './GoalsPage.module.css'
import type { CategoryFormValues } from './categoryForm'

interface Goal {
  id: number
  name: string
  target_amount: number
  current_amount: number
  monthly_contribution: number
  /** The target date, or null: a goal need not have one (savings_goals.deadline is nullable). */
  target_date: string | null
  tracking_start_date?: string | null
  profile_id: number
  created_at: string
  category_id?: number | null
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
  const [initialLoad, setInitialLoad] = createSignal(true)
  const chartColors = () => theme.getChartColors()
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [showCategoryModal, setShowCategoryModal] = createSignal(false)
  // The "+ Add Category" dialog over the goal form. What a save does, and what it says when the
  // save is refused, is categoryForm.ts, shared with Categories, Budgets and Bills. No reload after
  // a save: the POST bumped the categories counter, which the effect below tracks.
  const categoryForm = createCategoryForm({
    color: '#6e9bff',
    onSaved: () => setShowCategoryModal(false),
  })
  const openCategoryModal = () => {
    categoryForm.open()
    setShowCategoryModal(true)
  }
  // The goal the dialog edits, or null for a new one: its title and its button say which.
  const [editingGoal, setEditingGoal] = createSignal<Goal | null>(null)
  const closeGoalModal = () => {
    setShowAddModal(false)
    setEditingGoal(null)
  }
  // The dialog's values, field errors and notice (components/form), and its save
  // (features/goalForm.ts). A refused save is said in the dialog, under the field it is about.
  const goalForm = createGoalForm({ onSaved: closeGoalModal })
  const openNewGoal = () => {
    setEditingGoal(null)
    goalForm.open()
    setShowAddModal(true)
  }

  // Load goals
  const loadGoals = async () => {
    try {
      const data = await apiHouseholdGet<any[]>('/api/savings-goals')
      setGoals(
        data.map((s) => ({
          id: s.id,
          name: s.name,
          target_amount: s.target_amount || 0,
          current_amount: s.current_amount || 0,
          monthly_contribution: s.monthly_contribution || 0,
          target_date: s.deadline || s.target_date || null,
          profile_id: s.profile_id,
          created_at: s.created_at,
          category_id: s.category_id || null,
          tracking_start_date: s.tracking_start_date || null,
        }))
      )
    } catch (err) {
      console.error('Failed to load goals:', err)
      showToast(plainMessage(err, "Couldn't load your goals. Reload to try again."), 'error')
    } finally {
      setInitialLoad(false)
    }
  }

  // Load categories for selector
  const loadCategories = async () => {
    try {
      const cats = await apiHouseholdGet<any[]>('/api/categories')
      setCategories(cats)
    } catch {
      // categories remain empty
    }
  }

  /**
   * A goal's category name, read off the loaded list rather than baked into the goal when it was
   * fetched. Goals used to fetch the whole category list a second time just to build that map,
   * which doubled the page's category traffic and froze the name at fetch time — a rename on the
   * Categories page left the old one on screen.
   */
  const categoryNameOf = (goal: Goal): string | undefined =>
    goal.category_id ? categories().find((c) => c.id === goal.category_id)?.name : undefined

  // Delete goal
  const deleteGoal = async (id: number) => {
    try {
      await apiDelete(`/api/savings-goals/${id}`)
      showToast('Goal deleted successfully', 'success')
    } catch (err) {
      console.error('Failed to delete goal:', err)
      showToast(plainMessage(err, "Couldn't delete the goal. Try again."), 'error')
    }
  }

  // "Add Funds" on a goal tracked by hand, open on one goal's card at a time. What it checks and
  // says is goalForm.ts; a refused amount is said under the amount.
  const [contributingGoalId, setContributingGoalId] = createSignal<number | null>(null)
  const cancelContribute = () => setContributingGoalId(null)
  const contributionForm = createContributionForm({ onSaved: cancelContribute })
  const startContribute = (goal: Goal) => {
    contributionForm.open(goal)
    setContributingGoalId(goal.id)
  }

  // Open edit modal
  const editGoal = (goal: Goal) => {
    setEditingGoal(goal)
    goalForm.open(goal)
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

  // Load on mount, and reload on a profile change or a goal write from anywhere (including
  // resume revalidation) — but only while visible. A hidden page defers its refetch until it is
  // next shown (keep-alive fan-out guard). This page's own writes, contributions included, bump
  // `savings-goals` through apiFetch, so none of them reloads by hand. A goal linked to a
  // category counts that category's transactions — the list endpoint recomputes it on every
  // read, in the worker and the local handler alike — so a transaction write moves it too.
  refetchOnActive(
    'goals',
    () => [state.profileVersion, entityVersion('savings-goals'), entityVersion('transactions')],
    () => {
      loadGoals()
    }
  )
  // Categories additionally follow writes made anywhere else — the Categories page, or another
  // page's inline create modal. Tracked separately from the goals load so a category write
  // refreshes only the selector, not the whole page.
  refetchOnActive(
    'goals',
    () => [state.profileVersion, entityVersion('categories')],
    () => {
      loadCategories()
    }
  )

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
            onclick={openNewGoal}
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
        {initialLoad() && goals().length === 0 ? (
          <div class={styles.emptyState}>Loading goals...</div>
        ) : goals().length === 0 ? (
          <div data-test-id="goals-empty" class={styles.emptyState}>
            <p>No goals yet</p>
            <p>Create your first savings goal to start tracking.</p>
            <button class={styles.btnPrimary} onclick={openNewGoal}>
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
                          {goal.target_date
                            ? `${formatDate(goal.target_date)} • ${daysUntil(goal.target_date)}`
                            : 'No target date'}
                          {categoryNameOf(goal) && (
                            <span class={styles.goalCategory}> • {categoryNameOf(goal)}</span>
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
                        <span data-test-id="goal-delete-btn">
                          <ConfirmButton
                            class={styles.btnSm}
                            onConfirm={() => deleteGoal(goal.id)}
                            message="Delete this savings goal? This can’t be undone."
                            aria-label="Delete goal"
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
                    {/* The CTA lives on its own row — inside the header it squeezed the
                        title/date column into vertical slivers on narrow cards. */}
                    {!goal.category_id && contributingGoalId() !== goal.id && (
                      <div class={styles.goalCta}>
                        <button
                          data-test-id="goal-contribute-btn"
                          class={`${styles.btnPrimary} ${styles.btnSm} ${styles.goalCtaBtn}`}
                          title="Add money toward this goal"
                          onclick={() => {
                            startContribute(goal)
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
                      </div>
                    )}
                    {contributingGoalId() === goal.id && (
                      <form
                        data-test-id="goal-contribute-form"
                        class={styles.contributeForm}
                        {...contributionForm.attrs}
                      >
                        <FormNotice form={contributionForm} testId="goal-contribute-notice" />
                        <div class={styles.contributeRow}>
                          <Field
                            form={contributionForm}
                            name="amount"
                            label={`Amount to add to ${goal.name}`}
                            class={styles.contributeField}
                            labelClass={styles.visuallyHidden}
                          >
                            {(control) => (
                              <input
                                {...control}
                                data-test-id="goal-contribute-amount"
                                type="text"
                                inputmode="decimal"
                                class={styles.formControl}
                                placeholder="Amount..."
                                value={contributionForm.values.amount}
                                onInput={(e) =>
                                  contributionForm.set('amount', e.currentTarget.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') cancelContribute()
                                }}
                                autofocus
                              />
                            )}
                          </Field>
                          <SubmitButton
                            class={`${styles.btnPrimary} ${styles.btnSm}`}
                            busy={contributionForm.submitting()}
                            busyLabel="Adding…"
                          >
                            Add
                          </SubmitButton>
                          <button
                            type="button"
                            class={`${styles.btnSecondary} ${styles.btnSm}`}
                            onClick={cancelContribute}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
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
                            {categoryNameOf(goal) ? ` ${categoryNameOf(goal)}` : ''} transactions —
                            add spending in that category to move it.
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

      {/* Goals Progress — an orbital ring per goal */}
      {goals().length > 0 && (
        <>
          <OrbitalDivider id="goals-sec-progress" label="Goals Progress" />
          <div class={styles.goalsChartSection}>
            <div class={styles.progressRings}>
              <For each={goals()}>
                {(g) => (
                  <GoalRing
                    name={g.name}
                    current={g.current_amount}
                    target={g.target_amount}
                    deadline={g.target_date}
                  />
                )}
              </For>
            </div>
          </div>
        </>
      )}

      {/* Goal Projection Timeline */}
      {projectionGoals().length > 0 && (
        <>
          <OrbitalDivider id="goals-sec-projections" label="Goal Projections" />
          <div class={styles.goalsChartSection}>
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
                            val ===
                              dataset.data[Math.min(ctx.dataIndex + 2, dataset.data.length - 1)]
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
        </>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div
          data-test-id="goals-modal"
          class={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onclick={(e) => {
            if (e.target === e.currentTarget) closeGoalModal()
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
              <button class={styles.modalClose} onclick={closeGoalModal}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} {...goalForm.attrs}>
              <FormNotice form={goalForm} testId="goals-form-notice" />
              <Field
                form={goalForm}
                name="name"
                label="Goal Name"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    data-test-id="goals-form-name"
                    type="text"
                    class={styles.formControl}
                    placeholder="e.g., Emergency Fund, Vacation"
                    value={goalForm.values.name}
                    onInput={(e) => goalForm.set('name', e.currentTarget.value)}
                    autofocus
                    required
                  />
                )}
              </Field>
              <Field
                form={goalForm}
                name="target_amount"
                label="Target Amount"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    data-test-id="goals-form-target"
                    type="text"
                    inputmode="decimal"
                    class={styles.formControl}
                    placeholder="5000.00"
                    value={goalForm.values.target_amount}
                    onInput={(e) => goalForm.set('target_amount', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={goalForm}
                name="deadline"
                label="Target Date (optional)"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    data-test-id="goals-form-date"
                    type="date"
                    class={styles.formControl}
                    value={goalForm.values.deadline}
                    onInput={(e) => goalForm.set('deadline', e.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                form={goalForm}
                name="monthly_contribution"
                label="Monthly Contribution"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    data-test-id="goals-form-monthly"
                    type="text"
                    inputmode="decimal"
                    class={styles.formControl}
                    placeholder="e.g., 500.00"
                    value={goalForm.values.monthly_contribution}
                    onInput={(e) => goalForm.set('monthly_contribution', e.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                form={goalForm}
                name="category_id"
                label="Linked Category (optional)"
                class={styles.formGroup}
                labelClass={styles.formLabel}
                hint="Transactions to this category will count toward goal progress"
              >
                {(control) => (
                  <>
                    <select
                      {...control}
                      data-test-id="goals-form-category"
                      class={styles.formControl}
                      value={goalForm.values.category_id}
                      onInput={(e) => goalForm.set('category_id', e.currentTarget.value)}
                    >
                      <option value="">None — manual tracking</option>
                      <For each={categories()}>
                        {(cat) => (
                          <option
                            value={String(cat.id)}
                            selected={String(cat.id) === goalForm.values.category_id}
                          >
                            {cat.name} ({cat.type})
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
              {goalForm.values.category_id && (
                <Field
                  form={goalForm}
                  name="tracking_start_date"
                  label="Count transactions from"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                  hint="Only category transactions on/after this date count. Defaults to today so past history doesn't fill the goal — set it earlier to include prior activity."
                >
                  {(control) => (
                    <input
                      {...control}
                      type="date"
                      class={styles.formControl}
                      value={goalForm.values.tracking_start_date || localToday()}
                      onInput={(e) => goalForm.set('tracking_start_date', e.currentTarget.value)}
                    />
                  )}
                </Field>
              )}
              <div data-test-id="goals-modal-footer" class={styles.modalFooter}>
                <button
                  data-test-id="goals-modal-cancel"
                  type="button"
                  class={styles.btnSecondary}
                  onclick={closeGoalModal}
                >
                  Cancel
                </button>
                <SubmitButton
                  data-test-id="goals-modal-submit"
                  class={styles.btnPrimary}
                  busy={goalForm.submitting()}
                  busyLabel={editingGoal() ? 'Saving…' : 'Creating…'}
                >
                  {editingGoal() ? 'Update' : 'Create'} Goal
                </SubmitButton>
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
                    placeholder="e.g., Vacation Fund"
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
                  onclick={() => setShowCategoryModal(false)}
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
    </div>
  )
}
