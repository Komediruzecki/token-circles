/**
 * One loan: its name and where it stands, then three tabs. Compare (what a what-if changes),
 * Month by month (the schedule) and Extra payments (what is saved on the loan).
 *
 * The page runs the shared engine on the loan as stored, so every figure here is the schedule the
 * calculate route returns. Local-first rows carry their rate periods and extra payments; the
 * Worker's list does not, so in cloud mode the loan's own read supplies them.
 */
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import { nextPaymentMonth, runScenario, templateOptions } from '../../../../shared/loanScenarios'
import { todayUtc } from '../../../../shared/loanSchedule'
import ConfirmButton from '../../components/ConfirmButton'
import { apiDelete, apiGet, apiPost, formatCurrency, showToast } from '../../core/api'
import { refetchOnActive } from '../../core/pageVisibility'
import LoanCompare from './LoanCompare'
import { monthLong } from './loanCopy'
import { engineInput, hasDetails, savedExtras } from './loanData'
import LoanExtras from './LoanExtras'
import { LOAN_TABS, loansHash } from './loanRoute'
import styles from './Loans.module.css'
import LoanSchedule, { dayLabel } from './LoanSchedule'
import type { Formats } from './loanCopy'
import type { LoanRow, SavedExtra, StoredLoan } from './loanData'
import type { LoansRoute, LoanTab, ScenarioPick } from './loanRoute'
import type { ListStatus } from './LoansOverview'

type LoanRoute = Extract<LoansRoute, { view: 'loan' }>

interface Props {
  route: LoanRoute
  row: LoanRow | undefined
  listStatus: ListStatus
  canWrite: boolean
  ownerName: string
  /** The overview's What if was clicked for this loan: open Compare on its first preset. */
  pendingWhatIf: boolean
  onPendingDone: () => void
  navigate: (route: LoansRoute, options?: { replace?: boolean }) => void
  onEdit: (row: LoanRow, focusRates?: boolean) => void
  onDelete: (row: LoanRow) => Promise<void>
  formats: Formats
  axisMoney: (amount: number) => string
}

const TAB_NAMES: Record<LoanTab, string> = {
  compare: 'Compare',
  schedule: 'Month by month',
  extras: 'Extra payments',
}

