/**
 * Portfolio Component
 * Tracks stock/ETF holdings with real-time prices and gain/loss
 */

import { createMemo, createSignal, For, Show } from 'solid-js'
import CategoryOrbits from '../components/Dashboard/CategoryOrbits'
import { Field, FormNotice, SubmitButton } from '../components/form'
import OrbitalDivider from '../components/OrbitalDivider'
import {
  apiDelete,
  apiHouseholdGet,
  apiPost,
  formatCurrency,
  getLocalCurrency,
  showToast,
} from '../core/api'
import { plainMessage } from '../core/apiError'
import { useAppState } from '../core/appStore'
import { paletteColor } from '../core/brandPalette'
import { convertToBase } from '../core/currency'
import { entityVersion } from '../core/dataVersions'
import { refetchOnActive } from '../core/pageVisibility'
import { createHoldingForm } from './holdingForm'
import styles from './PortfolioPage.module.css'
import type { PortfolioHolding, PortfolioSummary } from '../types/models'

interface LiveQuote {
  price: number
  previousClose?: number
  change?: number
  changePercent?: number
  currency?: string | null
  name?: string
}

export default function Portfolio() {
  const state = useAppState()
  const [holdings, setHoldings] = createSignal<PortfolioHolding[]>([])
  const [summary, setSummary] = createSignal<PortfolioSummary | null>(null)
  const [initialLoad, setInitialLoad] = createSignal(true)
  const [priceLoading, setPriceLoading] = createSignal(false)
  // Live quotes keyed by UPPERCASE ticker, from the last "Refresh Prices" (session-only).
  const [prices, setPrices] = createSignal<Record<string, LiveQuote>>({})

  // Holdings enriched with the live quote (converted to the base currency) so gains are
  // real. Falls back to purchase price when no quote was fetched for a ticker.
  const displayHoldings = createMemo(() =>
    holdings().map((h) => {
      const q = prices()[h.ticker?.toUpperCase()]
      if (!q || typeof q.price !== 'number' || q.price <= 0) return h
      const base = getLocalCurrency()
      const livePrice = q.currency ? (convertToBase(q.price, q.currency, base) ?? q.price) : q.price
      const marketValue = livePrice * h.shares
      const costBasis = h.purchase_price * h.shares
      const gain = marketValue - costBasis
      return {
        ...h,
        currentPrice: livePrice,
        marketValue,
        gain,
        gainPercent: costBasis ? (gain / costBasis) * 100 : 0,
      }
    })
  )

  // Summary cards recomputed from the live-priced holdings so Total Value / Gain match
  // the table after "Refresh Prices". Falls back to the server summary before any
  // prices are fetched (and keeps its allocation breakdown either way).
  const liveSummary = createMemo(() => {
    const base = summary()
    if (!base || Object.keys(prices()).length === 0) return base
    const dh = displayHoldings()
    const totalValue = dh.reduce((s, h) => s + (h.marketValue || 0), 0)
    const totalCostBasis = dh.reduce((s, h) => s + h.purchase_price * h.shares, 0)
    const totalGain = totalValue - totalCostBasis
    return {
      ...base,
      totalValue,
      totalCostBasis,
      totalGain,
      totalGainPercent: totalCostBasis ? (totalGain / totalCostBasis) * 100 : 0,
    }
  })

  const loadData = async () => {
    try {
      const [holdingsRes, summaryRes] = await Promise.all([
        apiHouseholdGet<PortfolioHolding[]>('/api/portfolio/holdings'),
        apiHouseholdGet<PortfolioSummary>('/api/portfolio/summary'),
      ])
      setHoldings(Array.isArray(holdingsRes) ? holdingsRes : [])
      setSummary(summaryRes)
    } catch (err) {
      console.error('Failed to load portfolio', err)
    } finally {
      setInitialLoad(false)
    }
  }

  // Load on mount, and reload on a profile change or a holding write from anywhere (including
  // resume revalidation) — but only while visible. A hidden page defers its refetch until it is
  // next shown (keep-alive fan-out guard). This page's own writes bump `portfolio` through
  // apiFetch, so none of them reloads by hand; a price refresh is a read and bumps nothing.
  refetchOnActive(
    'portfolio',
    () => [state.profileVersion, entityVersion('portfolio')],
    () => {
      void loadData()
    }
  )

  // The add and edit dialog. Its writes bump `portfolio` through apiFetch, which reloads the list.
  const holdingForm = createHoldingForm({ holdings })

  const deleteHolding = async (id: number) => {
    try {
      await apiDelete(`/api/portfolio/holdings/${id}`)
      showToast('Holding deleted', 'success')
    } catch (err) {
      console.error('Failed to delete holding', err)
      showToast(plainMessage(err, "Couldn't delete the holding. Try again."), 'error')
    }
  }

  const refreshPrices = async () => {
    setPriceLoading(true)
    try {
      const tickers = holdings().map((h) => h.ticker)
      if (tickers.length > 0) {
        const res = await apiPost<Record<string, LiveQuote>>('/api/portfolio/prices', { tickers })
        const map = res && typeof res === 'object' ? res : {}
        // Normalize keys to uppercase so lookups match regardless of case.
        const upper: Record<string, LiveQuote> = {}
        for (const [k, v] of Object.entries(map)) upper[k.toUpperCase()] = v
        setPrices(upper)
        const n = Object.keys(upper).length
        if (n > 0) {
          showToast(`Updated ${n} price${n === 1 ? '' : 's'}`, 'success')
        } else {
          showToast('No live prices available right now', 'info')
        }
      }
    } catch (err) {
      console.error('Failed to refresh prices', err)
      showToast(plainMessage(err, "Couldn't refresh the prices. Try again."), 'error')
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

  return (
    <div class={`${styles.portfolioPage} page page-portfolio page-enter instrument-deck`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="portfolio-header" data-tour="portfolio-header">
            Portfolio
          </h1>
          <div class={styles.headerActions}>
            <button
              data-test-id="refresh-prices-btn"
              data-tour="portfolio-refresh"
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
              onClick={() => {
                holdingForm.openNew()
              }}
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
            <div class={styles.summaryValue}>{formatAmount(liveSummary()!.totalValue)}</div>
          </div>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Total Cost Basis</div>
            <div class={styles.summaryValue}>{formatAmount(liveSummary()!.totalCostBasis)}</div>
          </div>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Total Gain/Loss</div>
            <div
              class={`${styles.summaryValue} ${liveSummary()!.totalGain >= 0 ? styles.positive : styles.negative}`}
            >
              {formatAmount(liveSummary()!.totalGain)}
              <span class={styles.gainPercent}>
                ({formatPercent(liveSummary()!.totalGainPercent)})
              </span>
            </div>
          </div>
          <div class={styles.summaryCard}>
            <div class={styles.summaryLabel}>Holdings</div>
            <div class={styles.summaryValue}>{holdings().length}</div>
          </div>
        </div>
      </Show>

      <div data-tour="portfolio-holdings">
        {initialLoad() && holdings().length === 0 ? (
          <div class={styles.emptyState}>Loading portfolio...</div>
        ) : holdings().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No holdings yet</p>
            <p>Add your first stock or ETF to start tracking your portfolio.</p>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => {
                holdingForm.openNew()
              }}
            >
              Add Holding
            </button>
          </div>
        ) : (
          <div class={styles.contentGrid}>
            {/* Holdings Table */}
            <div class={styles.tableSection}>
              <OrbitalDivider id="portfolio-sec-holdings" label="Holdings" />
              <div class={styles.tableWrapper}>
                <table data-test-id="portfolio-holdings" class={styles.table}>
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
                    <For each={displayHoldings()}>
                      {(h) => (
                        <tr data-test-id="portfolio-holding-row">
                          <td>
                            <span data-test-id="portfolio-ticker" class={styles.ticker}>
                              {h.ticker}
                            </span>
                          </td>
                          <td class={styles.right}>{h.shares}</td>
                          <td class={styles.right}>{formatAmount(h.purchase_price)}</td>
                          <td class={styles.right}>
                            {formatAmount(h.currentPrice || h.purchase_price)}
                          </td>
                          <td class={styles.right}>{formatAmount(h.marketValue || 0)}</td>
                          <td
                            class={`${styles.right} ${(h.gain || 0) >= 0 ? styles.positive : styles.negative}`}
                          >
                            {formatAmount(h.gain || 0)}
                            <div class={styles.gainPercent}>
                              {formatPercent(h.gainPercent || 0)}
                            </div>
                          </td>
                          <td class={styles.right}>
                            <div class={styles.actions}>
                              <button
                                class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                                onClick={() => {
                                  holdingForm.openEdit(h)
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
                            </div>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Allocation Sidebar — holdings as a value constellation */}
            <div class={styles.sidebar}>
              <OrbitalDivider id="portfolio-sec-allocation" label="Allocation" />
              <div class={styles.sidebarCard}>
                <Show when={summary()}>
                  <div data-test-id="portfolio-allocation">
                    <CategoryOrbits
                      categories={liveSummary()!.allocation.map((a, i) => ({
                        category_name: a.ticker,
                        category_color: paletteColor(i),
                        amount: a.value,
                      }))}
                      label="value"
                      maxRings={8}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Show when={holdingForm.isOpen()}>
        <div
          data-test-id="portfolio-modal-overlay"
          class={styles.modalOverlay}
          onclick={(e) => {
            if (e.target === e.currentTarget) holdingForm.close()
          }}
        >
          <div
            data-test-id="portfolio-modal"
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 data-test-id="portfolio-modal-title" class={styles.modalTitle}>
                {holdingForm.editing() ? 'Edit Holding' : 'Add Holding'}
              </h3>
              <button
                class={styles.modalClose}
                onClick={() => {
                  holdingForm.close()
                }}
              >
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} {...holdingForm.attrs} data-test-id="portfolio-form">
              <FormNotice form={holdingForm} testId="portfolio-form-notice" />
              <Field
                form={holdingForm}
                name="ticker"
                label="Ticker Symbol"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    class={styles.formControl}
                    placeholder="e.g., AAPL, SPY, NVDA"
                    data-test-id="portfolio-form-ticker"
                    value={holdingForm.values.ticker}
                    onInput={(e) => holdingForm.set('ticker', e.currentTarget.value.toUpperCase())}
                    required
                  />
                )}
              </Field>
              <Field
                form={holdingForm}
                name="shares"
                label="Shares"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    inputmode="decimal"
                    class={styles.formControl}
                    placeholder="Number of shares"
                    data-test-id="portfolio-form-shares"
                    value={holdingForm.values.shares}
                    onInput={(e) => holdingForm.set('shares', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={holdingForm}
                name="purchase_price"
                label="Purchase Price (per share)"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    inputmode="decimal"
                    class={styles.formControl}
                    placeholder="0.00"
                    data-test-id="portfolio-form-price"
                    value={holdingForm.values.purchase_price}
                    onInput={(e) => holdingForm.set('purchase_price', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={holdingForm}
                name="purchase_date"
                label="Purchase Date"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="date"
                    class={styles.formControl}
                    data-test-id="portfolio-form-date"
                    value={holdingForm.values.purchase_date}
                    onInput={(e) => holdingForm.set('purchase_date', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={holdingForm}
                name="notes"
                label="Notes"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    class={styles.formControl}
                    placeholder="Optional notes"
                    data-test-id="portfolio-form-notes"
                    value={holdingForm.values.notes}
                    onInput={(e) => holdingForm.set('notes', e.currentTarget.value)}
                  />
                )}
              </Field>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => {
                    holdingForm.close()
                  }}
                >
                  Cancel
                </button>
                <SubmitButton
                  data-test-id="portfolio-modal-submit"
                  class={`${styles.btn} ${styles.btnPrimary}`}
                  busy={holdingForm.submitting()}
                  busyLabel={holdingForm.editing() ? 'Saving…' : 'Adding…'}
                >
                  {holdingForm.editing() ? 'Update' : 'Add'} Holding
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  )
}
