/**
 * What an import on this page leaves at its top (maff, 19 Nov): one card, headed by the result,
 * with a row for each thing to do next: the balances of the accounts it changed, and the
 * subscription scan. They were a banner, a card of balances one line an account, and an offer
 * card, stacked above the import methods: after a sheet with twelve accounts the methods began a
 * screen down, and the link field further still.
 *
 * Each row is one line until it is opened. The balances list opens by itself for one or two
 * accounts, the case of a bank statement; for more it waits behind Show balances.
 */
import { createSignal, createUniqueId, Show } from 'solid-js'
import pageStyles from '../Import.module.css'
import { ImportBalances } from './ImportBalances'
import styles from './ImportNotices.module.css'
import type { StoredAccount } from '../../core/balanceToday'

/** An import as the card shows it, from the flow's onImported. */
export interface AfterImport {
  /** The result line, as the flow words it: "Imported 12 transactions". */
  text: string
  /** How many transactions came in. */
  imported: number
  /** Offer the subscription scan: something came in, and setup is not waiting to run it. */
  scan: boolean
}

/** Balances open by themselves up to this many accounts: one or two lines. */
export const BALANCES_OPEN_UP_TO = 2

export function ImportAfter(props: {
  after: AfterImport
  /** The accounts the import changed, once read (Import.tsx): none until then. */
  touched: readonly StoredAccount[]
  onScan: () => void
  onDismiss: () => void
}) {
  const id = createUniqueId()
  const [opened, setOpened] = createSignal<boolean | null>(null)
  const balancesOpen = () => opened() ?? props.touched.length <= BALANCES_OPEN_UP_TO
  const count = () => props.touched.length

  return (
    <section class={styles.after} aria-labelledby={`${id}-title`} data-test-id="import-after">
      <div class={styles.afterHead}>
        <svg
          class={`${styles.afterIcon} ${props.after.imported > 0 ? '' : styles.nothingNew}`}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <Show when={props.after.imported > 0} fallback={<path d="M12 11v5M12 8h.01" />}>
            <path d="M8 12.5l2.5 2.5L16 9.5" />
          </Show>
        </svg>
        <h2 id={`${id}-title`} class={styles.afterTitle} data-test-id="import-result">
          {props.after.text}
        </h2>
        <button
          type="button"
          class={styles.dismiss}
          aria-label="Dismiss"
          data-test-id="import-after-dismiss"
          onClick={() => {
            props.onDismiss()
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <Show when={count() > 0}>
        <div class={styles.afterRow} data-test-id="import-after-balances">
          <div class={styles.text}>
            <h3 class={styles.rowLabel}>Balances today</h3>
            <p class={styles.sub}>
              {count() === 1 ? '1 account changed.' : `${count()} accounts changed.`} Check them
              against your bank.
            </p>
          </div>
          <button
            type="button"
            class={`${pageStyles.btn} ${pageStyles.btnSecondary} ${styles.action}`}
            aria-expanded={balancesOpen() ? 'true' : 'false'}
            aria-controls={`${id}-balances`}
            data-test-id="import-after-balances-toggle"
            onClick={() => setOpened(!balancesOpen())}
          >
            {balancesOpen() ? 'Hide balances' : 'Show balances'}
          </button>
          <div id={`${id}-balances`} class={styles.rowBody} hidden={!balancesOpen()}>
            <Show when={balancesOpen() ? props.touched : null} keyed>
              {(accounts) => <ImportBalances accounts={accounts} plain />}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.after.scan}>
        <div class={styles.afterRow} data-test-id="import-scan-offer">
          <div class={styles.text}>
            <h3 class={styles.rowLabel}>Subscriptions</h3>
            <p class={styles.sub}>
              Find the subscriptions and other regular payments in what you've imported.
            </p>
          </div>
          <button
            type="button"
            class={`${pageStyles.btn} ${pageStyles.btnPrimary} ${styles.action}`}
            data-test-id="import-scan-open"
            onClick={() => {
              props.onScan()
            }}
          >
            Scan for subscriptions
          </button>
        </div>
      </Show>
    </section>
  )
}
