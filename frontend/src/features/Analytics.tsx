/**
 * Analytics Component
 * Visualizes financial data with charts and insights
 */

import { createSignal, onMount } from 'solid-js'
import { formatCurrency } from '../core/api'

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
      const [categoryRes, monthRes, transactionsRes, savingsRes] = await Promise.all([
        fetch('/api/analytics/category-trends').then(r => r.json()),
        fetch('/api/analytics/weeks').then(r => r.json()),
        fetch('/api/transactions/summary').then(r => r.json()),
        fetch('/api/analytics/distinct-years').then(r => r.json()),
      ])

      setData({
        byCategory: categoryRes.slice(0, 10),
        byMonth: monthRes.slice(0, 6),
        recentTransactions: transactionsRes?.transactions?.slice(0, 5) || [],
        savingsRate: savingsRes?.savings_rate || 0,
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
    <div class="page page-analytics page-enter">
      <div class="page-header">
        <h1>Analytics</h1>
        <p class="page-subtitle">Visualize your financial data and track trends</p>
      </div>

      {loading() ? (
        <div class="empty-state">Loading analytics...</div>
      ) : !data() ? (
        <div class="empty-state">
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
                  <div class="empty-state">No expense data</div>
                ) : (
                  <div class="category-bars">
                    {data()!.byCategory.map((item) => {
                      const percent = (item.amount / data()!.byCategory.reduce((s, x) => s + x.amount, 0)) * 100
                      return (
                        <div class="category-bar-item">
                          <div class="bar-info">
                            <span class="bar-name">{item.category_name}</span>
                            <span class="bar-percent">{formatPercent(percent)}</span>
                          </div>
                          <div class="bar-track">
                            <div
                              class="bar-fill"
                              style={{
                                width: `${percent}%`,
                              }}
                            />
                          </div>
                          <span class="bar-amount">{formatAmount(item.amount)}</span>
                        </div>
                      )
                    })}
                  </div>
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
                  <div class="empty-state">No data available</div>
                ) : (
                  <div class="trend-bars">
                    {data()!.byMonth.map((item) => {
                      const total = item.income + item.expense
                      const incomePercent = total > 0 ? (item.income / total) * 100 : 0
                      const expensePercent = total > 0 ? (item.expense / total) * 100 : 0
                      return (
                        <div class="trend-bar-item">
                          <div class="bar-info">
                            <span class="bar-name">{new Date(item.month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span>
                          </div>
                          <div class="bar-track">
                            <div
                              class="bar-fill bar-income"
                              style={{
                                width: `${incomePercent}%`,
                              }}
                            />
                            <div
                              class="bar-fill bar-expense"
                              style={{
                                width: `${expensePercent}%`,
                              }}
                            />
                          </div>
                          <div class="bar-legend">
                            <span className="bar-income-label">{formatPercent(incomePercent)} Income</span>
                            <span className="bar-expense-label">{formatPercent(expensePercent)} Expense</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
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
                    <div className="rate-row">
                      <span>Target: 20%</span>
                      <span className={`rate-status ${data()!.savingsRate >= 20 ? 'good' : data()!.savingsRate >= 10 ? 'fair' : 'poor'}`}>
                        {data()!.savingsRate >= 20 ? 'Good' : data()!.savingsRate >= 10 ? 'Fair' : 'Poor'}
                      </span>
                    </div>
                    <div className="rate-row">
                      <span>Projected Annual Savings</span>
                      <span>{formatAmount((totalIncome() - totalExpense()) * 12)}</span>
                    </div>
                  </div>
                </div>
                <div className="savings-tips">
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
            <div className="view-all-link">
              <a href="#transactions">View All Transactions →</a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}