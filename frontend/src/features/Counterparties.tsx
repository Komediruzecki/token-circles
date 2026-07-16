/**
 * Counterparties Page
 * Aggregates beneficiary/payor data to show "who owes who"
 */
import { createMemo, createSignal, For } from 'solid-js'
import CounterpartyMeridian from '../components/CounterpartyMeridian'
import OrbitalDivider from '../components/OrbitalDivider'
import { formatCurrency } from '../core/api'
import { apiGet } from '../core/api'
import { useAppState } from '../core/appStore'
import { refetchOnActive } from '../core/pageVisibility'
import styles from './CounterpartiesPage.module.css'

interface Counterparty {
  name: string
  incoming: number
  outgoing: number
  net: number
  transaction_count: number
}

type SortField = 'name' | 'incoming' | 'outgoing' | 'net' | 'transaction_count'

export default function Counterparties() {
  const state = useAppState()
  const [counterparties, setCounterparties] = createSignal<Counterparty[]>([])
  const [initialLoad, setInitialLoad] = createSignal(true)
  const [sortField, setSortField] = createSignal<SortField>('net')
  const [sortAsc, setSortAsc] = createSignal(false)

  const loadData = async () => {
    try {
      const data = await apiGet<Counterparty[]>('/api/counterparties')
      if (Array.isArray(data)) {
        setCounterparties(data)
      }
    } catch {
      // keep empty
    } finally {
      setInitialLoad(false)
    }
  }

  // Reload on profile change — but only when this page is visible. A hidden page is
  // marked stale and refetches once when next shown, so a profile switch no longer
  // fans out to every mounted keep-alive page at once.
  refetchOnActive(
    'counterparties',
    () => {
      void state.profileVersion
    },
    () => {
      void loadData()
    }
  )

  const handleSort = (field: SortField) => {
    if (sortField() === field) {
      setSortAsc(!sortAsc())
    } else {
      setSortField(field)
      setSortAsc(field === 'name')
    }
  }

  const sorted = createMemo(() => {
    const list = [...counterparties()]
    list.sort((a, b) => {
      const aVal = a[sortField()]
      const bVal = b[sortField()]
      const cmp =
        typeof aVal === 'string'
          ? aVal.localeCompare(bVal as string)
          : (aVal as number) - (bVal as number)
      return sortAsc() ? cmp : -cmp
    })
    return list
  })

  const sortIndicator = (field: SortField) => {
    if (sortField() !== field) return ''
    return sortAsc() ? ' ↑' : ' ↓'
  }

  const totalOwed = createMemo(() => {
    let sum = 0
    for (const c of counterparties()) {
      if (c.net < 0) sum += Math.abs(c.net)
    }
    return sum
  })

  const totalOwing = createMemo(() => {
    let sum = 0
    for (const c of counterparties()) {
      if (c.net > 0) sum += c.net
    }
    return sum
  })

  const netPosition = createMemo(() => {
    let sum = 0
    for (const c of counterparties()) sum += c.net
    return sum
  })

  return (
    <div class={`${styles.page} page page-counterparties page-enter`}>
      <div class={styles.pageHeader}>
        <div>
          <h2 data-tour="counterparties-header">Counterparties</h2>
          <p>Aggregated view of who you pay and who pays you</p>
        </div>
      </div>

      <div data-tour="counterparties-content">
        {initialLoad() && counterparties().length === 0 ? (
          <div class={styles.loadingState}>Loading counterparties...</div>
        ) : counterparties().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No counterparty data yet</p>
            <p>Transactions with beneficiary or payor fields will appear here.</p>
          </div>
        ) : (
          <>
            <div class={styles.summaryRow}>
              <div class={styles.summaryCard}>
                <div class={styles.summaryLabel}>We Owe</div>
                <div class={`${styles.summaryValue} ${styles.negative}`}>
                  {formatCurrency(totalOwed())}
                </div>
              </div>
              <div class={styles.summaryCard}>
                <div class={styles.summaryLabel}>Owed to Us</div>
                <div class={`${styles.summaryValue} ${styles.positive}`}>
                  {formatCurrency(totalOwing())}
                </div>
              </div>
              <div class={styles.summaryCard}>
                <div class={styles.summaryLabel}>Net Position</div>
                <div
                  class={`${styles.summaryValue} ${netPosition() >= 0 ? styles.positive : styles.negative}`}
                >
                  {formatCurrency(netPosition())}
                </div>
              </div>
            </div>

            <OrbitalDivider id="cp-sec-meridian" label="Balance Meridian" />
            <div class={styles.meridianCard}>
              <p class={styles.meridianSub}>
                Who owes who, ranked by net — nodes sized by transaction count
              </p>
              <CounterpartyMeridian
                rows={counterparties().map((c) => ({
                  name: c.name,
                  net: c.net,
                  transaction_count: c.transaction_count,
                }))}
                maxRows={8}
              />
            </div>

            <OrbitalDivider
              id="cp-sec-ledger"
              label="By Counterparty"
              meta={`${counterparties().length} counterparties`}
            />
            <div class={styles.tableWrap}>
              <table class={styles.table}>
                <thead>
                  <tr>
                    <th
                      onClick={() => {
                        handleSort('name')
                      }}
                    >
                      Counterparty{sortIndicator('name')}
                    </th>
                    <th
                      onClick={() => {
                        handleSort('incoming')
                      }}
                    >
                      Received{sortIndicator('incoming')}
                    </th>
                    <th
                      onClick={() => {
                        handleSort('outgoing')
                      }}
                    >
                      Paid{sortIndicator('outgoing')}
                    </th>
                    <th
                      onClick={() => {
                        handleSort('net')
                      }}
                    >
                      Net{sortIndicator('net')}
                    </th>
                    <th
                      onClick={() => {
                        handleSort('transaction_count')
                      }}
                    >
                      Txs{sortIndicator('transaction_count')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={sorted()}>
                    {(c) => (
                      <tr>
                        <td>
                          <span class={styles.counterpartyName}>{c.name}</span>
                        </td>
                        <td>
                          <span class={`${styles.amount} ${styles.incoming}`}>
                            {formatCurrency(c.incoming)}
                          </span>
                        </td>
                        <td>
                          <span class={`${styles.amount} ${styles.outgoing}`}>
                            {formatCurrency(c.outgoing)}
                          </span>
                        </td>
                        <td>
                          <span
                            class={
                              c.net > 0
                                ? styles.netPositive
                                : c.net < 0
                                  ? styles.netNegative
                                  : styles.netNeutral
                            }
                          >
                            {formatCurrency(c.net)}
                          </span>
                        </td>
                        <td>
                          <span class={styles.count}>{c.transaction_count}</span>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
