/**
 * Transaction Summary Bar Component
 * Shows summary of transaction statistics
 */
import { createMemo } from 'solid-js'
import { getLocalCurrency } from '../core/api'
import styles from './TransactionSummaryBar.module.css'

function formatAmount(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

interface TransactionSummaryBarProps {
  totalAmount: number
  totalIncome: number
  totalExpenses: number
  netBalance: number
  transactionCount: number
  currency?: string
}

export default function TransactionSummaryBar(props: TransactionSummaryBarProps) {
  const currency = createMemo(() => props.currency || getLocalCurrency())
  const isPositive = createMemo(() => props.netBalance >= 0)

  return (
    <div class={styles.summaryBar}>
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Total Amount</span>
        <span class={`${styles.summaryValue} ${styles.total}`}>
          {formatAmount(props.totalAmount, currency())}
        </span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Income</span>
        <span class={`${styles.summaryValue} ${styles.positive}`}>
          {formatAmount(props.totalIncome, currency())}
        </span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Expenses</span>
        <span class={`${styles.summaryValue} ${styles.negative}`}>
          {formatAmount(props.totalExpenses, currency())}
        </span>
      </div>
      <div class={styles.summaryDivider} />
      <div class={styles.summaryItem}>
        <span class={styles.summaryLabel}>Net</span>
        <span class={`${styles.summaryValue} ${isPositive() ? styles.positive : styles.negative}`}>
          {formatAmount(props.netBalance, currency())}
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
