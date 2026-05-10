/**
 * Recurring Insights Card Component
 * Shows insights about recurring transactions
 */
import { createSignal, For, onMount } from 'solid-js'
import { api } from '../../core/api'
import styles from './RecurringInsightsCard.module.css'

interface RecurringItem {
  id: number
  description: string
  amount: number
  type: string
  frequency: string
  next_date: string | null
  category_name: string | null
  category_color: string | null
}

export default function RecurringInsightsCard() {
  const [items, setItems] = createSignal<RecurringItem[]>([])
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    try {
      const data = await api.getRecurring()
      setItems(Array.isArray(data) ? data : [])
    } catch {
      // items remain empty
    } finally {
      setLoading(false)
    }
  })

  const upcoming = () =>
    items()
      .filter((i) => i.next_date)
      .sort((a, b) => (a.next_date!).localeCompare(b.next_date!))
      .slice(0, 5)

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const freqCounts = () => {
    const counts: Record<string, number> = {}
    for (const i of items()) {
      counts[i.frequency] = (counts[i.frequency] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }

  return (
    <div class={styles.card}>
      {loading() ? (
        <div class={styles.emptyState}>Loading...</div>
      ) : items().length === 0 ? (
        <div class={styles.emptyState}>
          <p style={{ 'margin-bottom': '4px' }}>No recurring transactions found</p>
          <p style={{ 'font-size': '12px', color: 'var(--text-secondary)' }}>
            Set up regular transactions to see insights here
          </p>
        </div>
      ) : (
        <>
          <div class={styles.freqRow}>
            <For each={freqCounts().slice(0, 4)}>
              {([freq, count]) => (
                <span class={styles.freqBadge}>
                  {count} {freq}
                </span>
              )}
            </For>
          </div>
          <div class={styles.insightsList}>
            <For each={upcoming()}>
              {(item) => (
                <div class={styles.insightItem}>
                  <span
                    class={styles.dot}
                    style={{ 'background-color': item.category_color || '#94a3b8' }}
                  />
                  <div class={styles.insightContent}>
                    <div class={styles.insightTitle}>{item.description}</div>
                    <div class={styles.insightDescription}>
                      {formatDate(item.next_date!)} • {item.frequency}
                    </div>
                  </div>
                  <span class={`${styles.amount} ${styles[item.type]}`}>
                    {item.type === 'income' ? '+' : '-'}
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </>
      )}
    </div>
  )
}
