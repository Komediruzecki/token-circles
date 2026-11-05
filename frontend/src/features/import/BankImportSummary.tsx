/**
 * The summary a statement from a bank the app knows opens on, on the Import page (review M4): what
 * the import brings in, in setup's words (bankSummary.ts), and one button. Check the columns opens
 * the columns step, from where the preview goes on as before; Cancel starts over, as it does on
 * the other steps.
 */
import { For, Show } from 'solid-js'
import pageStyles from '../Import.module.css'
import styles from './BankImportSummary.module.css'
import { bankSummary } from './bankSummary'
import type { ImportFlow } from './importFlow'

export function BankImportSummary(props: {
  flow: ImportFlow
  /** The import went in: the page says so above, and starts over a moment later. */
  imported: () => boolean
  onCheckColumns: () => void
  onCancel: () => void
}) {
  const flow = props.flow
  const summary = () =>
    bankSummary({
      files: flow.bankFiles(),
      rows: flow.currentRows(),
      dateColumn: flow.columnMapping().date,
      selected: flow.selectedRows(),
      alreadyHere: flow.existingDuplicateIndices(),
      invalid: flow.invalidRowSet().size,
      newCategories: flow.newCategories(),
    })
  /** The file's name, or how many statements were read together. */
  const title = () => {
    const files = flow.bankFiles()
    return files.length === 1 ? files[0].file.name : `${files.length} statements`
  }

  return (
    <section
      class={`${pageStyles.settingsCard} ${styles.summary}`}
      data-test-id="import-bank-summary"
      aria-label="What the import brings in"
    >
      <h2 class={`${pageStyles.settingsCardTitle} ${styles.title}`}>{title()}</h2>
      <p class={styles.line} data-test-id="import-summary-line">
        {summary().line}
      </p>
      <For each={summary().notes}>
        {(note) => (
          <p class={styles.note} data-test-id="import-summary-note">
            {note}
          </p>
        )}
      </For>
      <Show when={!props.imported()}>
        <div class={styles.actions}>
          <Show when={summary().button}>
            {(label) => (
              <button
                type="button"
                class={`${pageStyles.btn} ${pageStyles.btnPrimary} ${styles.action}`}
                data-test-id="import-summary-import"
                disabled={flow.loading()}
                onClick={() => void flow.handleImport('selected')}
              >
                {label()}
              </button>
            )}
          </Show>
          <button
            type="button"
            class={`${pageStyles.btn} ${pageStyles.btnSecondary} ${styles.action}`}
            data-test-id="import-summary-columns"
            disabled={flow.loading()}
            onClick={() => {
              props.onCheckColumns()
            }}
          >
            Check the columns
          </button>
          <button
            type="button"
            class={`${pageStyles.btn} ${pageStyles.btnGhost} ${styles.action}`}
            data-test-id="import-summary-cancel"
            disabled={flow.loading()}
            onClick={() => {
              props.onCancel()
            }}
          >
            Cancel
          </button>
        </div>
      </Show>
    </section>
  )
}
