/**
 * Portfolio Component
 * Tracks stock/ETF holdings with real-time prices and gain/loss
 */

import { createSignal, For, onMount, Show } from 'solid-js'
import styles from '../components/PortfolioPage.module.css'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../utils/api'
import type { PortfolioHolding, PortfolioSummary } from '../types/models'

export default function Portfolio() {
  const [holdings, setHoldings] = createSignal<PortfolioHolding[]>([])
  const [summary, setSummary] = createSignal<PortfolioSummary | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [editingHolding, setEditingHolding] = createSignal<PortfolioHolding | null>(null)
  const [formData, setFormData] = createSignal({
    ticker: '',
    shares: '',
    purchasePrice: '',
    purchaseDate: '',
    notes: '',
  })
  const [priceLoading, setPriceLoading] = createSignal(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [holdingsRes, summaryRes] = await Promise.all([
        apiGet<PortfolioHolding[]>('/api/portfolio/holdings'),
        apiGet<PortfolioSummary>('/api/portfolio/summary'),
      ])
      setHoldings(Array.isArray(holdingsRes) ? holdingsRes : [])
      setSummary(summaryRes)
    } catch (err) {
      console.error('Failed to load portfolio', err)
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    loadData()
  })

  const openAddModal = () => {
    setEditingHolding(null)
    setFormData({ ticker: '', shares: '', purchasePrice: '', purchaseDate: '', notes: '' })
    setShowAddModal(true)
  }

  const openEditModal = (h: PortfolioHolding) => {
    setEditingHolding(h)
    setFormData({
      ticker: h.ticker,
      shares: String(h.shares),
      purchasePrice: String(h.purchasePrice),
      purchaseDate: h.purchaseDate,
      notes: h.notes || '',
    })
    setShowAddModal(true)
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      ticker: formData().ticker.toUpperCase(),
      shares: parseFloat(formData().shares),
      purchase_price: parseFloat(formData().purchasePrice),
      purchase_date: formData().purchaseDate,
      notes: formData().notes,
    }

    if (!data.ticker || !data.shares || !data.purchase_price || !data.purchase_date) {
      showToast('Please fill all required fields', 'error')
      return
    }

    try {
      if (editingHolding()) {
        await apiPut(`/api/portfolio/holdings/${editingHolding()!.id}`, data)
        showToast('Holding updated', 'success')
      } else {
        await apiPost('/api/portfolio/holdings', data)
        showToast('Holding added', 'success')
      }
      setShowAddModal(false)
      loadData()
    } catch (err) {
      console.error('Failed to save holding', err)
      showToast('Failed to save holding', 'error')
    }
  }

  const deleteHolding = async (id: number) => {
    try {
      await apiDelete(`/api/portfolio/holdings/${id}`)
      showToast('Holding deleted', 'success')
      loadData()
    } catch (err) {
      console.error('Failed to delete holding', err)
      showToast('Failed to delete holding', 'error')
    }
  }

  const refreshPrices = async () => {
    setPriceLoading(true)
    try {
      const tickers = holdings().map((h) => h.ticker)
      if (tickers.length > 0) {
        await apiPost('/api/portfolio/prices', { tickers })
      }
      await loadData()
    } catch (err) {
      console.error('Failed to refresh prices', err)
    } finally {
      setPriceLoading(false)
    }
  }

  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  const formatPercent = (pct: number): string => {
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
  }

  // Calculate allocation colors for pie chart
  const allocationColors = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
    '#6366f1',
    '#14b8a6',
  ]

  const getAllocationColor = (idx: number) => allocationColors[idx % allocationColors.length]

  return (
    <div class={`${styles.portfolioPage} page page-portfolio page-enter`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="portfolio-header">Portfolio</h1>
          <div class={styles.headerActions}>
            <button
              data-test-id="refresh-prices-btn"
              class={`${styles.btn} ${styles.btnSecondary}`}
              onClick={refreshPrices}
              disabled={priceLoading()}
            >
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              {priceLoading() ? 'Refreshing...' : 'Refresh Prices'}
            </button>
            <button
              data-test-id="add-holding-btn"
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={openAddModal}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Holding
            </button>
          </div>
        </div>
        <p data-test-id="portfolio-subtitle" class={styles.pageSubtitle}>
          Track your stock and ETF investments with real-time prices
        </p>
      </div>

      {/* Summary Cards */}
      <Show when={summary()}>
        <div data-test-id="portfolio-summary" class={styles.summaryRow}>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Portfolio Value</div>
            <div class={styles.summaryValue}>{formatAmount(summary()!.totalValue)}</div>
          </div>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Total Cost Basis</div>
            <div class={styles.summaryValue}>{formatAmount(summary()!.totalCostBasis)}</div>
          </div>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Total Gain/Loss</div>
            <div
              class={`${styles.summaryValue} ${summary()!.totalGain >= 0 ? styles.positive : styles.negative}`}
            >
              {formatAmount(summary()!.totalGain)}
              <span class={styles.gainPercent}>({formatPercent(summary()!.totalGainPercent)})</span>
            </div>
          </div>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Holdings</div>
            <div class={styles.summaryValue}>{holdings().length}</div>
          </div>
        </div>
      </Show>

      {loading() ? (
        <div class={styles.emptyState}>Loading portfolio...</div>
      ) : holdings().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No holdings yet</p>
          <p>Add your first stock or ETF to start tracking your portfolio.</p>
          <button class={`${styles.btn} ${styles.btnPrimary}`} onClick={openAddModal}>
            Add Holding
          </button>
        </div>
      ) : (
        <div class={styles.contentGrid}>
          {/* Holdings Table */}
          <div class={styles.tableSection}>
            <h2 class={styles.sectionTitle}>Holdings</h2>
            <div class={styles.tableWrapper}>
              <table class={styles.table}>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th class={styles.right}>Shares</th>
                    <th class={styles.right}>Cost/Share</th>
                    <th class={styles.right}>Price</th>
                    <th class={styles.right}>Market Value</th>
                    <th class={styles.right}>Gain/Loss</th>
                    <th class={styles.right}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={holdings()}>
                    {(h) => (
                      <tr>
                        <td>
                          <span class={styles.ticker}>{h.ticker}</span>
                        </td>
                        <td class={styles.right}>{h.shares}</td>
                        <td class={styles.right}>{formatAmount(h.purchasePrice)}</td>
                        <td class={styles.right}>
                          {formatAmount(h.currentPrice || h.purchasePrice)}
                        </td>
                        <td class={styles.right}>{formatAmount(h.marketValue || 0)}</td>
                        <td
                          class={`${styles.right} ${(h.gain || 0) >= 0 ? styles.positive : styles.negative}`}
                        >
                          {formatAmount(h.gain || 0)}
                          <div class={styles.gainPercent}>{formatPercent(h.gainPercent || 0)}</div>
                        </td>
                        <td class={styles.actions}>
                          <button
                            class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                            onClick={() => {
                              openEditModal(h)
                            }}
                            title="Edit"
                          >
                            <svg
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                            onClick={() => {
                              if (confirm(`Delete ${h.ticker} holding?`)) deleteHolding(h.id)
                            }}
                            title="Delete"
                          >
                            <svg
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>

          {/* Allocation Sidebar */}
          <div class={styles.sidebar}>
            <h2 class={styles.sectionTitle}>Allocation</h2>
            <Show when={summary()}>
              <div class={styles.pieContainer}>
                <svg viewBox="0 0 200 200" class={styles.pieChart}>
                  {(() => {
                    const alloc = summary()!.allocation
                    if (alloc.length === 0) return null
                    const total = alloc.reduce((s, a) => s + a.value, 0) || 1
                    let cumulativeAngle = 0
                    return alloc.map((a, i) => {
                      const angle = (a.value / total) * 360
                      const startAngle = cumulativeAngle
                      cumulativeAngle += angle
                      const endAngle = cumulativeAngle

                      const startRad = ((startAngle - 90) * Math.PI) / 180
                      const endRad = ((endAngle - 90) * Math.PI) / 180

                      const r = 80
                      const cx = 100
                      const cy = 100

                      const x1 = cx + r * Math.cos(startRad)
                      const y1 = cy + r * Math.sin(startRad)
                      const x2 = cx + r * Math.cos(endRad)
                      const y2 = cy + r * Math.sin(endRad)

                      const largeArc = angle > 180 ? 1 : 0

                      const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`

                      return (
                        <path
                          d={pathD}
                          fill={getAllocationColor(i)}
                          stroke="var(--card-bg)"
                          stroke-width="2"
                        />
                      )
                    })
                  })()}
                  <circle cx="100" cy="100" r="45" fill="var(--card-bg)" />
                </svg>
                <div class={styles.pieTotal}>
                  <div class={styles.pieTotalValue}>{formatAmount(summary()!.totalValue)}</div>
                </div>
              </div>
              <div class={styles.legend}>
                <For each={summary()!.allocation}>
                  {(a, i) => (
                    <div class={styles.legendItem}>
                      <span
                        class={styles.legendDot}
                        style={{ background: getAllocationColor(i()) }}
                      />
                      <span class={styles.legendTicker}>{a.ticker}</span>
                      <span class={styles.legendPct}>{a.percentage.toFixed(1)}%</span>
                      <span class={styles.legendValue}>{formatAmount(a.value)}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Show when={showAddModal()}>
        <div
          class={styles.modalOverlay}
          onclick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false)
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>{editingHolding() ? 'Edit Holding' : 'Add Holding'}</h3>
              <button class={styles.modalClose} onClick={() => setShowAddModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Ticker Symbol</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., AAPL, SPY, NVDA"
                  value={formData().ticker}
                  onInput={(e) =>
                    setFormData({ ...formData(), ticker: e.target.value.toUpperCase() })
                  }
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Shares</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="Number of shares"
                  value={formData().shares}
                  onInput={(e) => setFormData({ ...formData(), shares: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Purchase Price (per share)</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="0.00"
                  value={formData().purchasePrice}
                  onInput={(e) => setFormData({ ...formData(), purchasePrice: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Purchase Date</label>
                <input
                  type="date"
                  class={styles.formControl}
                  value={formData().purchaseDate}
                  onInput={(e) => setFormData({ ...formData(), purchaseDate: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Notes</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="Optional notes"
                  value={formData().notes}
                  onInput={(e) => setFormData({ ...formData(), notes: e.target.value })}
                />
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" class={`${styles.btn} ${styles.btnPrimary}`}>
                  {editingHolding() ? 'Update' : 'Add'} Holding
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  )
}
