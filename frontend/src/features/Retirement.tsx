/**
 * Retirement Component - EARS Specification
 *
 * GIVEN: A user is viewing the Retirement page
 * WHEN: The page loads
 * THEN: The header displays "Retirement" and shows the planner above their goals
 *
 * GIVEN: A user wants to change an assumption behind the projection
 * WHEN: They edit any field in the planner
 * THEN: The chart and the retirement dates redraw immediately, before anything is saved
 *
 * GIVEN: A user has accounts and transactions but has never opened the planner
 * WHEN: The page loads
 * THEN: Their net worth, income and spending are filled in from that data, each labelled
 *       with where it came from
 *
 * GIVEN: A user wants to create a retirement goal
 * WHEN: They click the "Create Goal" button
 * THEN: A goal creation modal opens with fields for goal name, target amount, and dates
 *
 * GIVEN: A user has a retirement goal
 * WHEN: They view the goal card
 * THEN: The progress bar shows current amount toward the target with a percentage
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
 * Retirement Component
 * Retirement goals, and the planner that projects what they add up to.
 */
import { createSignal, For, Show } from 'solid-js'
import Badge from '../components/Badge'
import ConfirmButton from '../components/ConfirmButton'
import { Field, FormNotice, SubmitButton } from '../components/form'
import OrbitalDivider from '../components/OrbitalDivider'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { entityVersion } from '../core/dataVersions'
import { refetchOnActive } from '../core/pageVisibility'
import { createRetirementGoalForm } from './retirementGoalForm'
import styles from './RetirementPage.module.css'
import RetirementPlanner from './RetirementPlanner'
import type { EditableRetirementGoal } from './retirementGoalForm'

/**
 * A goal as stored. A field an older version left without a value is null, and the card says so
 * rather than show a guess: a 0 % return used to be shown, and opened for editing, as 7 %.
 */
interface RetirementGoal extends EditableRetirementGoal {
  target_amount: number
  current_amount: number
  profile_id: number
}

