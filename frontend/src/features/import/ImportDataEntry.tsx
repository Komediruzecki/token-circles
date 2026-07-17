/**
 * Data-entry step of the import flow: the method tabs (Google Sheets, File
 * Upload, Paste CSV, Bank Imports) and each tab's ingestion UI. Shared by the
 * Import page and the onboarding wizard — pass `compact` to drop the page-sized
 * explainer table.
 */
import { createSignal, createUniqueId, For, onCleanup, onMount, Show } from 'solid-js'
import { AccountSelect } from '../../components/AccountSelect'
import { OrbitSpinner } from '../../components/OrbitSpinner'
import { Pill } from '../../components/Pill'
import { listAdapters } from '../../core/bankImport'
import styles from '../Import.module.css'
import { BankRulesEditor } from './BankRulesEditor'
import { downloadSampleTemplate } from './sampleTemplate'
import type { BankId } from '../../core/bankImport'
import type { ImportFlow, ImportTab } from './importFlow'

const TABS: { id: ImportTab; label: string }[] = [
  { id: 'google-sheets', label: 'Google Sheets' },
  { id: 'file-upload', label: 'File Upload' },
  { id: 'paste-csv', label: 'Paste CSV' },
  { id: 'bank-imports', label: 'Bank Imports' },
]