export default function LoanDetail(props: Props) {
  const [record, setRecord] = createSignal<StoredLoan | null>(null)
  const [recordStatus, setRecordStatus] = createSignal<'loading' | 'ready' | 'error'>('loading')
  let loads = 0

  /** The loan with its rate periods and extra payments, newest answer wins. */
  const load = async () => {
    const row = props.row
    const mine = ++loads
    if (!row) {
      setRecord(null)
      setRecordStatus('loading')
      return
    }
    if (hasDetails(row.listed)) {
      setRecord(row.listed)
      setRecordStatus('ready')
      return
    }
    // A record already on screen stays there while it refreshes.
    if (record()?.id !== row.id) setRecordStatus('loading')
    try {
      const full = await apiGet<StoredLoan>(`/api/loans/${row.id}`)
      if (mine !== loads) return
      setRecord(full)
      setRecordStatus('ready')
    } catch (err) {
      if (mine !== loads) return
      console.error('Failed to load loan:', err)
      setRecordStatus('error')
    }
  }

  // The list reloads after every loan write and on a profile change, which hands this page a new
  // row: that is what refreshes the loan here, so no write below reloads anything by hand.
  refetchOnActive(
    'loans',
    () => props.row,
    () => {
      void load()
    }
  )

  const today = todayUtc()
  const input = createMemo(() => {
    const r = record()
    return r && r.id === props.row?.id ? engineInput(r) : null
  })
  const from = createMemo(() => {
    const loan = input()
    return loan ? nextPaymentMonth(loan, today) : null
  })
  const plan = createMemo(() => {
    const loan = input()
    return loan ? runScenario(loan, from() ?? 1) : null
  })
  const options = createMemo(() => {
    const loan = input()
    const month = from()
    return loan && month !== null ? templateOptions(loan, month) : []
  })
  const extras = createMemo(() => {
    const r = record()
    return r ? savedExtras(r) : []
  })

  // What if from the overview: open Compare on the first template's first preset, in place of
  // the address without one, so Back returns to the overview. In cloud mode the loan is fetched
  // first, and a tab picked in that moment wins: the preset is only ever put on Compare.
  createEffect(() => {
    if (!props.pendingWhatIf || !input()) return
    const first = options()[0]
    if (first && !props.route.b && props.route.tab === 'compare') {
      props.navigate(
        { ...props.route, b: { choice: first.first, mode: 'shorten' } },
        { replace: true }
      )
    }
    props.onPendingDone()
  })

  const go = (tab: LoanTab) => {
    props.navigate({ ...props.route, tab })
  }
  const hrefFor = (tab: LoanTab) => loansHash({ ...props.route, tab })

  const onTabKey = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
    let index = LOAN_TABS.indexOf(props.route.tab)
    if (e.key === 'Home') index = 0
    else if (e.key === 'End') index = LOAN_TABS.length - 1
    else if (keys[e.key]) index = (index + keys[e.key] + LOAN_TABS.length) % LOAN_TABS.length
    else return
    e.preventDefault()
    const tab = LOAN_TABS[index]
    go(tab)
    queueMicrotask(() => document.getElementById(`loan-tab-${tab}`)?.focus())
  }

  const pick = (b: ScenarioPick | null, a: ScenarioPick | null) => {
    props.navigate({ ...props.route, tab: 'compare', b, a }, { replace: true })
  }

  const addExtra = async (extra: { month: number; amount: number; note: string }) => {
    const row = props.row
    if (!row) return false
    try {
      await apiPost(`/api/loans/${row.id}/prepayments`, extra)
      showToast('Extra payment saved', 'success')
      return true
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The extra payment was not saved.', 'error')
      return false
    }
  }

  const deleteExtra = async (extra: SavedExtra) => {
    const row = props.row
    if (!row) return
    try {
      await apiDelete(`/api/loans/${row.id}/prepayments/${extra.ref}`)
      showToast('Extra payment removed', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The extra payment was not removed.', 'error')
    }
  }

  return (
    <div class={styles.detail} data-test-id="loans-detail">
      <a class={`${styles.link} ${styles.back}`} href="#loans" data-test-id="loans-detail-back">
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All loans
      </a>

      <Switch>
        <Match when={!props.row && props.listStatus !== 'ready'}>
          <div class={styles.skeleton} data-test-id="loading-state" aria-busy="true">
            <span class={styles.visuallyHidden}>Loading the loan</span>
          </div>
        </Match>
        <Match when={!props.row}>
          <div class={styles.empty} data-test-id="loans-detail-not-found">
            <h1 class={styles.title}>This loan is not here</h1>
            <p>
              It may have been deleted, or it belongs to a profile that is not selected. Your other
              loans are on the overview.
            </p>
            <a class={styles.buttonPrimary} href="#loans">
              Back to all loans
            </a>
          </div>
        </Match>
        <Match when={props.row}>
          {(row) => (
            <>
              <header class={styles.header}>
                <div>
                  <h1 class={styles.title} data-test-id="loans-detail-name">
                    {row().name}
                  </h1>
                  <p class={styles.facts} data-test-id="loans-detail-facts">
                    <span>
                      <strong>{formatCurrency(row().remaining_balance)}</strong> owed
                    </span>
                    <span>
                      <strong>{formatCurrency(row().monthly_payment)}</strong> a month
                    </span>
                    <span>
                      <strong>{row().interest_rate}%</strong> rate
                    </span>
                    <span data-test-id="loans-detail-next-payment">
                      {row().next_payment_date
                        ? `Next payment ${dayLabel(row().next_payment_date!)}`
                        : row().paid
                          ? 'Paid off'
                          : 'No due dates: the start date cannot be read'}
                    </span>
                    <Show when={!row().paid && row().payoff_date}>
                      <span>Done in {monthLong(row().payoff_date, 0)}</span>
                    </Show>
                  </p>
                </div>
                <Show when={props.canWrite}>
                  <div class={styles.cardActions}>
                    <button
                      type="button"
                      class={styles.button}
                      data-test-id="loans-detail-edit"
                      onClick={() => {
                        props.onEdit(row())
                      }}
                    >
                      Edit
                    </button>
                    <span data-test-id="loans-detail-delete">
                      <ConfirmButton
                        class={styles.button}
                        message={`Delete ${row().name}? Its extra payments and rate periods go with it. This cannot be undone.`}
                        onConfirm={() => props.onDelete(row())}
                        label="Delete"
                      />
                    </span>
                  </div>
                </Show>
              </header>

              <Show when={!props.canWrite}>
                <p class={styles.notice} data-test-id="loans-detail-owner">
                  This loan belongs to {props.ownerName}. Switch to {props.ownerName} to change it.
                </p>
              </Show>

              <div class={styles.tabs} role="tablist" aria-label={row().name} onKeyDown={onTabKey}>
                <For each={LOAN_TABS}>
                  {(tab) => (
                    <a
                      role="tab"
                      id={`loan-tab-${tab}`}
                      class={styles.tab}
                      href={hrefFor(tab)}
                      aria-selected={props.route.tab === tab}
                      aria-controls="loan-panel"
                      tabIndex={props.route.tab === tab ? 0 : -1}
                      data-test-id={`loans-tab-${tab}`}
                      onClick={(e) => {
                        e.preventDefault()
                        go(tab)
                      }}
                    >
                      {TAB_NAMES[tab]}
                    </a>
                  )}
                </For>
              </div>

              <div
                class={styles.panel}
                role="tabpanel"
                id="loan-panel"
                aria-labelledby={`loan-tab-${props.route.tab}`}
              >
                <Switch>
                  <Match when={recordStatus() === 'error' && !input()}>
                    <div class={styles.error} role="alert" data-test-id="loans-detail-error">
                      <p>This loan's payments did not load. Try again in a moment.</p>
                      <button type="button" class={styles.button} onClick={() => void load()}>
                        Try again
                      </button>
                    </div>
                  </Match>
                  <Match when={!input() || !plan()}>
                    <div class={styles.skeleton} aria-busy="true">
                      <span class={styles.visuallyHidden}>Loading the loan's payments</span>
                    </div>
                  </Match>
                  <Match when={props.route.tab === 'compare'}>
                    <LoanCompare
                      loan={input()!}
                      from={from()}
                      options={options()}
                      b={props.route.b}
                      a={props.route.a}
                      onPick={pick}
                      formats={props.formats}
                      axisMoney={props.axisMoney}
                    />
                  </Match>
                  <Match when={props.route.tab === 'schedule'}>
                    <div data-test-id="loans-amortization">
                      <LoanSchedule
                        rows={plan()!.rows}
                        loanName={row().name}
                        neverPaysOffFrom={plan()!.neverPaysOffFrom}
                        formats={props.formats}
                      />
                    </div>
                  </Match>
                  <Match when={props.route.tab === 'extras'}>
                    <LoanExtras
                      loanName={row().name}
                      startDate={input()!.start_date}
                      baseRate={row().interest_rate}
                      extras={extras()}
                      ratePeriods={record()?.rate_periods ?? []}
                      lastMonth={plan()!.payoffMonth ?? row().term_months}
                      nextMonth={Math.min(from() ?? 1, plan()!.payoffMonth ?? row().term_months)}
                      canWrite={props.canWrite}
                      ownerName={props.ownerName}
                      compareHref={hrefFor('compare')}
                      formats={props.formats}
                      onAdd={addExtra}
                      onDelete={deleteExtra}
                      onEditRates={() => {
                        props.onEdit(row(), true)
                      }}
                    />
                  </Match>
                </Switch>
              </div>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
