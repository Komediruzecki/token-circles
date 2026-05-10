/**
 * Budget Alerts Card Component
 * Shows budget alerts for the current period — fetches from API
 */
import { createSignal, For, onMount } from 'solid-js'
import { formatCurrency } from '../../core/api'
import { apiGet } from '../../utils/api'
import styles from './BudgetAlertsCard.module.css'

interface BudgetAlert {
  category_name: string
  category_color: string
  budgeted: number
  spent: number
  remaining: number
  percent: number
  status: 'over' | 'warning' | 'ok'
}

export default function BudgetAlertsCard() {
  const [alerts, setAlerts] = createSignal<BudgetAlert[]>([])
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    try {
      const data = (await apiGet<any[]>('/api/budgets/alerts?threshold=80')) as any
      if (Array.isArray(data)) {
        setAlerts(data)
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false)
    }
  })

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
                style={{ 'background-color': `#${alert.category_color || 'ef4444'}` }}
              />
              <div class={styles.alertContent}>
                <div class={styles.alertTitle}>{alert.category_name}</div>
                <div class={styles.alertDescription}>
                  {formatCurrency(alert.spent)} of {formatCurrency(alert.budgeted)} ({alert.percent}
                  %)
                </div>
              </div>
              <span class={`${styles.alertAmount} ${alert.status === 'over' ? styles.over : ''}`}>
                {alert.remaining < 0
                  ? `-${formatCurrency(Math.abs(alert.remaining))}`
                  : formatCurrency(alert.remaining)}
              </span>
            </div>
          )}
        </For>
      )}
    </div>
  )
}
