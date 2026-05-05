/**
 * Transaction Summary Bar Component
 * Shows summary of transaction statistics
 */
import styles from './TransactionSummaryBar.module.css'

interface TransactionSummaryBarProps {
  totalIncome: number
  totalExpenses: number
  netBalance: number
}

export default function TransactionSummaryBar(props: TransactionSummaryBarProps) {
  const isPositive = props.netBalance >= 0

  return (
    <div class={styles.summaryBar}>
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Income</span>
        <span class={`${styles.summaryValue} ${styles.positive}`}>
          +{props.totalIncome.toFixed(2)}
        </span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Expenses</span>
        <span class={`${styles.summaryValue} ${styles.negative}`}>
          -{props.totalExpenses.toFixed(2)}
        </span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Net</span>
        <span class={`${styles.summaryValue} ${isPositive ? styles.positive : styles.negative}`}>
          {isPositive ? '+' : ''}
          {props.netBalance.toFixed(2)}
        </span>
      </div>
    </div>
  )
}