/** A number as stored, or null for none. */
const storedNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export default function Retirement() {
  const state = useAppState()
  const [goals, setGoals] = createSignal<RetirementGoal[]>([])
  const [initialLoad, setInitialLoad] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingGoal, setEditingGoal] = createSignal<RetirementGoal | null>(null)
  const goalForm = createRetirementGoalForm({
    onSaved: () => {
      closeGoalModal()
    },
  })

  const openGoalModal = (goal: RetirementGoal | null) => {
    setEditingGoal(goal)
    goalForm.open(goal)
    setShowAddModal(true)
  }

  function closeGoalModal() {
    setShowAddModal(false)
    setEditingGoal(null)
  }

  // Load retirement goals
  const loadGoals = async () => {
    try {
      const data = await apiGet<{ settings: any; goals: Record<string, unknown>[] }>(
        '/api/retirement-goals'
      )
      setGoals(
        (data.goals || []).map((g) => ({
          id: g.id as number,
          name: typeof g.name === 'string' ? g.name : '',
          target_amount: storedNumber(g.target_amount) ?? 0,
          current_amount: storedNumber(g.current_amount) ?? 0,
          deadline: ((g.deadline || g.target_date) as string | undefined) || null,
          monthly_contribution: storedNumber(g.monthly_contribution),
          expected_return_rate: storedNumber(g.expected_return_rate),
          current_age: storedNumber(g.current_age),
          retirement_age: storedNumber(g.retirement_age),
          profile_id: (g.profile_id as number | undefined) ?? 0,
        }))
      )
    } catch (err) {
      console.error('Failed to load retirement goals', err)
      showToast('Failed to load retirement goals', 'error')
    } finally {
      setInitialLoad(false)
    }
  }

  // Delete goal
  const deleteGoal = async (id: number) => {
    try {
      await apiDelete(`/api/retirement-goals/${id}`)
      showToast('Goal deleted successfully', 'success')
    } catch (err) {
      console.error('Failed to delete retirement goal', err)
      showToast('Failed to delete retirement goal', 'error')
    }
  }

  // Get progress percentage
  const getProgress = (goal: RetirementGoal): number => {
    if (goal.target_amount === 0) return 0
    return Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
  }

  // Format date
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  // Format age
  const formatAge = (age: number): string => {
    return `${age} years old`
  }

  // Format currency
  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  // Get retirement age badge status
  const getRetirementBadgeStatus = (age: number): 'default' | 'warning' | 'info' | 'success' => {
    if (age < 40) return 'default'
    if (age < 50) return 'warning'
    if (age < 60) return 'info'
    return 'success'
  }

  // Pages stay mounted since the keep-alive host (#317), so onMount fires once for the
  // life of the session — a profile switch left this list showing the previous profile's
  // goals until the page was reloaded. Track the profile and every goal write (including resume
  // revalidation) and reload, deferred while hidden. This page's own writes bump
  // `retirement-goals` through apiFetch, so none of them reloads by hand.
  refetchOnActive(
    'retirement',
    () => [state.profileVersion, entityVersion('retirement-goals')],
    () => {
      loadGoals()
    }
  )

  return (
    <div
      class={`page page-retirement page-enter ${styles.retirementPage}`}
      data-test-id="retirement-page"
    >
      <div class={styles.pageHeader} data-test-id="retirement-page-header">
        <div class={styles.headerTop}>
          <h1 data-test-id="retirement-header" data-tour="retirement-header">
            Retirement Planning
          </h1>
          <button
            data-test-id="add-retirement-goal-btn"
            data-tour="retirement-add"
            class={styles.btnPrimary}
            onClick={() => {
              openGoalModal(null)
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Goal
          </button>
        </div>
        <p data-test-id="retirement-subtitle" class={styles.pageSubtitle}>
          Plan your retirement and track your savings progress
        </p>
      </div>

      <RetirementPlanner />

      <div class={styles.retirementContent}>
        {/* Goals Section */}
        <div
          data-test-id="retirement-goals"
          class={styles.retirementGoals}
          data-tour="retirement-goals"
        >
          <OrbitalDivider id="retirement-sec-goals" label="Retirement Goals" />
          {initialLoad() && goals().length === 0 ? (
            <div data-test-id="loading-state" class={styles.emptyState}>
              Loading goals...
            </div>
          ) : goals().length === 0 ? (
            <div class={styles.emptyState}>
              <p>No retirement goals yet</p>
              <p>Add your first retirement goal to start planning.</p>
              <button
                class={styles.btnPrimary}
                onClick={() => {
                  openGoalModal(null)
                }}
              >
                Add Goal
              </button>
            </div>
          ) : (
            <div data-test-id="retirement-goals-grid" class={styles.goalsGrid}>
              <For each={goals()}>
                {(goal) => {
                  const progress = getProgress(goal)
                  return (
                    <div data-test-id="retirement-goal-card" class={styles.goalCard}>
                      <div class={styles.goalHeader}>
                        <div data-test-id="retirement-goal-icon" class={styles.goalIcon}>
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
                          <h3 data-test-id="retirement-goal-name" class={styles.goalName}>
                            {goal.name}
                          </h3>
                          <Show when={goal.retirement_age}>
                            {(age) => (
                              <span
                                data-test-id="retirement-age-badge"
                                style={{ display: 'contents' }}
                              >
                                <Badge status={getRetirementBadgeStatus(age())}>
                                  Retire at {formatAge(age())}
                                </Badge>
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class={styles.goalActions}>
                          <button
                            data-test-id="retirement-goal-edit-btn"
                            class={`${styles.btnSm} ${styles.btnGhost}`}
                            onClick={() => {
                              openGoalModal(goal)
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
                          <span
                            data-test-id="retirement-goal-delete-btn"
                            style={{ display: 'contents' }}
                          >
                            <ConfirmButton
                              class={`${styles.btnSm} ${styles.btnGhost}`}
                              onConfirm={() => deleteGoal(goal.id)}
                              message="Delete this retirement goal? This can’t be undone."
                              aria-label="Delete retirement goal"
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
                      <div data-test-id="retirement-goal-balance" class={styles.goalBalance}>
                        <div class={styles.balanceLabel}>Current Amount</div>
                        <div class={styles.balanceValue}>{formatAmount(goal.current_amount)}</div>
                      </div>
                      <div class={styles.goalProgress}>
                        <div data-test-id="retirement-progress-bar" class={styles.progressBar}>
                          <div class={styles.progressFill} style={{ width: `${progress}%` }} />
                        </div>
                        <div class={styles.progressStats}>
                          <span
                            data-test-id="retirement-progress-percent"
                            class={styles.progressPercent}
                          >
                            {progress}%
                          </span>
                          <span
                            data-test-id="retirement-progress-target"
                            class={styles.progressTarget}
                          >
                            {formatAmount(goal.target_amount)} target
                          </span>
                        </div>
                      </div>
                      <div class={styles.goalDetails}>
                        <div data-test-id="retirement-detail-item" class={styles.detailItem}>
                          <span class={styles.detailLabel}>Monthly</span>
                          <span
                            data-test-id="retirement-monthly-contribution"
                            class={styles.detailValue}
                          >
                            {formatAmount(goal.monthly_contribution ?? 0)}
                          </span>
                        </div>
                        <div data-test-id="retirement-detail-item" class={styles.detailItem}>
                          <span class={styles.detailLabel}>Expected Return</span>
                          <span
                            data-test-id="retirement-expected-return"
                            class={styles.detailValue}
                          >
                            {goal.expected_return_rate === null
                              ? 'Not set'
                              : `${goal.expected_return_rate}%`}
                          </span>
                        </div>
                        <div data-test-id="retirement-detail-item" class={styles.detailItem}>
                          <span class={styles.detailLabel}>Target Date</span>
                          <span data-test-id="retirement-target-date" class={styles.detailValue}>
                            {goal.deadline ? formatDate(goal.deadline) : 'No target date'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div
          data-test-id="retirement-modal-overlay"
          class={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onclick={(e) => {
            if (e.target === e.currentTarget) closeGoalModal()
          }}
        >
          <div
            data-test-id="retirement-modal"
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 data-test-id="retirement-modal-title" class={styles.modalTitle}>
                {editingGoal() ? 'Edit Goal' : 'Add Retirement Goal'}
              </h3>
              <button
                data-test-id="retirement-modal-close"
                class={styles.modalClose}
                aria-label="Close"
                onClick={() => {
                  closeGoalModal()
                }}
              >
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} {...goalForm.attrs}>
              <FormNotice form={goalForm} testId="retirement-form-notice" />
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
                    type="text"
                    class={styles.formControl}
                    placeholder="e.g., Full Retirement, Early Retirement"
                    data-test-id="retirement-form-name"
                    value={goalForm.values.name}
                    onInput={(e) => goalForm.set('name', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <div class={styles.formRow}>
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
                      type="text"
                      inputmode="decimal"
                      class={styles.formControl}
                      placeholder="1000000"
                      data-test-id="retirement-form-target-amount"
                      value={goalForm.values.target_amount}
                      onInput={(e) => goalForm.set('target_amount', e.currentTarget.value)}
                      required
                    />
                  )}
                </Field>
                <Field
                  form={goalForm}
                  name="current_amount"
                  label="Current Amount"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      inputmode="decimal"
                      class={styles.formControl}
                      placeholder="50000"
                      data-test-id="retirement-form-current-amount"
                      value={goalForm.values.current_amount}
                      onInput={(e) => goalForm.set('current_amount', e.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <div class={styles.formRow}>
                <Field
                  form={goalForm}
                  name="current_age"
                  label="Current Age"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      inputmode="numeric"
                      class={styles.formControl}
                      placeholder="30"
                      data-test-id="retirement-form-current-age"
                      value={goalForm.values.current_age}
                      onInput={(e) => goalForm.set('current_age', e.currentTarget.value)}
                      required
                    />
                  )}
                </Field>
                <Field
                  form={goalForm}
                  name="retirement_age"
                  label="Retirement Age"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      inputmode="numeric"
                      class={styles.formControl}
                      placeholder="65"
                      data-test-id="retirement-form-retirement-age"
                      value={goalForm.values.retirement_age}
                      onInput={(e) => goalForm.set('retirement_age', e.currentTarget.value)}
                      required
                    />
                  )}
                </Field>
              </div>
              <div class={styles.formRow}>
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
                      type="date"
                      class={styles.formControl}
                      data-test-id="retirement-form-target-date"
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
                      type="text"
                      inputmode="decimal"
                      class={styles.formControl}
                      placeholder="500"
                      data-test-id="retirement-form-monthly-contribution"
                      value={goalForm.values.monthly_contribution}
                      onInput={(e) => goalForm.set('monthly_contribution', e.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <Field
                form={goalForm}
                name="expected_return_rate"
                label="Expected Annual Return (%)"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    inputmode="decimal"
                    class={styles.formControl}
                    placeholder="7"
                    data-test-id="retirement-form-expected-return"
                    value={goalForm.values.expected_return_rate}
                    onInput={(e) => goalForm.set('expected_return_rate', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <div data-test-id="retirement-modal-footer" class={styles.modalFooter}>
                <button
                  data-test-id="retirement-modal-cancel"
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => {
                    closeGoalModal()
                  }}
                >
                  Cancel
                </button>
                <SubmitButton
                  data-test-id="retirement-modal-submit"
                  class={styles.btnPrimary}
                  busy={goalForm.submitting()}
                  busyLabel={editingGoal() ? undefined : 'Adding…'}
                >
                  {editingGoal() ? 'Update Goal' : 'Add Goal'}
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
