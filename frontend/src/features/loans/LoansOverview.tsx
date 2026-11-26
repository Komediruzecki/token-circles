/**
 * Every loan at a glance: what is owed in total, what goes out each month, which loan ends next,
 * then one card per loan with a ring for the share repaid and a way into What if.
 *
 * A card is a button: a click anywhere on it (or Enter or Space on its name) opens the loan's
 * payments on a chart under it (LoanChartPanel), across the whole row on a wide screen and
 * straight under the card on a phone. One is open at a time; a second click, the chart's Close or
 * Escape closes it. The rest of what can be done with a loan is in the card's menu: an extra
 * payment, every payment month by month, Edit and Delete.
 */
import { createEffect, createMemo, For, Match, onCleanup, Show, Switch } from 'solid-js'
import OverflowMenu from '../../components/OverflowMenu'
import { formatCurrency } from '../../core/api'
import { showConfirm } from '../../core/confirmStore'
import { usePageActive } from '../../core/pageVisibility'
import LoanChartPanel from './LoanChartPanel'
import { monthLong } from './loanCopy'
import LoanRing from './LoanRing'
import styles from './Loans.module.css'
import type { JSX } from 'solid-js'
import type { OverflowMenuItem } from '../../components/OverflowMenu'
import type { Formats } from './loanCopy'
import type { LoanRow } from './loanData'

export type ListStatus = 'loading' | 'ready' | 'error'

interface Props {
  loans: LoanRow[]
  status: ListStatus
  offline: boolean
  canWrite: (loan: LoanRow) => boolean
  ownerName: (loan: LoanRow) => string
  /** The loan whose chart is open under its card. */
  openId: number | null
  /** YYYY-MM-DD: the day the list was read. */
  today: string
  onToggle: (loan: LoanRow) => void
  onClose: () => void
  onAdd: () => void
  onEdit: (loan: LoanRow) => void
  onDelete: (loan: LoanRow) => void
  onWhatIf: (loan: LoanRow) => void
  onAddExtra: (loan: LoanRow) => void
  onSchedule: (loan: LoanRow) => void
  onRetry: () => void
  formats: Formats
  axisMoney: (amount: number) => string
}

/** The share of the principal repaid, as a whole percent. */
function percentRepaid(loan: LoanRow): number {
  if (!Number.isFinite(loan.principal) || loan.principal <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((loan.repaid / loan.principal) * 100)))
}

function endLine(loan: LoanRow): string {
  if (loan.paid)
    return loan.payoff_date ? `Paid off in ${monthLong(loan.payoff_date, 0)}` : 'Paid off'
  if (loan.payoff_date) return `Done in ${monthLong(loan.payoff_date, 0)}`
  return 'No due dates: the start date cannot be read'
}

const chartId = (id: number) => `loan-chart-${id}`

const icon = (path: JSX.Element) => () => (
  <svg
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    {path}
  </svg>
)

