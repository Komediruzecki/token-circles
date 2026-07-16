/**
 * Import Component - EARS Specification
 *
 * GIVEN: A user is on the Import page
 * WHEN: The page loads
 * THEN: File Upload and Google Sheets sections are displayed stacked vertically
 *
 * GIVEN: A user wants to import from a CSV/Excel file
 * WHEN: They drag-and-drop or browse for a file
 * THEN: The file content is processed and column mapping UI appears
 *
 * GIVEN: A user uploads a file with headers matching expected fields
 * WHEN: They proceed to mapping
 * THEN: Column select dropdowns auto-populate based on header matches
 *
 * GIVEN: A user maps columns
 * WHEN: They select which columns represent date, description, and amount
 * THEN: The preview table displays rows with mapped data
 *
 * GIVEN: A user uploads a file with duplicate rows
 * WHEN: They preview the data
 * THEN: Duplicate rows are flagged with a visual indicator
 *
 * GIVEN: A user maps category columns
 * WHEN: They select categories and select expense/income
 * THEN: Category type labels (expense/income) are shown next to each category
 *
 * GIVEN: A user wants to import data
 * WHEN: They click "Import all", "Import only new", or "Import selected"
 * THEN: Data is submitted to the backend and success message displays
 */

/**
 * Import page — a thin composition of the shared import flow (state machine in
 * features/import/importFlow.ts) and its step components, plus the page-only
 * chrome: header, recent-imports history, and the keep-alive accounts reload.
 * The onboarding wizard embeds the same flow + components.
 */

import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import { OrbitSpinner } from '../components/OrbitSpinner'
import { SubscriptionScanModal } from '../components/SubscriptionScan'
import { useAppState } from '../core/appStore'
import styles from './Import.module.css'
import { ImportDataEntry } from './import/ImportDataEntry'
import { createImportFlow } from './import/importFlow'
import { ImportMappingStep } from './import/ImportMappingStep'
import { ImportPreviewStep } from './import/ImportPreviewStep'

export default function Import() {
  // After a successful import, offer a subscription scan over the fresh data.
  const [scanOfferCount, setScanOfferCount] = createSignal<number | null>(null)
  const [showScan, setShowScan] = createSignal(false)

  const flow = createImportFlow({
    onImported: (summary) => {
      if (summary.imported > 0) setScanOfferCount(summary.imported)
    },
  })

  const state = useAppState()
  // Keep-alive means onMount fires once. Re-load accounts whenever the user
  // returns to the Import page (e.g. after creating an account elsewhere), so a
  // freshly created account appears without a full page reload.
  let skipFirstAccountsReload = true
  createEffect(() => {
    const onImport = state.page === 'import'
    if (skipFirstAccountsReload) {
      skipFirstAccountsReload = false
      return
    }
    if (onImport) void flow.loadBankAccounts()
  })

  onMount(() => {
    flow.init()
  })

  return (
    <div class={`${styles.container} ${styles.pageImport}`}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="import-header" data-tour="import-header">
          Import Transactions
        </h1>
        <p>Import transactions from CSV, Excel, or Google Sheets</p>
      </div>

      {/* Error message */}
      <Show when={flow.error()}>
        <div class={`${styles.resultMessage} ${styles.error}`} data-test-id="import-error">
          {flow.error()}
        </div>
      </Show>

      {/* Success message */}
      <Show when={flow.resultMessage()}>
        <div class={`${styles.resultMessage} ${styles.success}`} data-test-id="import-result">
          {flow.resultMessage()!.text}
        </div>
      </Show>

      {/* Post-import: offer to detect subscriptions in the imported data */}
      <Show when={scanOfferCount() !== null}>
        <div class={styles.settingsCard} data-test-id="import-scan-offer">
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-between',
              gap: '12px',
              'flex-wrap': 'wrap',
            }}
          >
            <p style={{ margin: 0, 'font-size': '13.5px', color: 'var(--text-secondary)' }}>
              {scanOfferCount()} transactions imported — want to check them for known subscriptions
              like Netflix or Spotify?
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                class={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                data-test-id="import-scan-open"
                onClick={() => setShowScan(true)}
              >
                Scan for subscriptions
              </button>
              <button
                class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                onClick={() => setScanOfferCount(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Loading overlay */}
      <Show when={flow.loading()}>
        <div class={styles.loadingOverlay} data-test-id="import-loading">
          <OrbitSpinner size={72} label="Processing your data…" />
        </div>
      </Show>

      {/* Form content */}
      <Show when={flow.activeStep() === 'upload'}>
        <ImportDataEntry flow={flow} />
      </Show>
      <Show when={flow.activeStep() === 'mapping'}>
        <ImportMappingStep flow={flow} />
      </Show>
      <Show when={flow.activeStep() === 'preview'}>
        <ImportPreviewStep flow={flow} />
      </Show>

      {/* Done state */}
      <Show when={flow.activeStep() === 'done'}>
        <div class={styles.settingsCard}>
          <h2 class={styles.settingsCardTitle}>Import Complete!</h2>
          <p>Transactions have been successfully imported.</p>
          <button
            class={`${styles.btn} ${styles.btnPrimary} ${styles.settingsCardActions}`}
            onClick={flow.resetForm}
          >
            Import More
          </button>
        </div>
      </Show>

      {/* Import history */}
      <Show when={flow.importLogs().length > 0 && flow.activeStep() === 'upload'}>
        <div class={styles.settingsCard} style={{ 'margin-top': '24px' }}>
          <h2 class={styles.settingsCardTitle}>Recent Imports</h2>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
            <For each={flow.importLogs()}>
              {(log) => {
                const details = (() => {
                  try {
                    return log.details
                      ? (JSON.parse(log.details) as {
                          created_accounts?: string[]
                          created_categories?: string[]
                          rows_skipped_invalid?: number
                        })
                      : null
                  } catch {
                    return null
                  }
                })()
                return (
                  <details
                    style={{
                      border: '1px solid var(--border)',
                      'border-radius': '8px',
                      padding: '10px 14px',
                    }}
                  >
                    <summary style={{ cursor: 'pointer', 'font-size': '14px' }}>
                      <strong>{log.source || 'Import'}</strong>
                      <span style={{ color: 'var(--text-secondary)', 'margin-left': '8px' }}>
                        {new Date(log.created_at).toLocaleString()} — {log.imported} imported
                        {log.duplicates_skipped > 0 &&
                          `, ${log.duplicates_skipped} duplicates skipped`}
                      </span>
                    </summary>
                    <div
                      style={{
                        'font-size': '13px',
                        color: 'var(--text-secondary)',
                        'margin-top': '8px',
                        display: 'flex',
                        'flex-direction': 'column',
                        gap: '4px',
                      }}
                    >
                      <span>Transactions imported: {log.imported}</span>
                      <span>Duplicates skipped: {log.duplicates_skipped}</span>
                      <span>
                        Accounts created: {log.accounts_created}
                        {details?.created_accounts?.length
                          ? ` (${details.created_accounts.join(', ')})`
                          : ''}
                      </span>
                      <span>
                        Categories created: {log.categories_created}
                        {details?.created_categories?.length
                          ? ` (${details.created_categories.join(', ')})`
                          : ''}
                      </span>
                      {(details?.rows_skipped_invalid ?? 0) > 0 && (
                        <span>Rows skipped as invalid: {details!.rows_skipped_invalid}</span>
                      )}
                    </div>
                  </details>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      <SubscriptionScanModal isOpen={showScan} onClose={() => setShowScan(false)} />
    </div>
  )
}
