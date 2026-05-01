/**
 * Budget Alerts Card Component
 * Shows budget alerts for the current period
 */
import styles from './BudgetAlertsCard.module.css'

export default function BudgetAlertsCard() {
  return (
    <div class={styles.card}>
      <div class={styles.cardHeader}>
        <div class={styles.cardTitle}>Budget Alerts</div>
        <a href="#budgets" class={styles.cardLink}>View All</a>
      </div>
      <div class={styles.alertsContainer}>
        <div class={`${styles.alertItem} ${styles.alertSeverity.normal}`}>
          <div class={styles.alertSeverity.normal}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class={styles.alertContent}>
            <div class={styles.alertTitle}>All budgets within limits</div>
            <div class={styles.alertDescription}>
              You're on track to meet all your budget goals
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
