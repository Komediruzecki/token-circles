/**
 * What an import on this page leaves at its top (maff, 19 Nov): one card, headed by the result,
 * with a row for each thing to do next: the balances of the accounts it changed, and the
 * subscription scan. They were a banner, a card of balances one line an account, and an offer
 * card, stacked above the import methods: after a sheet with twelve accounts the methods began a
 * screen down, and the link field further still.
 *
 * Each row is one line until it is opened. The balances list opens by itself for one or two
 * accounts, the case of a bank statement; for more it waits behind Show balances. After a Google
 * Sheet, a last row says whether the sheet is in Connected sources, where Sync reads it again, and
 * offers to save it there when it is not (keepSheet.ts).
 */
import { createResource, createSignal, createUniqueId, Show } from 'solid-js'
import { Field, FormNotice, SubmitButton } from '../../components/form'
import { listImportSources } from '../../core/importSources'
import pageStyles from '../Import.module.css'
import { ImportBalances } from './ImportBalances'
import styles from './ImportNotices.module.css'
import { createKeepSheetForm, sourceForSheet } from './keepSheet'
import type { StoredAccount } from '../../core/balanceToday'
import type { SheetToKeep } from './keepSheet'

/** An import as the card shows it, from the flow's onImported. */
export interface AfterImport {
  /** The result line, as the flow words it: "Imported 12 transactions". */
  text: string
  /** How many transactions came in. */
  imported: number
  /** Offer the subscription scan: something came in, and setup is not waiting to run it. */
  scan: boolean
  /** The Google Sheet it read, to keep in Connected sources; null for any other import. */
  sheet: SheetToKeep | null
  /** The id its transactions and its Recent Imports entry carry: deleting that entry clears it. */
  importId: string
  /** Rows of the source it left out that a Sync of the sheet brings in (importFlow.ts). */
  leftOut: number
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

      <Show when={props.after.sheet} keyed>
        {(sheet) => <SheetRow sheet={sheet} leftOut={props.after.leftOut} />}
      </Show>
    </section>
  )
}

/** What Sync does: it sends every row, and the import skips the ones in already. */
const SYNC_BRINGS = "Sync brings in every row of the sheet that isn't in Token Circles yet."

/** The rows this import left out, which the first Sync brings in (review of 19 Nov). */
const leftOutLine = (count: number): string =>
  count === 0
    ? ''
    : count === 1
      ? ' That includes the one row this import left out.'
      : ` That includes the ${count.toLocaleString('en-GB')} rows this import left out.`

/**
 * The sheet's row: in Connected sources already, or Save sheet. Nothing until the saved sources
 * are read, so the row does not change its mind in front of the person.
 */
function SheetRow(props: { sheet: SheetToKeep; leftOut: number }) {
  const [savedNow, setSavedNow] = createSignal<string | null>(null)
  const [stored] = createResource(async () => {
    try {
      const source = sourceForSheet(await listImportSources(), props.sheet.url)
      // A source saved with no name is still saved: Save sheet would make a second one.
      return source ? source.label || 'Google Sheet' : null
    } catch {
      // Not read: Save sheet is offered, and a second copy of a saved sheet is the worst of it.
      return null
    }
  })
  const savedAs = () => savedNow() ?? stored()
  const form = createKeepSheetForm({
    sheet: props.sheet,
    onSaved: (source) => setSavedNow(source.label),
  })

  return (
    <Show when={!stored.loading}>
      <div class={styles.afterRow} data-test-id="import-after-sheet">
        <div class={styles.text}>
          <h3 class={styles.rowLabel}>Google Sheet</h3>
          <Show
            when={savedAs()}
            fallback={
              <p class={styles.sub}>
                Keep it in Connected sources. {SYNC_BRINGS}
                {leftOutLine(props.leftOut)}
              </p>
            }
          >
            {(label) => (
              <p class={styles.sub} data-test-id="import-after-saved">
                "{label()}" is in Connected sources below. {SYNC_BRINGS}
                {leftOutLine(props.leftOut)}
              </p>
            )}
          </Show>
        </div>
        <Show when={!savedAs()}>
          <form class={styles.keep} {...form.attrs} data-test-id="import-after-sheet-form">
            <FormNotice form={form} />
            {/* The name and Save sheet share a line, on a phone too: the card stays short. */}
            <div class={styles.keepRow}>
              <Field
                form={form}
                name="label"
                label="Name for the sheet"
                class={styles.keepField}
                labelClass={pageStyles.visuallyHidden}
              >
                {(control) => (
                  <input
                    {...control}
                    class={styles.keepInput}
                    placeholder="Name (optional)"
                    autocomplete="off"
                    data-test-id="import-after-sheet-name"
                    value={form.values.label}
                    onInput={(e) => form.set('label', e.currentTarget.value)}
                  />
                )}
              </Field>
              <SubmitButton
                class={`${pageStyles.btn} ${pageStyles.btnSecondary} ${styles.keepSave}`}
                busy={form.submitting()}
                busyLabel="Saving…"
                data-test-id="import-after-save-sheet"
              >
                Save sheet
              </SubmitButton>
            </div>
          </form>
        </Show>
      </div>
    </Show>
  )
}
