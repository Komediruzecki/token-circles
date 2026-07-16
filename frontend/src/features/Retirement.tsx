/**
 * Retirement Component - EARS Specification
 *
 * GIVEN: A user is viewing the Retirement page
 * WHEN: The page loads
 * THEN: The header displays "Retirement" and shows retirement goals with progress
 *
 * GIVEN: A user wants to create a retirement goal
 * WHEN: They click the "Create Goal" button
 * THEN: A goal creation modal opens with fields for goal name, target amount, and dates
 *
 * GIVEN: A user has a retirement goal
 * WHEN: They view the goal card
 * THEN: The progress bar shows current amount toward the target with a percentage
 *
 * GIVEN: A user views the projection
 * WHEN: They have valid retirement goal data
 * THEN: The projection shows projected retirement income and total accumulated wealth
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
 * Tracks retirement savings, calculates projected growth, and sets retirement goals
 */
import { createSignal, For, onMount } from 'solid-js'
import Badge from '../components/Badge'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import OrbitalDivider from '../components/OrbitalDivider'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../core/api'
import { theme } from '../core/theme'
import styles from './RetirementPage.module.css'

interface RetirementGoal {
  id: number
  name: string
  target_amount: number
  current_amount: number
  target_date: string
  monthly_contribution: number
  expected_return_rate: number
  current_age: number
  retirement_age: number
  profile_id: number
}

interface RetirementProjection {
  current_age: number
  retirement_age: number
  annual_contribution: number
  expected_return: number
  years_to_retire: number
  projected_total: number
  projected_income: number
  monthly_income_in_retirement: number
}

interface ProjectedBalance {
  age: number
  balance: number
  cumulative: number
  annual_contribution: number
}

