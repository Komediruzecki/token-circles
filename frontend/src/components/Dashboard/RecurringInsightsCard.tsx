/**
 * Recurring Insights Card Component
 * Shows insights about recurring transactions
 */
import styles from './RecurringInsightsCard.module.css'

export default function RecurringInsightsCard() {
  return (
    <div class={styles.card}>
      <div class={styles.cardHeader}>
        <div class={styles.cardTitle}>Recurring Insights</div>
      </div>
      <div class={styles.insightsList}>
        <div class={styles.insightItem}>
          <svg class={styles.insightIcon} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div class={styles.insightContent}>
            <div class={styles.insightTitle}>No recurring transactions found</div>
            <div class={styles.insightDescription}>
              Set up regular transactions to see insights here
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
