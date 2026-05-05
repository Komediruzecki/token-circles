/**
 * TransactionTable Component
 * Renders transaction list with sorting, filtering, and pagination
 */
import { createEffect, createSignal, For } from 'solid-js'
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
}

export default function TransactionTable(props: TransactionTableProps) {
  const [filtered, setFiltered] = createSignal<Transaction[]>([])
  const [sortConfig, setSortConfig] = createSignal<{ field: string; direction: 'asc' | 'desc' }>({
    field: 'date',
    direction: 'desc',
  })

  // Initialize sort config from props
  createEffect(() => {
    if (props.sortField !== undefined) {
      setSortConfig({
        field: props.sortField,
        direction: props.sortOrder !== undefined ? props.sortOrder : 'desc',
      })
    }
  })

  // Apply filters based on sort and any global filters
  createEffect(() => {
    const items = [...props.transactions]

    // Apply sorting
    const { field, direction } = sortConfig()
    items.sort((a, b) => {
      let valA: string | number | undefined
      let valB: string | number | undefined

      switch (field) {
        case 'date':
          valA = a.date
          valB = b.date
          break
        case 'description':
          valA = a.description
          valB = b.description
          break
        case 'amount':
          valA = a.amount
          valB = b.amount
          break
        case 'category':
          valA = a.category_name
          valB = b.category_name
          break
        default: {
          const defaultValA = a[field as keyof Transaction]
          const defaultValB = b[field as keyof Transaction]
          valA =
            typeof defaultValA === 'string' || typeof defaultValA === 'number'
              ? defaultValA
              : undefined
          valB =
            typeof defaultValB === 'string' || typeof defaultValB === 'number'
              ? defaultValB
              : undefined
        }
      }

      if (valA !== undefined && valB !== undefined) {
        if (typeof valA === 'string') {
          return direction === 'asc'
            ? valA.localeCompare(valB as string)
            : (valB as string).localeCompare(valA)
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return direction === 'asc' ? (valA > valB ? 1 : -1) : valB > valA ? 1 : -1
        }
        return 0
      }
      return 0
    })

    setFiltered(items)
  })

  const handleSort = (field: string) => {
    let direction: 'asc' | 'desc' = 'asc'
    if (sortConfig().field === field && sortConfig().direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ field, direction })
    props.onSort?.(field)
  }

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount)
  }

  return (
    <div class={styles.transactionTable}>
      <table>
        <thead>
          <tr>
            <th class={styles.checkboxCol}>
              <input
                type="checkbox"
                class={styles.checkbox}
                checked={
                  props.selectedTransactions.length === filtered().length && filtered().length > 0
                }
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked) {
                    props.onSelectionChange(filtered().map((t) => t.id))
                  } else {
                    props.onSelectionChange([])
                  }
                }}
              />
            </th>
            <th
              class={`${styles.col} ${styles.dateCol}`}
              onClick={() => {
                handleSort('date')
              }}
            >
              Date {sortConfig().field === 'date' && (sortConfig().direction === 'asc' ? '↑' : '↓')}
            </th>
            <th
              class={`${styles.col} ${styles.descriptionCol}`}
              onClick={() => {
                handleSort('description')
              }}
            >
              Description{' '}
              {sortConfig().field === 'description' &&
                (sortConfig().direction === 'asc' ? '↑' : '↓')}
            </th>
            <th class={`${styles.col} ${styles.categoryCol}`}>Category</th>
            <th
              class={`${styles.col} ${styles.amountCol}`}
              onClick={() => {
                handleSort('amount')
              }}
            >
              Amount{' '}
              {sortConfig().field === 'amount' && (sortConfig().direction === 'asc' ? '↑' : '↓')}
            </th>
            <th class={`${styles.col} ${styles.typeCol}`}>Type</th>
            <th class={`${styles.col} ${styles.actionsCol}`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          <For each={filtered()}>
            {(transaction) => (
              <tr>
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
                <td class={styles.dateCol}>{new Date(transaction.date).toLocaleDateString()}</td>
                <td class={styles.descriptionCol}>
                  <div class={styles.description}>{transaction.description}</div>
                  {transaction.beneficiary !== undefined && transaction.beneficiary !== '' && (
                    <div class={styles.beneficiary}>Pay to: {transaction.beneficiary}</div>
                  )}
                  {transaction.payor !== undefined && transaction.payor !== '' && (
                    <div class={styles.payor}>From: {transaction.payor}</div>
                  )}
                  {transaction.means_of_payment !== undefined &&
                    transaction.means_of_payment !== '' && (
                      <div class={styles.paymentMethod}>{transaction.means_of_payment}</div>
                    )}
                </td>
                <td class={styles.categoryCol}>
                  <div class={styles.categoryName}>{transaction.category_name}</div>
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
                <td class={styles.amountCol}>
                  <div class={`${styles.amount} ${styles[transaction.type]}`}>
                    {transaction.type === 'income' ? '+' : '-'}
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </div>
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