export function ImportDataEntry(props: { flow: ImportFlow; compact?: boolean }) {
  const flow = props.flow
  // Inputs are targeted by <label for>; ids must be unique because the Import
  // page (keep-alive) and the onboarding wizard can be in the DOM at once.
  const uid = createUniqueId()
  const fileInputId = `import-file-input-${uid}`
  const bankInputId = `bank-file-input-${uid}`

  const bankLabel = (bankId: BankId | null) =>
    listAdapters().find((a) => a.id === bankId)?.label ?? ''

  // Drag-over highlight per dropzone. dragenter/dragleave fire for every child
  // the cursor crosses, so track depth and only clear at zero. Only file drags
  // count — dragging selected text across the zone shouldn't light it up.
  const createDragState = () => {
    const [active, setActive] = createSignal(false)
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files') ?? false
    return {
      active,
      reset: () => {
        depth = 0
        setActive(false)
      },
      handlers: {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          depth += 1
          setActive(true)
        },
        onDragOver: (e: DragEvent) => {
          e.preventDefault()
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFiles(e)) return
          depth = Math.max(0, depth - 1)
          if (depth === 0) setActive(false)
        },
      },
    }
  }
  const uploadDrag = createDragState()
  const bankDrag = createDragState()

  // Belt and braces: if a browser quirk swallows the final dragleave (the drag
  // is cancelled outside the window, etc.), the end of the drag operation or a
  // window blur still clears the highlight.
  onMount(() => {
    const resetAll = () => {
      uploadDrag.reset()
      bankDrag.reset()
    }
    window.addEventListener('dragend', resetAll)
    window.addEventListener('blur', resetAll)
    onCleanup(() => {
      window.removeEventListener('dragend', resetAll)
      window.removeEventListener('blur', resetAll)
    })
  })

  return (
    <div class={styles.uploadArea}>
      {/* Import method tabs */}
      <div class={styles.tabBar} data-tour="import-methods">
        <For each={TABS}>
          {(tab) => (
            <button
              class={`${styles.tab} ${flow.activeImportTab() === tab.id ? styles.active : ''}`}
              data-test-id={`import-tab-${tab.id}`}
              onClick={() => flow.setActiveImportTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      {/* Google Sheets Tab */}
      {flow.activeImportTab() === 'google-sheets' && (
        <>
          <Show when={!props.compact}>
            <div class={styles.settingsCard} style={{ 'margin-bottom': '16px' }}>
              <h3 class={styles.settingsCardTitle}>Expected columns</h3>
              <div class={styles.tableWrapper} style={{ 'margin-bottom': 0 }}>
                <table class={styles.previewTable}>
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Required</th>
                      <th>Sample Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Date</td>
                      <td>Yes</td>
                      <td>2024-01-15</td>
                    </tr>
                    <tr>
                      <td>Description</td>
                      <td>Yes</td>
                      <td>Grocery Store Purchase</td>
                    </tr>
                    <tr>
                      <td>Amount</td>
                      <td>Yes</td>
                      <td>-45.99</td>
                    </tr>
                    <tr>
                      <td>Category</td>
                      <td>No</td>
                      <td>Groceries</td>
                    </tr>
                    <tr>
                      <td>Currency</td>
                      <td>No</td>
                      <td>EUR</td>
                    </tr>
                    <tr>
                      <td>Beneficiary</td>
                      <td>No</td>
                      <td>Supermarket Inc.</td>
                    </tr>
                    <tr>
                      <td>Payor</td>
                      <td>No</td>
                      <td>John Doe</td>
                    </tr>
                    <tr>
                      <td>Means of Payment</td>
                      <td>No</td>
                      <td>Credit Card</td>
                    </tr>
                    <tr>
                      <td>Exchange Rate</td>
                      <td>No</td>
                      <td>1.0</td>
                    </tr>
                    <tr>
                      <td>Notes</td>
                      <td>No</td>
                      <td>Weekly shopping</td>
                    </tr>
                    <tr>
                      <td>Type</td>
                      <td>No</td>
                      <td>expense</td>
                    </tr>
                    <tr>
                      <td>Amount Local</td>
                      <td>No</td>
                      <td>-45.99</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class={styles.sheetsInfo} style={{ 'margin-top': '12px', 'margin-bottom': 0 }}>
                Column names are auto-detected. Use the downloadable template below for guaranteed
                matching.
              </p>
            </div>
          </Show>

          <div class={styles.sheetsUrlRow}>
            <input
              type="text"
              class={styles.sheetsUrlInput}
              placeholder="Paste Google Sheets URL"
              data-test-id="import-sheet-url"
              value={flow.sheetUrl()}
              onInput={(e) => flow.setSheetUrl(e.target.value)}
            />
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-sheet-fetch"
              onClick={() => void flow.fetchGoogleSheet()}
              disabled={flow.loading()}
            >
              Fetch
            </button>
          </div>
          <p class={styles.sheetsInfo}>
            Google Sheets URL format: https://docs.google.com/spreadsheets/d/... (the sheet must be
            shared or published so it can be read)
          </p>

          {flow.sheetNames().length > 0 && !flow.sheetResult() && (
            <div class={styles.sheetsUrlRow}>
              <label class={styles.sheetsInfo}>Available sheets:</label>
              <div class={styles.sheetTabs}>
                <For each={flow.sheetNames()}>
                  {(name) => (
                    <button
                      class={`${styles.sheetTab} ${flow.selectedSheet() === name ? styles.active : ''}`}
                      onClick={() => {
                        flow.handleSheetTabClick(name)
                      }}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}

          {flow.sheetResult() && (
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-continue-mapping"
              onClick={flow.goToMapping}
              style={{ 'margin-top': '16px' }}
            >
              Continue to mapping
            </button>
          )}
        </>
      )}

      {/* File Upload Tab */}
      {flow.activeImportTab() === 'file-upload' && (
        <>
          <div
            class={`${styles.dropzone} ${uploadDrag.active() ? styles.dragOver : ''} ${flow.loading() ? styles.disabled : ''}`}
            {...uploadDrag.handlers}
            onDrop={(e) => {
              uploadDrag.reset()
              flow.handleDrop(e)
            }}
          >
            <input
              type="file"
              id={fileInputId}
              accept=".csv,.xlsx,.xls,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              class={styles.fileInput}
              data-test-id="import-file-input"
              disabled={flow.loading()}
              onChange={flow.handleFileSelect}
            />
            <label for={fileInputId} class={styles.uploadLabel}>
              <Show
                when={!flow.dropProcessing()}
                fallback={<OrbitSpinner size={44} label="Reading your file…" />}
              >
                <svg
                  class={styles.dropzoneIcon}
                  width="48"
                  height="48"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p class={styles.dropzoneTitle}>
                  {uploadDrag.active() ? 'Drop to upload' : 'Click or drag and drop your file here'}
                </p>
                <div class={styles.formatPills}>
                  <Pill>CSV</Pill>
                  <Pill>XLSX</Pill>
                  <Pill>XLS</Pill>
                </div>
              </Show>
            </label>
          </div>

          {flow.uploadResult() && flow.uploadResult()!.sheetNames.length > 1 && (
            <div class={styles.sheetsUrlRow}>
              <label class={styles.sheetsInfo}>Available sheets:</label>
              <div class={styles.sheetTabs}>
                <For each={flow.uploadResult()!.sheetNames}>
                  {(name) => (
                    <button
                      class={`${styles.sheetTab} ${flow.selectedSheet() === name ? styles.active : ''}`}
                      onClick={() => flow.setSelectedSheet(name)}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}

          {flow.uploadResult() && (
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-continue-mapping"
              onClick={flow.goToMapping}
            >
              Continue to mapping
            </button>
          )}

          <div class={styles.templateSection}>
            <p class={styles.dropzoneHint}>Need a template?</p>
            <button class={`${styles.btn} ${styles.btnOutline}`} onClick={downloadSampleTemplate}>
              Download sample template
            </button>
          </div>
        </>
      )}

      {/* Paste CSV Tab */}
      {flow.activeImportTab() === 'paste-csv' && (
        <>
          <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
            Paste tabular data straight from Excel, Google Sheets, or any spreadsheet app — it's
            parsed right in your browser.
          </p>
          <div
            style={{ 'margin-bottom': '8px', display: 'flex', gap: '8px', 'align-items': 'center' }}
          >
            <select
              class={styles.formControl}
              value={flow.pasteDelimiter()}
              onchange={(e) =>
                flow.setPasteDelimiter(e.currentTarget.value as 'auto' | 'comma' | 'tab')
              }
              style={{ 'max-width': '140px' }}
            >
              <option value="auto">Auto-detect</option>
              <option value="comma">Comma (,)</option>
              <option value="tab">Tab</option>
            </select>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-paste-parse"
              onClick={() => {
                flow.parsePastedData(flow.pastedText())
              }}
              disabled={flow.loading() || !flow.pastedText().trim()}
            >
              Parse pasted data
            </button>
          </div>
          <textarea
            class={styles.formControl}
            placeholder="Paste CSV or TSV data here (include header row)&#10;Example:&#10;date,description,amount&#10;2024-01-15,Grocery Store,-45.99&#10;2024-01-16,Salary,3200.00"
            data-test-id="import-paste-textarea"
            value={flow.pastedText()}
            oninput={(e) => flow.setPastedText(e.currentTarget.value)}
            rows={8}
            style={{ resize: 'vertical', 'font-family': 'monospace', 'font-size': '12px' }}
          />
          {flow.uploadResult() && flow.activeImportTab() === 'paste-csv' && (
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-continue-mapping"
              onClick={flow.goToMapping}
              style={{ 'margin-top': '12px' }}
            >
              Continue to mapping
            </button>
          )}
        </>
      )}

      {/* Bank Imports Tab */}
      {flow.activeImportTab() === 'bank-imports' && (
        <>
          <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
            Upload bank statements and we'll detect the bank, match each one to your accounts, and
            prepare the transactions for review.
          </p>
          <div
            class={`${styles.dropzone} ${bankDrag.active() ? styles.dragOver : ''} ${flow.loading() ? styles.disabled : ''}`}
            {...bankDrag.handlers}
            onDrop={(e) => {
              bankDrag.reset()
              flow.handleBankDrop(e)
            }}
          >
            <input
              type="file"
              id={bankInputId}
              accept=".csv,.xlsx,.xls,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              class={styles.fileInput}
              data-test-id="bank-file-input"
              disabled={flow.loading()}
              onChange={flow.handleBankFileSelect}
            />
            <label for={bankInputId} class={styles.uploadLabel}>
              <Show
                when={!flow.dropProcessing()}
                fallback={<OrbitSpinner size={44} label="Reading statements…" />}
              >
                <svg
                  class={styles.dropzoneIcon}
                  width="48"
                  height="48"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M3 21h18M5 21V9l7-4 7 4v12M9 21v-6h6v6M8 12h.01M16 12h.01" />
                </svg>
                <p class={styles.dropzoneTitle}>
                  {bankDrag.active()
                    ? 'Drop to add your statements'
                    : 'Click or drag bank statements here'}
                </p>
                <p class={styles.dropzoneHint}>Upload one or more files</p>
                <div class={styles.formatPills}>
                  <For each={listAdapters()}>
                    {(a) => (
                      <Pill>{`${a.label} (${a.accept.map((f) => f.toUpperCase()).join('/')})`}</Pill>
                    )}
                  </For>
                </div>
              </Show>
            </label>
          </div>

          {flow.bankAccounts().length === 0 && (
            <p
              style={{
                'margin-top': '8px',
                'font-size': '13px',
                color: 'var(--text-secondary)',
              }}
            >
              You have no accounts yet — pick "New account…" in a statement's account dropdown to
              create one right here.
            </p>
          )}

          <Show when={flow.bankFiles().length > 0}>
            <div
              style={{
                'margin-top': '12px',
                display: 'flex',
                'flex-direction': 'column',
                gap: '8px',
              }}
            >
              <For each={flow.bankFiles()}>
                {(row, i) => (
                  <div
                    data-test-id="bank-file-row"
                    style={{
                      display: 'flex',
                      'align-items': 'flex-start',
                      gap: '8px',
                      'flex-wrap': 'wrap',
                      border: '1px solid var(--border)',
                      'border-radius': '8px',
                      padding: '8px 10px',
                    }}
                  >
                    <span
                      style={{
                        flex: '1 1 180px',
                        'font-size': '13px',
                        'overflow-wrap': 'anywhere',
                        'padding-top': '6px',
                      }}
                    >
                      {row.file.name}
                      {row.meta.iban ? (
                        <span style="color: var(--text-secondary);"> · {row.meta.iban}</span>
                      ) : null}
                    </span>
                    <select
                      class={styles.mappingSelect}
                      style={{ 'max-width': '130px' }}
                      value={row.bankId ?? ''}
                      onChange={(e) => {
                        flow.updateBankFile(i(), {
                          bankId: (e.currentTarget.value || null) as BankId | null,
                        })
                      }}
                    >
                      <option value="">Unknown</option>
                      <For each={listAdapters()}>
                        {(a) => <option value={a.id}>{a.label}</option>}
                      </For>
                    </select>
                    <AccountSelect
                      accounts={flow.bankAccounts}
                      value={() => row.targetAccount}
                      onChange={(name) => {
                        flow.updateBankFile(i(), { targetAccount: name })
                      }}
                      onCreated={async () => {
                        await flow.loadBankAccounts()
                      }}
                      suggestedName={() =>
                        [bankLabel(row.bankId), row.meta.currency].filter(Boolean).join(' ')
                      }
                      testId="bank-target-account"
                    />
                    <button
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      style={{ 'margin-top': '2px' }}
                      onClick={() => {
                        flow.removeBankFile(i())
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>

            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              style={{ 'margin-top': '12px' }}
              data-test-id="bank-process-btn"
              onClick={() => void flow.processBankFiles()}
              disabled={flow.loading()}
            >
              Process &amp; continue
            </button>
          </Show>

          <Show when={flow.bankWarnings().length > 0}>
            <ul
              style={{ 'margin-top': '10px', color: 'var(--text-secondary)', 'font-size': '12px' }}
            >
              <For each={flow.bankWarnings()}>{(w) => <li>{w}</li>}</For>
            </ul>
          </Show>

          <BankRulesEditor flow={flow} />
        </>
      )}
    </div>
  )
}
