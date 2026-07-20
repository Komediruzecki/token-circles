/**
 * TransactionTable Component
 * Renders transaction list with sorting, filtering, and pagination
 */
import { For } from 'solid-js'
import { formatCurrency } from '../core/api'
import { isEstimatedBaseValue, originalAmountLabel, txBaseValue } from '../core/currency'
import { fromToLabels } from '../core/transactionFlow'
import styles from './TransactionTable.module.css'
import type { Transaction } from '../types/models'

interface TransactionTableProps {
  transactions: Transaction[]
  selectedTransactions: number[]
  onSelectionChange: (ids: number[]) => void
  onSort?: (field: string) => void
  sortField?: string
  sortOrder?: 'asc' | 'desc'
  loading?: boolean
  onEdit?: (transaction: Transaction) => void
  onCopy?: (transaction: Transaction) => void
  onDelete?: (transaction: Transaction) => void
  onViewReceipt?: (transaction: Transaction) => void
}

export default function TransactionTable(props: TransactionTableProps) {
  const handleSort = (field: string) => {
    props.onSort?.(field)
  }

  return (
    <div
      class={styles.transactionTable}
      data-test-id="transactions-table"
      data-tour="transactions-table"
    >
      <table>
        <thead>
          <tr>
            <th class={styles.checkboxCol}>
              <input
                type="checkbox"
                class={styles.checkbox}
                checked={
                  props.selectedTransactions.length === props.transactions.length &&
                  props.transactions.length > 0
                }
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked) {
                    props.onSelectionChange(props.transactions.map((t) => t.id))
                  } else {
                    props.onSelectionChange([])
                  }
                }}
              />
            </th>
            <th
              class={`${styles.col} ${styles.dateCol}`}
              data-test-id="transactions-sort-date"
              onClick={() => {
                handleSort('date')
              }}
            >
              Date{' '}
              {(props.sortField || 'date') === 'date'
                ? (props.sortOrder || 'desc') === 'asc'
                  ? '↑'
                  : '↓'
                : ''}
            </th>
            <th
              class={`${styles.col} ${styles.descriptionCol}`}
              onClick={() => {
                handleSort('description')
              }}
            >
              Description{' '}
              {(props.sortField || 'date') === 'description'
                ? (props.sortOrder || 'desc') === 'asc'
                  ? '↑'
                  : '↓'
                : ''}
            </th>
            <th
              class={`${styles.col} ${styles.categoryCol}`}
              onClick={() => {
                handleSort('category')
              }}
            >
              Category{' '}
              {(props.sortField || 'date') === 'category'
                ? (props.sortOrder || 'desc') === 'asc'
                  ? '↑'
                  : '↓'
                : ''}
            </th>
            <th class={`${styles.col} ${styles.counterPartyCol}`}>From/To</th>
            <th
              class={`${styles.col} ${styles.amountCol}`}
              onClick={() => {
                handleSort('amount')
              }}
            >
              Amount{' '}
              {(props.sortField || 'date') === 'amount'
                ? (props.sortOrder || 'desc') === 'asc'
                  ? '↑'
                  : '↓'
                : ''}
            </th>
            <th class={`${styles.col} ${styles.typeCol}`}>Type</th>
            <th class={`${styles.col} ${styles.actionsCol}`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.transactions}>
            {(transaction) => (
              <tr
                class={transaction.reconciled ? styles.reconciled : ''}
                data-test-id="transactions-row"
              >
                <td class={styles.checkboxCol}>
                  <input
                    type="checkbox"
                    class={styles.checkbox}
                    checked={props.selectedTransactions.includes(transaction.id)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      if (checked) {
                        props.onSelectionChange([...props.selectedTransactions, transaction.id])
                      } else {
                        props.onSelectionChange(
                          props.selectedTransactions.filter((id) => id !== transaction.id)
                        )
                      }
                    }}
                  />
                </td>
                <td class={styles.dateCol} data-test-id="transactions-cell-date">
                  {transaction.reconciled && (
                    <svg
                      width="12"
                      height="12"
                      fill="none"
                      stroke="#22c55e"
                      stroke-width="2"
                      viewBox="0 0 24 24"
                      style="margin-right: 4px; vertical-align: middle;"
                    >
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  {new Date(transaction.date).toLocaleDateString()}
                </td>
                <td class={styles.descriptionCol} data-test-id="transactions-cell-description">
                  <div class={styles.description}>
                    {transaction.description}
                    {typeof transaction.receipt_id === 'number' && (
                      <button
                        class={styles.receiptChip}
                        title={`View receipt${transaction.receipt_name ? `: ${transaction.receipt_name}` : ''}`}
                        aria-label="View receipt"
                        onClick={(e) => {
                          e.stopPropagation()
                          props.onViewReceipt?.(transaction)
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
                          />
                        </svg>
                        Receipt
                      </button>
                    )}
                  </div>
                  {transaction.tags !== undefined && transaction.tags.length > 0 && (
                    <div class={styles.tags}>
                      <For each={transaction.tags.slice(0, 2)}>
                        {(tag) => (
                          <span class={styles.tag} style={{ background: `#${tag.color}` }}>
                            {tag.name}
                          </span>
                        )}
                      </For>
                      {transaction.tags.length > 2 && (
                        <span class={styles.tagCount}>+{transaction.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                </td>
                <td class={styles.categoryCol} data-test-id="transactions-cell-category">
                  <div class={styles.categoryName}>
                    <span
                      class={styles.categoryDot}
                      style={{ 'background-color': transaction.category_color || '#94a3b8' }}
                    />
                    {transaction.category_name || '—'}
                  </div>
                </td>
                <td class={styles.counterPartyCol}>
                  {(() => {
                    const ft = fromToLabels(transaction)
                    return (
                      <span>
                        <span class={styles.fromTo}>{ft.from}</span>
                        <span class={styles.fromToArrow}> → </span>
                        <span class={styles.fromTo}>{ft.to}</span>
                      </span>
                    )
                  })()}
                </td>
                <td class={styles.amountCol} data-test-id="transactions-cell-amount">
                  <div
                    class={`${styles.amount} ${styles[transaction.type]}`}
                    title={
                      originalAmountLabel(transaction)
                        ? `Original: ${originalAmountLabel(transaction)}`
                        : undefined
                    }
                  >
                    {transaction.type === 'income'
                      ? '+'
                      : transaction.type === 'transfer'
                        ? ''
                        : '-'}
                    {formatCurrency(txBaseValue(transaction))}
                    {isEstimatedBaseValue(transaction) && (
                      <span
                        class={styles.estimatedFlag}
                        title={`Estimated conversion from ${transaction.currency} — no local-currency amount was provided, so this uses an approximate rate.`}
                        aria-label="Estimated conversion"
                      >
                        <svg
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M12 9v2m0 4h.01M12 3l9 16H3l9-16z"
                          />
                        </svg>
                      </span>
                    )}
                  </div>
                  {originalAmountLabel(transaction) && (
                    <div class={styles.amountOriginal}>{originalAmountLabel(transaction)}</div>
                  )}
                  {isEstimatedBaseValue(transaction) && (
                    <div class={styles.amountOriginal}>~ from {transaction.currency} (est.)</div>
                  )}
                </td>
                <td class={styles.typeCol}>
                  <span class={`${styles.typeBadge} ${styles[transaction.type]}`}>
                    {transaction.type}
                  </span>
                </td>
                <td class={styles.actionsCol}>
                  <button class={styles.actionBtn} onClick={() => props.onEdit?.(transaction)}>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </button>
                  <button
                    class={styles.actionBtn}
                    title="Duplicate"
                    aria-label="Duplicate transaction"
                    onClick={() => props.onCopy?.(transaction)}
                  >
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-width={2} />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                        d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                      />
                    </svg>
                  </button>
                  <button class={styles.actionBtn} onClick={() => props.onDelete?.(transaction)}>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      {props.transactions.length === 0 && (props.loading === undefined || !props.loading) && (
        <div class={styles.emptyState}>No transactions found</div>
      )}
    </div>
  )
}