export default function Retirement() {
  const [goals, setGoals] = createSignal<RetirementGoal[]>([])
  const [projection, setProjection] = createSignal<RetirementProjection | null>(null)
  const [projectedBalances, setProjectedBalances] = createSignal<ProjectedBalance[]>([])
  const [initialLoad, setInitialLoad] = createSignal(true)
  const chartColors = () => theme.getChartColors()
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingGoal, setEditingGoal] = createSignal<RetirementGoal | null>(null)
  const [formData, setFormData] = createSignal({
    name: '',
    target_amount: '',
    current_amount: '',
    target_date: '',
    monthly_contribution: '',
    expected_return_rate: '',
    current_age: '',
    retirement_age: '',
  })

  // Load retirement goals
  const loadGoals = async () => {
    try {
      const data = await apiGet<{ settings: any; goals: RetirementGoal[] }>('/api/retirement-goals')
      setGoals(
        (data.goals || []).map((g: any) => ({
          id: g.id,
          name: g.name || '',
          target_amount: g.target_amount || 0,
          current_amount: g.current_amount || 0,
          target_date: g.deadline || g.target_date || '',
          monthly_contribution: g.monthly_contribution || 0,
          expected_return_rate: g.expected_return_rate || 7,
          current_age: g.current_age || 30,
          retirement_age: g.retirement_age || 65,
          profile_id: g.profile_id || 0,
        }))
      )
    } catch (err) {
      console.error('Failed to load retirement goals', err)
      showToast('Failed to load retirement goals', 'error')
    } finally {
      setInitialLoad(false)
    }
  }

  // Load projection
  const loadProjection = async () => {
    try {
      const res = await apiGet<RetirementProjection & { current_amount: number }>(
        '/api/retirement/projection'
      )
      setProjection(res)

      // Calculate detailed projection
      if (res) {
        const balances: ProjectedBalance[] = []
        let cumulative = res.current_amount
        const age = res.current_age

        for (let y = 0; y <= res.years_to_retire; y++) {
          const year = age + y
          cumulative += res.annual_contribution * Math.pow(1 + res.expected_return / 100, y)
          balances.push({
            age: year,
            balance: cumulative,
            cumulative: cumulative,
            annual_contribution: res.annual_contribution,
          })
        }
        setProjectedBalances(balances)
      }
    } catch (err) {
      console.error('Failed to load projection', err)
      showToast('Failed to load retirement projection', 'error')
    }
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      target_amount: parseFloat(formData().target_amount),
      current_amount: parseFloat(formData().current_amount),
      target_date: formData().target_date,
      monthly_contribution: parseFloat(formData().monthly_contribution),
      expected_return_rate: parseFloat(formData().expected_return_rate),
      current_age: parseInt(formData().current_age),
      retirement_age: parseInt(formData().retirement_age),
    }

    try {
      if (editingGoal()) {
        await apiPut(`/api/retirement-goals/${editingGoal()!.id}`, data)
      } else {
        await apiPost('/api/retirement-goals', data)
      }
      showToast(
        editingGoal() ? 'Goal updated successfully' : 'Goal created successfully',
        'success'
      )
      setShowAddModal(false)
      setEditingGoal(null)
      setFormData({
        name: '',
        target_amount: '',
        current_amount: '',
        target_date: '',
        monthly_contribution: '',
        expected_return_rate: '',
        current_age: '',
        retirement_age: '',
      })
      loadGoals()
      loadProjection()
    } catch (err) {
      console.error('Failed to save retirement goal', err)
      showToast('Failed to save retirement goal', 'error')
    }
  }

  // Delete goal
  const deleteGoal = async (id: number) => {
    try {
      await apiDelete(`/api/retirement-goals/${id}`)
      showToast('Goal deleted successfully', 'success')
      loadGoals()
      loadProjection()
    } catch (err) {
      console.error('Failed to delete retirement goal', err)
      showToast('Failed to delete retirement goal', 'error')
    }
  }

  // Open edit modal
  const editGoal = (goal: RetirementGoal) => {
    setEditingGoal(goal)
    setFormData({
      name: goal.name,
      target_amount: goal.target_amount.toString(),
      current_amount: goal.current_amount.toString(),
      target_date: goal.target_date.slice(0, 10),
      monthly_contribution: goal.monthly_contribution.toString(),
      expected_return_rate: goal.expected_return_rate.toString(),
      current_age: goal.current_age.toString(),
      retirement_age: goal.retirement_age.toString(),
    })
    setShowAddModal(true)
  }

  // Calculate years until retirement
  const yearsUntil = (): number => {
    if (!projection()) return 0
    return projection()!.years_to_retire
  }

  // Calculate months until retirement
  const monthsUntil = (): number => {
    return yearsUntil() * 12
  }

  // Get total contributed
  const totalContributed = (): number => {
    const years = yearsUntil()
    if (!projection()) return 0
    return years * projection()!.annual_contribution
  }

  // Get remaining to save
  const remainingToSave = (): number => {
    if (!projection()) return 0
    return (projection() as any).projected_total - (projection() as any).current_amount
  }

  // Calculate growth
  const calculateGrowth = (): number => {
    if (!projection()) return 0
    return (
      (projection() as any).projected_total -
      (projection() as any).current_amount -
      totalContributed()
    )
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

  onMount(() => {
    loadGoals()
    loadProjection()
  })

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
            onClick={() => setShowAddModal(true)}
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

      {/* Projected Balances Chart */}
      <OrbitalDivider id="retirement-sec-projections" label="Projected Balances Over Time" />
      <div class={styles.retirementProjections} data-test-id="retirement-projections">
        {projection() ? (
          <div data-test-id="retirement-chart">
            <Chart
              id="retirement-projection-chart"
              type="line"
              data={{
                labels: projectedBalances().map((pb) => pb.age.toString()),
                datasets: [
                  {
                    label: 'Projected Balance',
                    data: projectedBalances().map((pb) => pb.balance),
                    borderColor: '#59d2a2',
                    backgroundColor: 'rgba(89, 210, 162, 0.12)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Age',
                      color: chartColors().text,
                    },
                    ticks: {
                      stepSize: 5,
                      color: chartColors().text,
                    },
                    grid: { color: chartColors().border },
                  },
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (value: any) => formatAmount(value),
                      color: chartColors().text,
                    },
                    grid: { color: chartColors().border },
                  },
                },
                plugins: {
                  legend: {
                    display: true,
                    labels: {
                      usePointStyle: true,
                      padding: 15,
                      font: { size: 12 },
                      color: chartColors().text,
                    },
                  },
                  tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                      label: (context: any) => {
                        const age = context.label
                        const balance = formatAmount(context.raw)
                        return `${age} years: ${balance}`
                      },
                    },
                  },
                },
              }}
              height={250}
              width="100%"
            />
          </div>
        ) : (
          <div class={styles.emptyState}>Loading projection...</div>
        )}
      </div>

      <div class={styles.retirementContent}>
        {/* Projection Cards */}
        <div class={styles.retirementProjection}>
          {projection() && (
            <>
              <div data-test-id="retirement-projection-row" class={styles.projectionRow}>
                <div class={`${styles.projectionCard} ${styles.primary}`}>
                  <div class={styles.cardLabel}>Projected Total</div>
                  <div class={styles.cardValue}>{formatAmount(projection()!.projected_total)}</div>
                  <div class={styles.cardSub}>At age {projection()!.retirement_age}</div>
                </div>
                <div class={styles.projectionCard}>
                  <div class={styles.cardLabel}>Years to Retire</div>
                  <div class={styles.cardValue}>{yearsUntil()} years</div>
                  <div class={styles.cardSub}>{monthsUntil()} months</div>
                </div>
                <div class={styles.projectionCard}>
                  <div class={styles.cardLabel}>Monthly Contribution</div>
                  <div class={styles.cardValue}>
                    {formatAmount(projection()!.annual_contribution / 12)}
                  </div>
                  <div class={styles.cardSub}>
                    {formatAmount(projection()!.annual_contribution)}/year
                  </div>
                </div>
                <div class={styles.projectionCard}>
                  <div class={styles.cardLabel}>Expected Return</div>
                  <div class={styles.cardValue}>{projection()!.expected_return}%</div>
                  <div class={styles.cardSub}>Annual average</div>
                </div>
              </div>
              <div data-test-id="retirement-projection-details" class={styles.projectionDetails}>
                <div class={styles.detailRow}>
                  <span class={styles.detailLabel}>Current Savings</span>
                  <span class={styles.detailValue}>
                    {formatAmount((projection() as any).current_amount)}
                  </span>
                </div>
                <div class={styles.detailRow}>
                  <span class={styles.detailLabel}>Total Contributions</span>
                  <span class={styles.detailValue}>{formatAmount(totalContributed())}</span>
                </div>
                <div class={styles.detailRow}>
                  <span class={styles.detailLabel}>Investment Growth</span>
                  <span class={`${styles.detailValue} ${styles.positive}`}>
                    {formatAmount(calculateGrowth())}
                  </span>
                </div>
                <div class={styles.detailRow}>
                  <span class={styles.detailLabel}>Remaining to Save</span>
                  <span
                    class={`${styles.detailValue} ${remainingToSave() > 0 ? styles.positive : ''}`}
                  >
                    {formatAmount(remainingToSave())}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

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
              <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
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
                          <span data-test-id="retirement-age-badge" style={{ display: 'contents' }}>
                            <Badge status={getRetirementBadgeStatus(goal.retirement_age)}>
                              Retire at {formatAge(goal.retirement_age)}
                            </Badge>
                          </span>
                        </div>
                        <div class={styles.goalActions}>
                          <button
                            data-test-id="retirement-goal-edit-btn"
                            class={`${styles.btnSm} ${styles.btnGhost}`}
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
                          <span
                            data-test-id="retirement-goal-delete-btn"
                            style={{ display: 'contents' }}
                          >
                            <ConfirmButton
                              class={`${styles.btnSm} ${styles.btnGhost}`}
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
                            {formatAmount(goal.monthly_contribution)}
                          </span>
                        </div>
                        <div data-test-id="retirement-detail-item" class={styles.detailItem}>
                          <span class={styles.detailLabel}>Expected Return</span>
                          <span
                            data-test-id="retirement-expected-return"
                            class={styles.detailValue}
                          >
                            {goal.expected_return_rate}%
                          </span>
                        </div>
                        <div data-test-id="retirement-detail-item" class={styles.detailItem}>
                          <span class={styles.detailLabel}>Target Date</span>
                          <span data-test-id="retirement-target-date" class={styles.detailValue}>
                            {formatDate(goal.target_date)}
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
            if (e.target === e.currentTarget) {
              setShowAddModal(false)
              setEditingGoal(null)
              setFormData({
                name: '',
                target_amount: '',
                current_amount: '',
                target_date: '',
                monthly_contribution: '',
                expected_return_rate: '',
                current_age: '',
                retirement_age: '',
              })
            }
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
                onClick={() => {
                  setShowAddModal(false)
                  setEditingGoal(null)
                  setFormData({
                    name: '',
                    target_amount: '',
                    current_amount: '',
                    target_date: '',
                    monthly_contribution: '',
                    expected_return_rate: '',
                    current_age: '',
                    retirement_age: '',
                  })
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
                  placeholder="e.g., Full Retirement, Early Retirement"
                  data-test-id="retirement-form-name"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Target Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    placeholder="1000000"
                    data-test-id="retirement-form-target-amount"
                    value={formData().target_amount}
                    oninput={(e) => setFormData({ ...formData(), target_amount: e.target.value })}
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Current Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    placeholder="50000"
                    data-test-id="retirement-form-current-amount"
                    value={formData().current_amount}
                    oninput={(e) => setFormData({ ...formData(), current_amount: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Current Age</label>
                  <input
                    type="number"
                    min="18"
                    max="100"
                    class={styles.formControl}
                    placeholder="30"
                    data-test-id="retirement-form-current-age"
                    value={formData().current_age}
                    oninput={(e) => setFormData({ ...formData(), current_age: e.target.value })}
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Retirement Age</label>
                  <input
                    type="number"
                    min="18"
                    max="100"
                    class={styles.formControl}
                    placeholder="65"
                    data-test-id="retirement-form-retirement-age"
                    value={formData().retirement_age}
                    oninput={(e) => setFormData({ ...formData(), retirement_age: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Target Date</label>
                  <input
                    type="date"
                    class={styles.formControl}
                    data-test-id="retirement-form-target-date"
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
                    placeholder="500"
                    data-test-id="retirement-form-monthly-contribution"
                    value={formData().monthly_contribution}
                    oninput={(e) =>
                      setFormData({ ...formData(), monthly_contribution: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Expected Annual Return (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="20"
                  class={styles.formControl}
                  placeholder="7"
                  data-test-id="retirement-form-expected-return"
                  value={formData().expected_return_rate}
                  oninput={(e) =>
                    setFormData({ ...formData(), expected_return_rate: e.target.value })
                  }
                  required
                />
              </div>
              <div data-test-id="retirement-modal-footer" class={styles.modalFooter}>
                <button
                  data-test-id="retirement-modal-cancel"
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingGoal(null)
                    setFormData({
                      name: '',
                      target_amount: '',
                      current_amount: '',
                      target_date: '',
                      monthly_contribution: '',
                      expected_return_rate: '',
                      current_age: '',
                      retirement_age: '',
                    })
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-test-id="retirement-modal-submit"
                  class={styles.btnPrimary}
                >
                  {editingGoal() ? 'Update' : 'Add'} Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
