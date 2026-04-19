/**
 * Dashboard Component
 */

import { createSignal, onMount } from 'solid-js'
import { api, formatCurrency, formatDate, toast } from '../core/api'
import type * as Models from '../types/models'

export default function Dashboard() {
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [loading, setLoading] = createSignal(true)

  onMount(() => {
    loadDashboard()
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

  return (
    <div class="page page-dashboard page-enter">
      <div class="page-header">
        <h1>Dashboard</h1>
        <button class="btn btn-primary" data-action="dashboard:refresh">
          Refresh
        </button>
      </div>

      {loading() ? (
        <div class="empty-state">Loading...</div>
      ) : metrics() ? (
        <>
          {/* Metrics Grid */}
          <div class="metrics-grid">
            <div class="metric-card">
              <div class="metric-label">Balance</div>
              <div class="metric-value positive">{formatCurrency(metrics()!.balance)}</div>
              <div class="metric-subtext">Total available</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Income</div>
              <div class="metric-value positive">{formatCurrency(metrics()!.totalIncome)}</div>
              <div class="metric-subtext">For this period</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Expenses</div>
              <div class="metric-value">{formatCurrency(metrics()!.totalExpenses)}</div>
              <div class="metric-subtext">For this period</div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div class="card">
            <div class="card-header">
              <div class="card-title">Spending by Category</div>
            </div>
            <div class="chart-container">
              <canvas id="expense-category-chart" />
            </div>
          </div>

          {/* Recent Transactions */}
          <div class="card">
            <div class="card-header">
              <div class="card-title">Recent Transactions</div>
              <a href="#transactions" class="btn-link">
                View All →
              </a>
            </div>
            <div class="transaction-list">
              {metrics()!
                .recentTransactions.slice(0, 5)
                .map((tx) => (
                  <div class="transaction-item">
                    <div class="transaction-icon" style={{ background: getIconColor(tx.type) }}>
                      {getIcon(tx.type)}
                    </div>
                    <div class="transaction-details">
                      <div class="transaction-name">{tx.description}</div>
                      <div class="transaction-meta">
                        {formatDate(tx.date)} •{' '}
                        {tx.category_id ? `#${tx.category_id}` : 'No category'}
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

          {/* Upcoming Bills */}
          {metrics()!.upcomingBills.length > 0 && (
            <div class="card">
              <div class="card-header">
                <div class="card-title">Upcoming Bills</div>
                <a href="#bills" class="btn-link">
                  View All →
                </a>
              </div>
              <div class="transaction-list">
                {metrics()!
                  .upcomingBills.slice(0, 5)
                  .map((bill) => (
                    <div class="transaction-item">
                      <div class="transaction-icon" style={{ background: getIconColor('expense') }}>
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
                      <div class="transaction-details">
                        <div class="transaction-name">{bill.name}</div>
                        <div class="transaction-meta">
                          Due {formatDate(bill.due_date)} • Due in {daysUntil(bill.due_date)}
                        </div>
                      </div>
                      <div class="transaction-amount expense">{formatCurrency(bill.amount)}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div class="empty-state">Failed to load data</div>
      )}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getIcon(type: 'income' | 'expense'): any {
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
