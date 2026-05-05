/**
 * Transaction Summary Bar Component
 * Shows summary of transaction statistics
 */
import styles from './TransactionSummaryBar.module.css'

interface TransactionSummaryBarProps {
  totalAmount: number
  totalIncome: number
  totalExpenses: number
  netBalance: number
  transactionCount: number
  currency?: string
}

export default function TransactionSummaryBar(props: TransactionSummaryBarProps) {
  const isPositive = props.netBalance >= 0
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: props.currency || 'USD' }).format(n)

  return (
    <div class={styles.summaryBar}>
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Total Amount</span>
        <span class={`${styles.summaryValue} ${styles.total}`}>{fmt(props.totalAmount)}</span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Income</span>
        <span class={`${styles.summaryValue} ${styles.positive}`}>+{props.totalIncome.toFixed(2)}</span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Expenses</span>
        <span class={`${styles.summaryValue} ${styles.negative}`}>-{props.totalExpenses.toFixed(2)}</span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Net</span>
        <span class={`${styles.summaryValue} ${isPositive ? styles.positive : styles.negative}`}>
          {isPositive ? '+' : ''}
          {props.netBalance.toFixed(2)}
        </span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Transactions</span>
        <span class={styles.summaryValue}>{props.transactionCount}</span>
      </div>
    </div>
  )
}
