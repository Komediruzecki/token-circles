/**
 * TransactionTable Component
 * Renders transaction list with sorting, filtering, and pagination
 */
import { createEffect, For } from 'solid-js'
import styles from './TransactionTable.module.css'
import { api } from '../core/api.js'
import { createSignal } from 'solid-js'

export interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  currency: string
  type: 'income' | 'expense' | 'transfer'
  category_name: string
  category_id?: number
  beneficiary?: string
  payor?: string
  reconciled: boolean
  tags?: Array<{ id: number; name: string; color: string }>
  means_of_payment?: string
  notes?: string
}

interface TransactionTableProps {
  transactions: Transaction[]
  selectedTransactions: number[]
  onSelectionChange: (ids: number[]) => void
  onSort?: (field: string) => void
  sortField?: string
  sortOrder?: 'asc' | 'desc'
  loading?: boolean
}

export default function TransactionTable(props: TransactionTableProps) {
  const [filtered, setFiltered] = createSignal<Transaction[]>([])
  const [sortConfig, setSortConfig] = createSignal<{ field: string; direction: 'asc' | 'desc' }>({
    field: 'date',
    direction: 'desc'
  })

  // Initialize sort config from props
  createEffect(() => {
    if (props.sortField) {
      setSortConfig({ field: props.sortField, direction: props.sortOrder || 'desc' })
    }
  })

  // Apply filters based on sort and any global filters
  createEffect(() => {
    let items = [...props.transactions]

    // Apply sorting
    const { field, direction } = sortConfig()
    items.sort((a, b) => {
      let valA: any
      let valB: any

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
        default:
          valA = a[field]
          valB = b[field]
      }

      if (typeof valA === 'string') {
        return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }
      return direction === 'asc' ? (valA > valB ? 1 : -1) : (valB > valA ? 1 : -1)
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
      currency
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
                checked={props.selectedTransactions.length === filtered().length && filtered().length > 0}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked) {
                    props.onSelectionChange(filtered().map(t => t.id))
                  } else {
                    props.onSelectionChange([])
                  }
                }}
              />
            </th>
            <th
              class={`${styles.col} ${styles.dateCol}`}
              onClick={() => handleSort('date')}
            >
              Date {sortConfig().field === 'date' && (sortConfig().direction === 'asc' ? '↑' : '↓')}
            </th>
            <th
              class={`${styles.col} ${styles.descriptionCol}`}
              onClick={() => handleSort('description')}
            >
              Description {sortConfig().field === 'description' && (sortConfig().direction === 'asc' ? '↑' : '↓')}
            </th>
            <th class={`${styles.col} ${styles.categoryCol}`}>Category</th>
            <th
              class={`${styles.col} ${styles.amountCol}`}
              onClick={() => handleSort('amount')}
            >
              Amount {sortConfig().field === 'amount' && (sortConfig().direction === 'asc' ? '↑' : '↓')}
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
                        props.onSelectionChange(props.selectedTransactions.filter(id => id !== transaction.id))
                      }
                    }}
                  />
                </td>
                <td class={styles.dateCol}>{new Date(transaction.date).toLocaleDateString()}</td>
                <td class={styles.descriptionCol}>
                  <div class={styles.description}>{transaction.description}</div>
                  {transaction.beneficiary && (
                    <div class={styles.beneficiary}>Pay to: {transaction.beneficiary}</div>
                  )}
                  {transaction.payor && (
                    <div class={styles.payor}>From: {transaction.payor}</div>
                  )}
                  {transaction.means_of_payment && (
                    <div class={styles.paymentMethod}>{transaction.means_of_payment}</div>
                  )}
                </td>
                <td class={styles.categoryCol}>
                  <div class={styles.categoryName}>{transaction.category_name}</div>
                  {transaction.tags && transaction.tags.length > 0 && (
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
                  <button class={styles.actionBtn} data-action={`transaction:edit:${transaction.id}`}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      {props.transactions.length === 0 && !props.loading && (
        <div class={styles.emptyState}>No transactions found</div>
      )}
    </div>
  )
}