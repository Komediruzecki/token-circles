/**
 * Every loan at a glance: what is owed in total, what goes out each month, which loan ends next,
 * then one card per loan with a ring for the share repaid and a way into What if.
 */
import { createMemo, For, Match, Show, Switch } from 'solid-js'
import ConfirmButton from '../../components/ConfirmButton'
import { formatCurrency } from '../../core/api'
import { monthLong } from './loanCopy'
import LoanRing from './LoanRing'
import styles from './Loans.module.css'
import type { LoanRow } from './loanData'

export type ListStatus = 'loading' | 'ready' | 'error'

interface Props {
  loans: LoanRow[]
  status: ListStatus
  offline: boolean
  canWrite: (loan: LoanRow) => boolean
  ownerName: (loan: LoanRow) => string
  onAdd: () => void
  onEdit: (loan: LoanRow) => void
  onDelete: (loan: LoanRow) => void
  onWhatIf: (loan: LoanRow) => void
  onRetry: () => void
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
            <div class={styles.cards}>
              <For each={props.loans}>
                {(loan) => (
                  <article class={styles.card} data-test-id="loans-item">
                    <div class={styles.cardTop}>
                      <LoanRing
                        share={loan.principal > 0 ? loan.repaid / loan.principal : 0}
                        testId="loans-item-progress"
                      />
                      <div>
                        <h3 class={styles.cardName}>
                          <a href={`#loans/${loan.id}/schedule`} data-test-id="loans-item-name">
                            {loan.name}
                          </a>
                        </h3>
                        <p class={styles.cardSub} data-test-id="loans-item-payoff">
                          {endLine(loan)}
                        </p>
                        <Show when={!props.canWrite(loan)}>
                          <p class={styles.cardSub} data-test-id="loans-item-owner">
                            Belongs to {props.ownerName(loan)}
                          </p>
                        </Show>
                      </div>
                      <Show when={props.canWrite(loan)}>
                        <div class={styles.cardActions}>
                          <button
                            type="button"
                            class={styles.buttonQuiet}
                            data-test-id="loans-item-edit"
                            aria-label={`Edit ${loan.name}`}
                            onClick={() => {
                              props.onEdit(loan)
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
                              <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <span data-test-id="loans-item-delete">
                            <ConfirmButton
                              class={styles.buttonQuiet}
                              aria-label={`Delete ${loan.name}`}
                              message={`Delete ${loan.name}? Its extra payments and rate periods go with it. This cannot be undone.`}
                              onConfirm={() => {
                                props.onDelete(loan)
                              }}
                              label={
                                <svg
                                  width="16"
                                  height="16"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              }
                            />
                          </span>
                        </div>
                      </Show>
                    </div>

                    <dl class={styles.figures} data-test-id="loans-item-details">
                      <div>
                        <dt>Owed</dt>
                        <dd data-test-id="loans-item-remaining">
                          {formatCurrency(loan.remaining_balance)}
                        </dd>
                      </div>
                      <div>
                        <dt>Installment</dt>
                        <dd data-test-id="loans-item-monthly">
                          {formatCurrency(loan.monthly_payment)}
                        </dd>
                      </div>
                      <div>
                        <dt>Rate</dt>
                        <dd data-test-id="loans-item-rate">{loan.interest_rate}%</dd>
                      </div>
                    </dl>

                    <div class={styles.cardFoot}>
                      <p class={styles.repaid}>
                        <span data-test-id="loans-item-progress-percent">
                          {percentRepaid(loan)}% repaid
                        </span>
                        {': '}
                        <span data-test-id="loans-item-total-paid">
                          {formatCurrency(loan.repaid)}
                        </span>
                        {' of '}
                        <span data-test-id="loans-item-principal">
                          {formatCurrency(loan.principal)}
                        </span>
                      </p>
                      <Show when={!loan.paid}>
                        <button
                          type="button"
                          class={styles.buttonOutline}
                          data-test-id="loans-item-what-if"
                          data-tour={loan.id === firstOpenId() ? 'loans-what-if' : undefined}
                          onClick={() => {
                            props.onWhatIf(loan)
                          }}
                        >
                          What if
                        </button>
                      </Show>
                    </div>
                  </article>
                )}
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
