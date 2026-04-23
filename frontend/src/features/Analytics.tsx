/**
 * Analytics Component
 * Visualizes financial data with charts and insights
 */
import { createSignal, onMount } from 'solid-js'
import styles from '../components/AnalyticsPage.module.css'
import { formatCurrency } from '../core/api'
import Chart from '../components/Chart'

interface AnalyticsData {
  byCategory: Array<{ category_id: number; category_name: string; amount: number }>
  byMonth: Array<{ month: string; income: number; expense: number }>
  recentTransactions: Array<any>
  savingsRate: number
}

export default function Analytics() {
  const [data, setData] = createSignal<AnalyticsData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [selectedChart, setSelectedChart] = createSignal<'category' | 'monthly' | 'savings'>('category')

  // Load analytics data
  const loadData = async () => {
    setLoading(true)
    try {
      const [categoryRes, heatmapRes, transactionsRes] = await Promise.all([
        fetch('/api/analytics/category-trends').then(r => r.json()),
        fetch('/api/analytics/daily-heatmap?year=2026').then(r => r.json()),
        fetch('/api/transactions/summary').then(r => r.json()),
      ])

      // Transform category-trends response
      const byCategory = categoryRes.datasets.slice(0, 10).map((d: any, i: number) => ({
        category_id: i,
        category_name: d.category,
        amount: d.data[d.data.length - 1] || 0,
      }))

      // Transform heatmap to monthly data (last 6 months)
      const monthMap = new Map<string, { income: number; expense: number }>()

      if (heatmapRes.dates) {
        Object.entries(heatmapRes.dates).forEach(([date, amount]) => {
          const numAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0
          if (numAmount > 0) {
            const monthKey = date.slice(0, 7)
            if (!monthMap.has(monthKey)) {
              monthMap.set(monthKey, { income: 0, expense: 0 })
            }
            monthMap.get(monthKey)!.expense += numAmount
          }
        })
      }

      // Add current month if no data
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      if (!monthMap.has(currentMonth)) {
        monthMap.set(currentMonth, { income: 0, expense: 0 })
      }

      // Get last 6 months sorted by month key
      const byMonth = Array.from(monthMap.entries())
        .slice(-6)
        .map(([month, values]) => ({
          month,
          income: values.income,
          expense: values.expense,
        }))
        .sort((a, b) => b.month.localeCompare(a.month))

      // Recent transactions from summary
      const recentTransactions: any[] = []

      setData({
        byCategory,
        byMonth,
        recentTransactions,
        savingsRate: transactionsRes ? (transactionsRes.total_income - transactionsRes.total_expense) / transactionsRes.total_income * 100 : 0,
      })
    } catch {
      console.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  // Get total income
  const totalIncome = () => {
    return data()?.byMonth.reduce((sum, m) => sum + m.income, 0) || 0
  }

  // Get total expense
  const totalExpense = () => {
    return data()?.byMonth.reduce((sum, m) => sum + m.expense, 0) || 0
  }

  // Format currency
  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  // Format percent
  const formatPercent = (value: number): string => {
    return `${value.toFixed(1)}%`
  }

  onMount(() => {
    loadData()
  })

  return (
    <div class={`page page-analytics page-enter ${styles.analyticsPage}`}>
      <div class={styles.pageHeader}>
        <h1>Analytics</h1>
        <p class="page-subtitle">Visualize your financial data and track trends</p>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading analytics...</div>
      ) : !data() ? (
        <div class={styles.emptyState}>
          <p>No data available</p>
          <p>Add some transactions to see analytics.</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div class="analytics-stats">
            <div class="stat-card">
              <div class="stat-label">Savings Rate</div>
              <div class={`stat-value ${data()!.savingsRate >= 20 ? 'positive' : data()!.savingsRate >= 10 ? 'warning' : 'negative'}`}>
                {formatPercent(data()!.savingsRate)}
              </div>
              <div class="stat-desc">Recommended: 20%+</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Income</div>
              <div class="stat-value positive">{formatAmount(totalIncome())}</div>
              <div class="stat-desc">Last 6 months</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Expense</div>
              <div class="stat-value negative">{formatAmount(totalExpense())}</div>
              <div class="stat-desc">Last 6 months</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Net Savings</div>
              <div class="stat-value positive">
                {formatAmount(totalIncome() - totalExpense())}
              </div>
              <div class="stat-desc">Income - Expenses</div>
            </div>
          </div>

          {/* Chart Tabs */}
          <div class="analytics-tabs">
            <button
              class={`tab ${selectedChart() === 'category' ? 'active' : ''}`}
              onClick={() => setSelectedChart('category')}
            >
              Spending by Category
            </button>
            <button
              class={`tab ${selectedChart() === 'monthly' ? 'active' : ''}`}
              onClick={() => setSelectedChart('monthly')}
            >
              Monthly Trends
            </button>
            <button
              class={`tab ${selectedChart() === 'savings' ? 'active' : ''}`}
              onClick={() => setSelectedChart('savings')}
            >
              Savings Rate
            </button>
          </div>

          {/* Category Chart */}
          {selectedChart() === 'category' && (
            <div class="analytics-chart">
              <h3 class="chart-title">Spending by Category</h3>
              <div class="chart-container">
                {data()!.byCategory.length === 0 ? (
                  <div class={styles.emptyState}>No expense data</div>
                ) : (
                  <Chart
                    id="analytics-category-chart"
                    type="doughnut"
                    data={{
                      labels: data()!.byCategory.map((item) => item.category_name),
                      datasets: [{
                        data: data()!.byCategory.map((item) => item.amount),
                        backgroundColor: [
                          '#dc2626', '#f97316', '#eab308', '#22c55e',
                          '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
                          '#6b7280', '#14b8a6'
                        ],
                        borderWidth: 0
                      }]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'right',
                          labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 12 }
                          }
                        }
                      }
                    }}
                    height={300}
                    width="100%"
                  />
                )}
              </div>
            </div>
          )}

          {/* Monthly Trend Chart */}
          {selectedChart() === 'monthly' && (
            <div class="analytics-chart">
              <h3 class="chart-title">Monthly Income vs Expense</h3>
              <div class="chart-container">
                {data()!.byMonth.length === 0 ? (
                  <div class={styles.emptyState}>No data available</div>
                ) : (
                  <Chart
                    id="analytics-monthly-chart"
                    type="line"
                    data={{
                      labels: data()!.byMonth.map((item) => new Date(item.month).toLocaleDateString('en-US', { month: 'short' })),
                      datasets: [
                        {
                          label: 'Income',
                          data: data()!.byMonth.map((item) => item.income),
                          borderColor: '#22c55e',
                          backgroundColor: 'rgba(34, 197, 94, 0.1)',
                          fill: true,
                          tension: 0.4
                        },
                        {
                          label: 'Expense',
                          data: data()!.byMonth.map((item) => item.expense),
                          borderColor: '#dc2626',
                          backgroundColor: 'rgba(220, 38, 38, 0.1)',
                          fill: true,
                          tension: 0.4
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: (value: any) => formatCurrency(value)
                          }
                        }
                      },
                      plugins: {
                        legend: {
                          position: 'top',
                          labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 12 }
                          }
                        }
                      }
                    }}
                    height={300}
                    width="100%"
                  />
                )}
              </div>
            </div>
          )}

          {/* Savings Rate Chart */}
          {selectedChart() === 'savings' && (
            <div class="analytics-chart">
              <h3 class="chart-title">Savings Rate History</h3>
              <div class="chart-container">
                <div class="savings-rate-display">
                  <div class="rate-circle">
                    <span class="rate-value">{formatPercent(data()!.savingsRate)}</span>
                    <span class="rate-label">Savings Rate</span>
                  </div>
                  <div class="rate-info">
                    <div class="rate-row">
                      <span>Target: 20%</span>
                      <span class={`rate-status ${data()!.savingsRate >= 20 ? 'good' : data()!.savingsRate >= 10 ? 'fair' : 'poor'}`}>
                        {data()!.savingsRate >= 20 ? 'Good' : data()!.savingsRate >= 10 ? 'Fair' : 'Poor'}
                      </span>
                    </div>
                    <div class="rate-row">
                      <span>Projected Annual Savings</span>
                      <span>{formatAmount((totalIncome() - totalExpense()) * 12)}</span>
                    </div>
                  </div>
                </div>
                <div class="savings-tips">
                  <h4>Tips to Improve Savings</h4>
                  <ul>
                    {data()!.savingsRate < 20 && (
                      <li>
                        <strong>Reduce discretionary spending:</strong> Review subscriptions and optional expenses
                      </li>
                    )}
                    {data()!.savingsRate < 10 && (
                      <>
                        <li>
                          <strong>Increase income:</strong> Consider side gigs or ask for a raise
                        </li>
                        <li>
                          <strong>Lower bills:</strong> Compare insurance rates and reduce energy usage
                        </li>
                      </>
                    )}
                    <li>
                      <strong>Use the 50/30/20 rule:</strong> 50% needs, 30% wants, 20% savings
                    </li>
                    <li>
                      <strong>Build an emergency fund:</strong> Start with 3-6 months of expenses
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          <div class="analytics-recent">
            <h3 class="section-title">Recent Transactions</h3>
            <div class="transaction-list">
              {data()!.recentTransactions.map((tx: any) => (
                <div class="transaction-item">
                  <div class="transaction-icon" style={{ background: tx.type === 'expense' ? 'var(--danger)' : 'var(--income)' }}>
                    {tx.type === 'expense' ? '↓' : '↑'}
                  </div>
                  <div class="transaction-details">
                    <div class="transaction-name">{tx.description}</div>
                    <div class="transaction-meta">
                      {new Date(tx.date).toLocaleDateString()} • {tx.category_name || 'No category'}
                    </div>
                  </div>
                  <div class={`transaction-amount ${tx.type === 'expense' ? 'expense' : 'income'}`}>
                    {tx.type === 'expense' ? '-' : '+'}
                    {formatAmount(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
            <div class="view-all-link">
              <a href="#transactions">View All Transactions →</a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}