export default function LoansOverview(props: Props) {
  const open = createMemo(() => props.loans.filter((l) => !l.paid))
  const nextToFinish = createMemo(
    () =>
      open()
        .filter((l) => l.payoff_date)
        .sort((a, b) =>
          a.payoff_date! < b.payoff_date! ? -1 : a.payoff_date! > b.payoff_date! ? 1 : 0
        )[0]
  )
  const owed = createMemo(() => open().reduce((sum, l) => sum + l.remaining_balance, 0))
  const monthly = createMemo(() => open().reduce((sum, l) => sum + l.monthly_payment, 0))
  /** The first loan that still has payments to make: the tour's What if lands on its button. */
  const firstOpenId = createMemo(() => open()[0]?.id)
  /**
   * The cards by id, not by row. Every read of the list hands over new rows, and a list keyed by
   * row would build every card again, and with it an open chart: it would draw itself again, and
   * on the Worker read its loan again, each time any loan was saved.
   */
  const ids = createMemo(() => props.loans.map((l) => l.id))
  let list: HTMLDivElement | undefined

  const toggleOf = (id: number) =>
    list?.querySelector<HTMLButtonElement>(`[data-loan-toggle="${id}"]`) ?? null
  /** Pages stay in the document, hidden, while another is shown. */
  const active = usePageActive('loans')

  /**
   * Close the open chart, and give focus back to its card when it was in the chart or nowhere, or
   * on another card (Escape): brought into view, as focus somewhere out of sight is lost.
   */
  const close = (refocus: boolean) => {
    const id = props.openId
    props.onClose()
    const button = refocus && id !== null ? toggleOf(id) : null
    if (!button) return
    button.focus({ preventScroll: true })
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    button.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  }

  const focusWasHere = () => {
    const active = document.activeElement
    return !active || active === document.body || Boolean(list?.contains(active))
  }

  /**
   * A dialog or a menu open over the page, which takes Escape for itself. A dialog that stays in
   * the page while shut (Transactions' entry form, the subscription scan) still says aria-modal,
   * and so does one on a page that is not shown: neither has a box.
   */
  const overlayOpen = () =>
    Array.from(document.querySelectorAll('[aria-modal="true"], [role="menu"]')).some(
      (el) => el.getClientRects().length > 0
    )

  // Escape closes the chart: from the cards or the chart, or with nothing focused (a click in
  // Safari focuses no button). Only while this page is shown, and not when a dialog or a menu has
  // it, nor from elsewhere on the page (the sidebar on a phone closes on Escape too).
  createEffect(() => {
    if (props.openId === null || !active()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen()) return
      const target = e.target
      const nowhere =
        !(target instanceof Element) ||
        target === document.body ||
        target === document.documentElement
      if (!nowhere && !list?.contains(target as Element)) return
      e.preventDefault()
      close(true)
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })

  /**
   * Open or close a card's chart. A chart open higher up closes as this one opens, which would
   * pull the card up under the pointer: the page scrolls by as much, so the card stays put.
   */
  const toggle = (loan: LoanRow, button: HTMLButtonElement) => {
    // A click focuses no button in Safari: this one has to hold focus for Escape to find it.
    button.focus({ preventScroll: true })
    const card = button.closest('article')
    const before = card?.getBoundingClientRect().top ?? 0
    props.onToggle(loan)
    const after = card?.getBoundingClientRect().top ?? 0
    if (after !== before) window.scrollBy({ top: after - before, behavior: 'auto' })
  }

  /**
   * A card's menu. Built again only when what it offers changes: every list read hands the card a
   * new row, and new items would build the open menu's buttons again and drop focus off them. Each
   * item reads the card's latest row when picked.
   */
  const menu = (loan: () => LoanRow, writable: boolean, paid: boolean): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = []
    if (writable && !paid) {
      items.push({
        label: 'Add an extra payment',
        testId: 'loans-item-add-extra',
        icon: icon(
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </>
        ),
        onSelect: () => {
          props.onAddExtra(loan())
        },
      })
    }
    items.push({
      label: 'See every payment',
      testId: 'loans-item-schedule',
      icon: icon(<path d="M4 6h16M4 12h16M4 18h10" />),
      onSelect: () => {
        props.onSchedule(loan())
      },
    })
    if (writable) {
      items.push(
        {
          label: 'Edit',
          testId: 'loans-item-edit',
          icon: icon(
            <>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </>
          ),
          onSelect: () => {
            props.onEdit(loan())
          },
        },
        {
          label: 'Delete',
          testId: 'loans-item-delete',
          danger: true,
          icon: icon(
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          ),
          onSelect: () => {
            const row = loan()
            void showConfirm(
              `Delete ${row.name}? Its extra payments and rate periods go with it. This cannot be undone.`,
              { confirmText: 'Delete', danger: true }
            ).then((ok) => {
              if (ok) props.onDelete(row)
            })
          },
        }
      )
    }
    return items
  }

  return (
    <>
      <header class={styles.header}>
        <div>
          <h1 class={styles.title} data-test-id="loans-header" data-tour="loans-header">
            Loans
          </h1>
          <p class={styles.subtitle} data-test-id="loans-subtitle">
            Track loans: what is left on each, when it ends, and what paying extra would change.
          </p>
        </div>
        <button
          type="button"
          class={styles.buttonPrimary}
          data-test-id="add-loan-btn"
          data-tour="loans-add"
          onClick={() => {
            props.onAdd()
          }}
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 6v12M6 12h12" />
          </svg>
          Add loan
        </button>
      </header>

      <Show when={props.loans.length > 0}>
        <section class={styles.strip} data-test-id="loans-summary" aria-label="All loans">
          <div class={styles.stripItem} data-test-id="loans-summary-card">
            <div class={styles.stripLabel}>Owed in total</div>
            <div class={styles.stripValue} data-test-id="loans-summary-owed">
              {formatCurrency(owed())}
            </div>
          </div>
          <div class={styles.stripItem} data-test-id="loans-summary-card">
            <div class={styles.stripLabel}>Paid each month</div>
            <div class={styles.stripValue} data-test-id="loans-summary-monthly">
              {formatCurrency(monthly())}
            </div>
            <div class={styles.stripNote}>
              {open().length === 1 ? 'for 1 loan' : `across ${open().length} loans`}
            </div>
          </div>
          <div class={styles.stripItem} data-test-id="loans-summary-card">
            <div class={styles.stripLabel}>Next to finish</div>
            <Show
              when={nextToFinish()}
              fallback={
                <div class={styles.stripValue} data-test-id="loans-summary-next">
                  {open().length === 0 ? 'All paid off' : 'No due dates'}
                </div>
              }
            >
              {(loan) => (
                <>
                  <div class={styles.stripValue} data-test-id="loans-summary-next">
                    {loan().name}
                  </div>
                  <div class={styles.stripNote}>in {monthLong(loan().payoff_date, 0)}</div>
                </>
              )}
            </Show>
          </div>
        </section>
      </Show>

      <section data-test-id="loans-list" data-tour="loans-list" aria-label="Your loans">
        <Switch>
          <Match when={props.status === 'loading' && props.loans.length === 0}>
            <div class={styles.cards} data-test-id="loading-state" aria-busy="true">
              <span class={styles.visuallyHidden}>Loading your loans</span>
              <div class={styles.skeleton} />
              <div class={styles.skeleton} />
            </div>
          </Match>
          <Match when={props.status === 'error' && props.loans.length === 0}>
            <div class={styles.error} role="alert" data-test-id="loans-error">
              <p>
                {props.offline
                  ? 'You are offline, so your loans cannot load. They will once you reconnect.'
                  : 'Your loans did not load. Try again in a moment.'}
              </p>
              <button
                type="button"
                class={styles.button}
                onClick={() => {
                  props.onRetry()
                }}
              >
                Try again
              </button>
            </div>
          </Match>
          <Match when={props.loans.length === 0}>
            <div class={styles.empty} data-test-id="loans-empty">
              <h2>No loans yet</h2>
              <p>Add one to see what is left to pay, when it ends and what it costs in interest.</p>
              <button
                type="button"
                class={styles.buttonPrimary}
                onClick={() => {
                  props.onAdd()
                }}
              >
                Add a loan
              </button>
              <p class={styles.hint} data-tour="loans-what-if">
                Then open What if on it: pay a bit more each month or a one-off amount, and see how
                much sooner it is done.
              </p>
            </div>
          </Match>
          <Match when={true}>
            <span id="loans-card-hint" hidden>
              Shows its payments on a chart
            </span>
            <div class={styles.cards} ref={list}>
              <For each={ids()}>
                {(id) => {
                  // The row this card is for, from the latest list; the last one seen while the
                  // card is on its way out.
                  let last = props.loans.find((l) => l.id === id)!
                  const loan = () => (last = props.loans.find((l) => l.id === id) ?? last)
                  const isOpen = () => props.openId === id
                  const writable = createMemo(() => props.canWrite(loan()))
                  const paid = createMemo(() => loan().paid)
                  const items = createMemo(() => menu(loan, writable(), paid()))
                  return (
                    <>
                      <article
                        class={styles.card}
                        data-test-id="loans-item"
                        data-open={isOpen() ? '' : undefined}
                      >
                        <div class={styles.cardTop}>
                          <LoanRing
                            share={loan().principal > 0 ? loan().repaid / loan().principal : 0}
                            testId="loans-item-progress"
                          />
                          <div>
                            <h3 class={styles.cardName}>
                              <button
                                type="button"
                                class={styles.cardToggle}
                                data-test-id="loans-item-name"
                                data-loan-toggle={id}
                                aria-expanded={isOpen() ? 'true' : 'false'}
                                aria-controls={isOpen() ? chartId(id) : undefined}
                                aria-describedby="loans-card-hint"
                                onClick={(e) => {
                                  toggle(loan(), e.currentTarget)
                                }}
                              >
                                {loan().name}
                                <span class={styles.cardHandle} aria-hidden="true">
                                  <svg
                                    width="12"
                                    height="12"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.4"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M6 9l6 6 6-6" />
                                  </svg>
                                </span>
                              </button>
                            </h3>
                            <p class={styles.cardSub} data-test-id="loans-item-payoff">
                              {endLine(loan())}
                            </p>
                            <Show when={!props.canWrite(loan())}>
                              <p class={styles.cardSub} data-test-id="loans-item-owner">
                                Belongs to {props.ownerName(loan())}
                              </p>
                            </Show>
                          </div>
                          <OverflowMenu
                            label={`More actions for ${loan().name}`}
                            testId="loans-item-menu"
                            menuTestId="loans-menu"
                            class={styles.cardMenu}
                            items={items()}
                          />
                        </div>

                        <dl class={styles.figures} data-test-id="loans-item-details">
                          <div>
                            <dt>Owed</dt>
                            <dd data-test-id="loans-item-remaining">
                              {formatCurrency(loan().remaining_balance)}
                            </dd>
                          </div>
                          <div>
                            <dt>Installment</dt>
                            <dd data-test-id="loans-item-monthly">
                              {formatCurrency(loan().monthly_payment)}
                            </dd>
                          </div>
                          <div>
                            <dt>Rate</dt>
                            <dd data-test-id="loans-item-rate">{loan().interest_rate}%</dd>
                          </div>
                        </dl>

                        <div class={styles.cardFoot}>
                          <p class={styles.repaid}>
                            <span data-test-id="loans-item-progress-percent">
                              {percentRepaid(loan())}% repaid
                            </span>
                            {': '}
                            <span data-test-id="loans-item-total-paid">
                              {formatCurrency(loan().repaid)}
                            </span>
                            {' of '}
                            <span data-test-id="loans-item-principal">
                              {formatCurrency(loan().principal)}
                            </span>
                          </p>
                          <Show when={!loan().paid}>
                            <button
                              type="button"
                              class={styles.buttonOutline}
                              data-test-id="loans-item-what-if"
                              data-tour={id === firstOpenId() ? 'loans-what-if' : undefined}
                              onClick={() => {
                                props.onWhatIf(loan())
                              }}
                            >
                              What if
                            </button>
                          </Show>
                        </div>
                      </article>
                      <Show when={isOpen()}>
                        <LoanChartPanel
                          id={chartId(id)}
                          row={loan()}
                          today={props.today}
                          formats={props.formats}
                          axisMoney={props.axisMoney}
                          onClose={() => {
                            close(focusWasHere())
                          }}
                        />
                      </Show>
                    </>
                  )
                }}
              </For>
            </div>
            <Show when={open().length === 0}>
              <p class={styles.hint} data-tour="loans-what-if">
                Every loan here is paid off. Add one to try What if: see how much sooner a bit extra
                each month would finish it.
              </p>
            </Show>
          </Match>
        </Switch>
      </section>
    </>
  )
}
