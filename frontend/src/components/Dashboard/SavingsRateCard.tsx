/**
 * Savings Rate Card Component
 * Shows current savings rate for the period
 */
import styles from './SavingsRateCard.module.css'

export default function SavingsRateCard() {
  return (
    <div class={styles.card}>
      <div class={styles.cardHeader}>
        <div class={styles.cardTitle}>Savings Rate</div>
        <a href="#budgets" class={styles.cardLink}>
          Details
        </a>
      </div>
      <div class={styles.savingsRateContainer}>
        <div class={styles.savingsRateValue}>
          <span class={styles.rateLabel}>Monthly Savings:</span>
          <span class={styles.rateValue}>€0.00</span>
        </div>
      </div>
    </div>
  )
}
