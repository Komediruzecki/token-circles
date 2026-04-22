/**
 * Dashboard Component
 */

import { createSignal, onMount, type JSX } from 'solid-js'
import { api, formatCurrency, formatDate, toast } from '../core/api'
import type * as Models from '../types/models'
import { DashboardSettings } from '../components/DashboardSettings'
import styles from '../components/DashboardPage.module.css'

export default function Dashboard() {
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [loading, setLoading] = createSignal(true)

  onMount(() => {
    void loadDashboard()
  })

  const loadDashboard = async () => {
    setLoading(true)
    try {
      const data = await api.getDashboard()
      setMetrics(data)
    } catch {
      toast('Failed to load dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showSettings = () => {
    const settings = document.getElementById('dashboard-settings-modal')
    if (settings) {
      const overlay = settings.parentElement
      if (overlay) {
        overlay.classList.add('visible')
        overlay.style.display = 'block'
      }
    }
  }

  return (
    <div class={styles.page}>
      <div class={styles.pageHeader}>
        <div class={styles.pageTitle}>
          <h2>Dashboard</h2>
          <p>Your financial overview</p>
        </div>
        <div class={styles.pageHeaderActions}>
          <button class="btn btn-secondary" onClick={showSettings}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Settings
          </button>
          <button class="btn btn-primary" onClick={loadDashboard}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading...</div>
      ) : metrics() ? (
        <>
          {/* Metrics Grid */}
          <div class={styles.metricsGrid}>
            <div class={styles.metricCard}>
              <div class={styles.metricLabel}>Balance</div>
              <div class={styles.metricValue + " " + styles.positive}>{formatCurrency(metrics()!.balance)}</div>
              <div class={styles.metricSubtext}>Total available</div>
            </div>
            <div class={styles.metricCard}>
              <div class={styles.metricLabel}>Income</div>
              <div class={styles.metricValue + " " + styles.positive}>{formatCurrency(metrics()!.totalIncome)}</div>
              <div class={styles.metricSubtext}>For this period</div>
            </div>
            <div class={styles.metricCard}>
              <div class={styles.metricLabel}>Expenses</div>
              <div class={styles.metricValue}>{formatCurrency(metrics()!.totalExpenses)}</div>
              <div class={styles.metricSubtext}>For this period</div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div class={styles.card}>
            <div class={styles.cardHeader}>
              <div class={styles.cardTitle}>Spending by Category</div>
            </div>
            <div class={styles.chartContainer}>
              <canvas id="expense-category-chart" />
            </div>
            {!metrics()!.expenseByCategory ||
              (metrics()!.expenseByCategory.length === 0 && (
                <div class={styles.emptyState}>No expense data to display</div>
              ))}
          </div>

          {/* Recent Transactions */}
          {metrics()!.recentTransactions && metrics()!.recentTransactions.length > 0 && (
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Recent Transactions</div>
                <a href="#transactions" class={styles.btnLink}>
                  View All →
                </a>
              </div>
              <div class={styles.transactionList}>
                {metrics()!
                  .recentTransactions.slice(0, 5)
                  .map((tx) => (
                    <div class={styles.transactionItem}>
                      <div class={styles.transactionIcon} style={{ background: getIconColor(tx.type) }}>
                        {getIcon(tx.type)}
                      </div>
                      <div class={styles.transactionDetails}>
                        <div class={styles.transactionName}>{tx.description}</div>
                        <div class={styles.transactionMeta}>
                          {formatDate(tx.date)} •{' '}
                          {tx.category_name || tx.category_id
                            ? `#${tx.category_id}`
                            : 'No category'}
                        </div>
                      </div>
                      <div
                        class={`transaction-amount ${tx.type === 'expense' ? 'expense' : 'income'}`}
                      >
                        {tx.type === 'expense' ? '-' : '+'}
                        {formatCurrency(tx.amount)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Upcoming Bills */}
          {(metrics()!.upcomingBills?.length ?? 0) > 0 && (
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Upcoming Bills</div>
                <a href="#bills" class={styles.btnLink}>
                  View All →
                </a>
              </div>
              <div class={styles.transactionList}>
                {metrics()!
                  .upcomingBills.slice(0, 5)
                  .map((bill: any) => (
                    <div class={styles.transactionItem}>
                      <div class={styles.transactionIcon} style={{ background: getIconColor('expense') }}>
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </div>
                      <div class={styles.transactionDetails}>
                        <div class={styles.transactionName}>{bill.name}</div>
                        <div class={styles.transactionMeta}>
                          Due {formatDate(bill.due_date)} • Due in {daysUntil(bill.due_date)}
                        </div>
                      </div>
                      <div class={styles.transactionAmount + ' ' + styles.expense}>{formatCurrency(bill.amount)}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Widget Settings Modal */}
          <div class={styles.modalOverlay} id="dashboard-settings-modal">
            <div class={styles.modal + ' ' + styles.modalMd}>
              <div class={styles.modalHeader}>
                <div class={styles.modalTitle}>Dashboard Settings</div>
                <button
                  class={styles.modalClose}
                  onClick={() => {
                    const modal = document.getElementById('dashboard-settings-modal')
                    if (modal) {
                      const overlay = modal.parentElement
                      if (overlay) {
                        overlay.style.display = 'none'
                      }
                    }
                  }}
                >
                  <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div class={styles.modalBody}>
                <DashboardSettings />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div class={styles.emptyState}>Failed to load data</div>
      )}
    </div>
  )
}

function getIcon(type: 'income' | 'expense'): JSX.Element {
  if (type === 'income') {
    return (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M7 11l5-5m0 0l5 5m-5-5v12"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M17 13l-5 5m0 0l-5-5m5 5V6"
      />
    </svg>
  )
}

function getIconColor(type: string): string {
  return type === 'expense' ? 'var(--danger)' : 'var(--income)'
}

function daysUntil(dateStr: string): string {
  const target = new Date(dateStr)
  const today = new Date()
  const diff = target.getTime() - today.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return `${Math.abs(days)} days overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}
