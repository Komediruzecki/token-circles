/**
 * The chart under a loan's card: a sentence saying how far along the payments are, the four
 * figures today marks (repaid so far, still owed, months left, the last payment) and the balance
 * over the loan's whole life (LoanPayoffChart). It opens in the overview's grid, across the whole
 * row under the card on a wide screen and straight under the card on a phone.
 *
 * The schedule is the shared engine's on the loan as stored, as on the loan's own page. Local-first
 * list rows carry the rate periods and extra payments it needs; on the Worker the loan's own read
 * supplies them, so the chart waits for it behind a placeholder of the same height.
 */
import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import { formatCurrency } from '../../core/api'
import { monthShort, timelineDescription, timelineSentence } from './loanCopy'
import { engineInput } from './loanData'
import LoanPayoffChart from './LoanPayoffChart'
import { createLoanRecord } from './loanRecord'
import styles from './Loans.module.css'
import { loanTimeline } from './loanTimeline'
import type { Formats } from './loanCopy'
import type { LoanRow } from './loanData'

interface Props {
  /** The panel's id, which the card's button controls. */
  id: string
  row: LoanRow
  /** YYYY-MM-DD: the day the list was read, which the card's figures are worked out for. */
  today: string
  formats: Formats
  axisMoney: (amount: number) => string
  onClose: () => void
}

/**
 * Room kept above the card when the panel is brought into view, under whatever the page keeps
 * clear at its top: on a phone the menu button floats there (Layout.module.css sets the page's
 * scroll-padding-top to its height), and a card scrolled to 16 px went under it.
 */
const MARGIN = 16
/**
 * Room kept under the panel: the floating add button takes the bottom 78 px of the window
 * (Layout.module.css .fab), right over the end of the line, where the last payment is.
 */
const BELOW = 88

export default function LoanChartPanel(props: Props) {
  const { record, status, load } = createLoanRecord(() => props.row)
  // Today as the list read it, not as the panel opened: past midnight on a payment day, a list read
  // moves the card's Owed on, and the chart with it.
  const timeline = createMemo(() => {
    const r = record()
    return r && r.id === props.row.id ? loanTimeline(engineInput(r), props.today) : null
  })
  let section!: HTMLElement
  let box!: HTMLDivElement
  /**
   * The opening has played: the drop-in, the line drawn and today lit. A page that is not shown
   * is display: none, which starts a CSS animation over when it shows again, so from here on the
   * chart is just there on coming back to Loans.
   */
  const [played, setPlayed] = createSignal(false)
  const settle = () => {
    const opening =
      typeof section.getAnimations === 'function' ? section.getAnimations({ subtree: true }) : []
    // Leaving the page part way cancels the rest, which settles it as well.
    void Promise.allSettled(opening.map((animation) => animation.finished)).then(() => {
      setPlayed(true)
    })
  }

  // Opened low on the screen, the panel opens out of sight: bring all of it into view, without
  // taking its card off the top. Once its loan has loaded (a loan from the server arrives a moment
  // later, in place of a shorter placeholder), a frame on, when the chart has its height.
  const reveal = () => {
    const card = section.previousElementSibling
    const top = section.getBoundingClientRect().top
    const below = top + box.offsetHeight + BELOW - window.innerHeight
    if (below <= 0) return
    const clear = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop)
    const cardTop = card
      ? card.getBoundingClientRect().top - MARGIN - (Number.isFinite(clear) ? clear : 0)
      : top
    const by = Math.min(below, Math.max(0, cardTop))
    if (by <= 0) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' })
  }
  let frame = 0
  createEffect(() => {
    if (frame === 0 && status() !== 'loading') {
      frame = requestAnimationFrame(() => {
        reveal()
        settle()
      })
    }
  })
  onCleanup(() => {
    cancelAnimationFrame(frame)
  })

  const left = (t: NonNullable<ReturnType<typeof timeline>>) =>
    t.left === null ? '–' : String(t.left)
  const payoff = (t: NonNullable<ReturnType<typeof timeline>>) =>
    t.neverPaysOffFrom !== null
      ? 'Never at this rate'
      : monthShort(t.payoffDate, t.payoffMonth ?? t.rows.length)

  return (
    <section
      ref={section}
      id={props.id}
      class={styles.chartPanel}
      aria-label={`${props.row.name}: payments over time`}
      data-test-id="loans-item-chart"
      data-played={played() ? '' : undefined}
    >
      <div ref={box} class={styles.chartBox}>
        <div class={styles.chartHead}>
          <p class={styles.chartSentence} data-test-id="loans-chart-sentence">
            <Show when={timeline()} fallback={`${props.row.name}: payments over time`}>
              {(t) => timelineSentence(t(), props.formats)}
            </Show>
          </p>
          <button
            type="button"
            class={styles.buttonQuiet}
            aria-label="Close"
            title="Close"
            data-test-id="loans-chart-close"
            onClick={() => {
              props.onClose()
            }}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <Switch>
          <Match when={status() === 'error' && !timeline()}>
            <div class={styles.error} role="alert" data-test-id="loans-chart-error">
              <p>This loan's payments did not load. Try again in a moment.</p>
              <button type="button" class={styles.button} onClick={() => void load()}>
                Try again
              </button>
            </div>
          </Match>
          <Match when={!timeline()}>
            <div class={`${styles.skeleton} ${styles.chartSkeleton}`} aria-busy="true">
              <span class={styles.visuallyHidden}>Loading the loan's payments</span>
            </div>
          </Match>
          {/* A loan with no schedule (no amount, or no term) has its sentence and nothing else:
              no months to count down and no last payment. */}
          <Match when={timeline()?.rows.length === 0}>{null}</Match>
          <Match when={timeline()}>
            {(t) => (
              <>
                {/* Repaid is the principal, as the card's "% repaid" counts it: the fall of the
                    solid stretch of the line, from the amount borrowed down to today. Each key
                    is a figure's own mark on the line; months left has none. */}
                <dl class={styles.readout} data-test-id="loans-chart-readout">
                  <div>
                    <dt>
                      <svg class={styles.key} viewBox="0 0 18 8" aria-hidden="true">
                        <path class={styles.keyPaid} d="M2 4h14" />
                      </svg>
                      Repaid so far
                    </dt>
                    <dd data-test-id="loans-chart-repaid">{formatCurrency(t().repaid)}</dd>
                  </div>
                  <div>
                    <dt>
                      <svg class={styles.key} viewBox="0 0 18 8" aria-hidden="true">
                        <path class={styles.keyOwed} d="M2 4h14" />
                      </svg>
                      Still owed
                    </dt>
                    <dd data-test-id="loans-chart-owed">{formatCurrency(t().owed)}</dd>
                  </div>
                  <div>
                    <dt>Months left</dt>
                    <dd data-test-id="loans-chart-left">{left(t())}</dd>
                  </div>
                  <div>
                    <dt>
                      <svg class={styles.key} viewBox="0 0 18 8" aria-hidden="true">
                        <circle class={styles.keyEnd} cx="9" cy="4" r="3" />
                      </svg>
                      Last payment
                    </dt>
                    <dd data-test-id="loans-chart-payoff">{payoff(t())}</dd>
                  </div>
                </dl>
                <LoanPayoffChart
                  id={`${props.id}-svg`}
                  timeline={t()}
                  axisMoney={props.axisMoney}
                  formats={props.formats}
                  today={props.today}
                  description={timelineDescription(t(), props.formats)}
                />
              </>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  )
}
