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
  label?: string
  variant?: 'default' | 'page'
}

export default function TransactionSummaryBar(props: TransactionSummaryBarProps) {
  const currency = createMemo(() => props.currency || getLocalCurrency())
  const isPositive = createMemo(() => props.netBalance >= 0)
  const barClass = () =>
    props.variant === 'page' ? `${styles.summaryBar} ${styles.summaryBarPage}` : styles.summaryBar

  // Income : expense split for the flow bar (mint vs salmon). Guard the all-zero
  // case so an empty period doesn't divide by zero.
  const incomePct = createMemo(() => {
    const t = props.totalIncome + props.totalExpenses
    return t > 0 ? (props.totalIncome / t) * 100 : 50
  })

  return (
    <div class={barClass()}>
      {props.label && <span class={styles.periodLabel}>{props.label}</span>}
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

      {/* Flow bar: income:expense split of the period, in brand mint/salmon. */}
      <div class={styles.flowBar} aria-hidden="true">
        <span class={styles.flowIncome} style={{ width: `${incomePct()}%` }} />
        <span class={styles.flowExpense} style={{ width: `${100 - incomePct()}%` }} />
      </div>
    </div>
  )
}
