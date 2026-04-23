/**
 * Retirement Component
 * Tracks retirement savings, calculates projected growth, and sets retirement goals
 */
import { createSignal, onMount } from 'solid-js'
import styles from '../components/RetirementPage.module.css'
import { formatCurrency } from '../core/api'
import Chart from '../components/Chart'

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
  const [loading, setLoading] = createSignal(true)
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
    setLoading(true)
    try {
      const response = await fetch('/api/retirement-goals')
      const data = await response.json()
      setGoals(data)
    } catch {
      console.error('Failed to load retirement goals')
    } finally {
      setLoading(false)
    }
  }

  // Load projection
  const loadProjection = async () => {
    try {
      const res = await fetch('/api/retirement/projection').then(r => r.json())
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
    } catch {
      console.error('Failed to load projection')
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
      await fetch('/api/retirement-goals', {
        method: editingGoal() ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
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
    } catch (error) {
      console.error('Failed to save retirement goal', error)
    }
  }

  // Delete goal
  const deleteGoal = async (id: number) => {
    if (!confirm('Are you sure you want to delete this retirement goal?')) return
    try {
      await fetch(`/api/retirement-goals/${id}`, { method: 'DELETE' })
      loadGoals()
      loadProjection()
    } catch (error) {
      console.error('Failed to delete retirement goal', error)
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
    return (projection() as any).projected_total - (projection() as any).current_amount - totalContributed()
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

  // Get retirement age status
  const getRetirementStatus = (age: number): string => {
    if (age < 40) return 'badge-default'
    if (age < 50) return 'badge-warning'
    if (age < 60) return 'badge-info'
    return 'badge-success'
  }

  onMount(() => {
    loadGoals()
    loadProjection()
  })

  return (
    <div class={`page page-retirement page-enter ${styles.retirementPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1>Retirement Planning</h1>
          <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Goal
          </button>
        </div>
        <p class={styles.pageSubtitle}>Plan your retirement and track your savings progress</p>
      </div>

      {/* Projection Cards */}
      <div class={styles.retirementProjection}>
        {projection() && (
          <>
            <div class={styles.projectionRow}>
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
                <div class={styles.cardValue}>{formatAmount(projection()!.annual_contribution / 12)}</div>
                <div class={styles.cardSub}>${projection()!.annual_contribution}/year</div>
              </div>
              <div class={styles.projectionCard}>
                <div class={styles.cardLabel}>Expected Return</div>
                <div class={styles.cardValue}>{projection()!.expected_return}%</div>
                <div class={styles.cardSub}>Annual average</div>
              </div>
            </div>
            <div class={styles.projectionDetails}>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Current Savings</span>
                <span class={styles.detailValue}>{formatAmount((projection() as any).current_amount)}</span>
              </div>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Total Contributions</span>
                <span class={styles.detailValue}>{formatAmount(totalContributed())}</span>
              </div>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Investment Growth</span>
                <span class={`${styles.detailValue} ${styles.positive}`}>{formatAmount(calculateGrowth())}</span>
              </div>
              <div class={styles.detailRow}>
                <span class={styles.detailLabel}>Remaining to Save</span>
                <span class={`${styles.detailValue} ${remainingToSave() > 0 ? 'positive' : ''}`}>
                  {formatAmount(remainingToSave())}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Goals Section */}
      <div class={styles.retirementGoals}>
        <h2 class={styles.sectionTitle}>Retirement Goals</h2>
        {loading() ? (
          <div class={styles.emptyState}>Loading goals...</div>
        ) : goals().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No retirement goals yet</p>
            <p>Add your first retirement goal to start planning.</p>
            <button class={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
              Add Goal
            </button>
          </div>
        ) : (
          <div class={styles.goalsGrid}>
            {Array.isArray(goals()) && goals().map((goal) => {
              const progress = getProgress(goal)
              return (
                <div class={styles.goalCard}>
                  <div class={styles.goalHeader}>
                    <div class={styles.goalIcon}>🎯</div>
                    <div class={styles.goalInfo}>
                      <h3 class={styles.goalName}>{goal.name}</h3>
                      <span class={`badge ${getRetirementStatus(goal.retirement_age)}`}>Retire at {formatAge(goal.retirement_age)}</span>
                    </div>
                    <div class={styles.goalActions}>
                      <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => { editGoal(goal); }}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => deleteGoal(goal.id)}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class={styles.goalBalance}>
                    <div class={styles.balanceLabel}>Current Amount</div>
                    <div class={styles.balanceValue}>{formatAmount(goal.current_amount)}</div>
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
                      <span class={styles.progressTarget}>{formatAmount(goal.target_amount)} target</span>
                    </div>
                  </div>
                  <div class={styles.goalDetails}>
                    <div class={styles.detailItem}>
                      <span class={styles.detailLabel}>Monthly</span>
                      <span class={styles.detailValue}>{formatAmount(goal.monthly_contribution)}</span>
                    </div>
                    <div class={styles.detailItem}>
                      <span class={styles.detailLabel}>Expected Return</span>
                      <span class={styles.detailValue}>{goal.expected_return_rate}%</span>
                    </div>
                    <div class={styles.detailItem}>
                      <span class={styles.detailLabel}>Target Date</span>
                      <span class={styles.detailValue}>{formatDate(goal.target_date)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Projections Section */}
      <div class={styles.retirementProjections}>
        <h2 class={styles.sectionTitle}>Projected Balances Over Time</h2>
        {projection() ? (
          <Chart
            id="retirement-projection-chart"
            type="line"
            data={{
              labels: projectedBalances().map((pb) => pb.age.toString()),
              datasets: [{
                label: 'Projected Balance',
                data: projectedBalances().map((pb) => pb.balance),
                borderColor: '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 6
              }]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  title: {
                    display: true,
                    text: 'Age'
                  },
                  ticks: {
                    stepSize: 5
                  }
                },
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: (value: any) => formatAmount(value)
                  }
                }
              },
              plugins: {
                legend: {
                  display: true,
                  labels: {
                    usePointStyle: true,
                    padding: 15,
                    font: { size: 12 }
                  }
                },
                tooltip: {
                  mode: 'index',
                  intersect: false,
                  callbacks: {
                    label: (context: any) => {
                      const age = context.label
                      const balance = formatAmount(context.raw)
                      return `${age} years: ${balance}`
                    }
                  }
                }
              }
            }}
            height={250}
            width="100%"
          />
        ) : (
          <div class={styles.emptyState}>Loading projection...</div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div class={styles.modalOverlay} onclick={(e) => { if (e.target === e.currentTarget) { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', current_amount: '', target_date: '', monthly_contribution: '', expected_return_rate: '', current_age: '', retirement_age: '' }) }}}>
          <div class={styles.modal} onclick={(e) => { e.stopPropagation(); }}>
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>{editingGoal() ? 'Edit Goal' : 'Add Retirement Goal'}</h3>
              <button class={styles.modalClose} onClick={() => { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', current_amount: '', target_date: '', monthly_contribution: '', expected_return_rate: '', current_age: '', retirement_age: '' }) }}>
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
                    value={formData().monthly_contribution}
                    oninput={(e) => setFormData({ ...formData(), monthly_contribution: e.target.value })}
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
                  value={formData().expected_return_rate}
                  oninput={(e) => setFormData({ ...formData(), expected_return_rate: e.target.value })}
                  required
                />
              </div>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={() => { setShowAddModal(false); setEditingGoal(null); setFormData({ name: '', target_amount: '', current_amount: '', target_date: '', monthly_contribution: '', expected_return_rate: '', current_age: '', retirement_age: '' }) }}>
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
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
