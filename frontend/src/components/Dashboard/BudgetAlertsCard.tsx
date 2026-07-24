/**
 * Budget Alerts Card Component
 * Shows budget alerts for the current period — fetches from API
 */
import { createResource, For } from 'solid-js'
import { apiHouseholdGet, formatCurrency, getLocalCurrency } from '../../core/api'
import { useAppState } from '../../core/appStore'
import styles from './BudgetAlertsCard.module.css'

// Format money in the user's selected currency (not the EUR default of formatCurrency).
const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

interface BudgetAlert {
  categoryName: string
  categoryColor: string
  categoryIcon?: string
  budgetAmount: number
  spent: number
  remaining: number
  percentage: number
  status: 'over' | 'warning' | 'ok'
}

export default function BudgetAlertsCard() {
  const state = useAppState()
  const [alertsResource] = createResource(
    () => state.profileVersion,
    async () => {
      const data = (await apiHouseholdGet<{ alerts: BudgetAlert[] }>(
        '/api/budgets/alerts?threshold=80'
      )) as any
      return data?.alerts && Array.isArray(data.alerts) ? data.alerts : []
    }
  )
  const loading = () => alertsResource.loading
  const alerts = () => alertsResource() ?? []

  const statusClass = (status: string) => {
    if (status === 'over') return styles.over
    if (status === 'warning') return styles.warning
    return styles.ok
  }

  return (
    <div class={styles.alertsContainer}>
      {loading() ? (
        <div class={styles.emptyMsg}>Loading...</div>
      ) : alerts().length === 0 ? (
        <div class={`${styles.alertItem} ${styles.ok}`}>
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div class={styles.alertContent}>
            <div class={styles.alertTitle}>All budgets within limits</div>
            <div class={styles.alertDescription}>You're on track to meet all your budget goals</div>
          </div>
        </div>
      ) : (
        <For each={alerts().slice(0, 5)}>
          {(alert) => (
            <div class={`${styles.alertItem} ${statusClass(alert.status)}`}>
              <span
                class={styles.alertDot}
                style={{ 'background-color': `#${alert.categoryColor || 'ef4444'}` }}
              />
              <div class={styles.alertContent}>
                <div class={styles.alertTitle}>{alert.categoryName}</div>
                <div class={styles.alertDescription}>
                  {money(alert.spent)} of {money(alert.budgetAmount)} ({alert.percentage}
                  %)
                </div>
              </div>
              <span class={`${styles.alertAmount} ${alert.status === 'over' ? styles.over : ''}`}>
                {alert.remaining < 0
                  ? `-${money(Math.abs(alert.remaining))}`
                  : money(alert.remaining)}
              </span>
            </div>
          )}
        </For>
      )}
    </div>
  )
}
