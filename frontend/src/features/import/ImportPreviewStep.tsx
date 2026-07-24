/**
 * Preview step of the import flow: selection table with duplicate flags,
 * new-category confirmation, budget backfill opt-in, and the execute actions.
 * Shared by the Import page and the onboarding wizard.
 */
import { For, Show } from 'solid-js'
import InfoTip from '../../components/InfoTip'
import styles from '../Import.module.css'
import { BankRulesEditor } from './BankRulesEditor'
import type { ImportFlow } from './importFlow'

/**
 * `embedded`: rendered inside the onboarding wizard, whose footer carries
 * "Import selected (N)" — hide the in-body execute buttons so there's a single
 * visible CTA (the table's selection checkboxes still cover the all/only-new
 * variants). The standalone Import page omits it.
 */
export function ImportPreviewStep(props: { flow: ImportFlow; embedded?: boolean }) {
  const flow = props.flow
  const headers = () => flow.currentHeaders()
  // Getters so the stats stay reactive — e.g. after Recalculate, which refreshes
  // rows/selection/duplicates without remounting the preview.
  const total = () => flow.currentRows().length
  const selected = () => flow.selectedRows().size
  const duplicates = () => flow.duplicateIndices().length
  const invalidRows = () => flow.invalidRowSet().size
  const validationIssues = () => flow.previewValidationIssues()
  const selectableTotal = () => total() - invalidRows()

  return (
    <>
      {/* Command panel: stats + actions on the first row, compact options below,
          then any informational blocks (duplicates, new categories). */}
      <div class={styles.actionBar}>
        <div class={styles.commandRow}>
          <div class={styles.previewStats}>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Total rows</span>
              <span class={styles.statValue} data-test-id="import-preview-total">
                {total()}
              </span>
            </div>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Selected</span>
              <span class={styles.statValue}>{selected()}</span>
            </div>
            {duplicates() > 0 && (
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Potential duplicates</span>
                <span class={`${styles.statValue} ${styles.duplicate}`}>{duplicates()}</span>
              </div>
            )}
            {validationIssues().length > 0 && (
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Invalid</span>
                <span class={`${styles.statValue} ${styles.invalid}`}>
                  {validationIssues().length}
                </span>
              </div>
            )}
          </div>
          <Show when={!props.embedded}>
            <div class={styles.importButtons}>
              <button
                class={`${styles.btn} ${styles.btnPrimary}`}
                data-test-id="import-execute-selected"
                onClick={() => void flow.handleImport('selected')}
                disabled={flow.selectedRows().size === 0}
              >
                Import selected ({selected()})
              </button>
              {duplicates() > 0 && (
                <button
                  class={`${styles.btn} ${styles.btnSecondary}`}
                  data-test-id="import-execute-new"
                  onClick={() => void flow.handleImport('new')}
                >
                  Import only new
                </button>
              )}
              <button
                class={`${styles.btn} ${styles.btnOutline}`}
                data-test-id="import-execute-all"
                onClick={() => void flow.handleImport('all')}
              >
                Import all
              </button>
              <button class={`${styles.btn} ${styles.btnGhost}`} onClick={flow.resetForm}>
                Cancel
              </button>
            </div>
          </Show>
        </div>

        <div class={styles.optionsRow}>
          <label class={styles.optionLabel}>
            <input
              type="checkbox"
              checked={flow.setBudgetsFromSpending()}
              onChange={(e) => flow.setSetBudgetsFromSpending(e.currentTarget.checked)}
            />
            <span>Backfill budgets from spending</span>
            <InfoTip text="Sets each month's budget to what was spent that month, so the budget-vs-spent charts aren't empty for imported history. Overwrites any budgets you already set for those months." />
          </label>
        </div>
        {duplicates() > 0 && (
          <p style={{ margin: '0 0 12px', 'font-size': '12px', color: 'var(--text-secondary)' }}>
            {duplicates()} potential duplicate row{duplicates() === 1 ? '' : 's'} (identical to an
            earlier row in this import).{' '}
            {flow.bankFiles().length > 0
              ? `Deselected by default — check a row${props.embedded ? '' : ', or use "Import all",'} to include it.`
              : 'Kept and imported by default so genuine same-day repeats (e.g. duplicate bank fees) are not dropped — deselect any row that is actually a duplicate.'}{' '}
            "Import only new" skips them all.
          </p>
        )}
        <Show when={validationIssues().length > 0}>
          <div class={styles.validationWarning} data-test-id="import-validation-errors">
            <strong>Fix invalid import values</strong>
            <For each={validationIssues().slice(0, 8)}>
              {(issue) => (
                <div>
                  {typeof issue.index === 'number'
                    ? `Row ${issue.index + 1}: `
                    : issue.field
                      ? `${issue.field}: `
                      : ''}
                  {issue.reason}
                </div>
              )}
            </For>
            <Show when={validationIssues().length > 8}>
              <div>And {validationIssues().length - 8} more.</div>
            </Show>
          </div>
        </Show>
        {/* Dry-run verdict: rows the dedup pass will skip because they already
            exist. A full-duplicate re-import gets called out as "nothing new"
            up front instead of surprising the user with "Imported 0". */}
        <Show when={(flow.existingDuplicates() ?? 0) > 0}>
          <div
            data-test-id="import-existing-dups"
            style={{
              margin: '4px 0 14px',
              padding: '10px 12px',
              border: '1px solid color-mix(in oklab, var(--accent-warm) 45%, var(--border))',
              'border-radius': '8px',
              'font-size': '13px',
              color: 'var(--text-secondary)',
            }}
          >
            <Show
              when={flow.existingDuplicates()! < total()}
              fallback={
                <span>
                  Everything here was already imported — all {total()} rows match existing
                  transactions, so importing again adds nothing (duplicates are skipped
                  automatically).
                </span>
              }
            >
              <span>
                {flow.existingDuplicates()} of {total()} rows already exist in your data (or repeat
                in this file) and will be skipped automatically — importing never creates
                duplicates.
              </span>
            </Show>
          </div>
        </Show>
        <Show when={flow.newCategories().length > 0}>
          <div
            style={{
              margin: '4px 0 14px',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              'border-radius': '8px',
            }}
          >
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '4px' }}>
              New categories to create
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
              These category values don't match an existing category. Uncheck any you don't want
              created — rows with an unchecked category import without a category.
            </p>
            <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '8px 16px' }}>
              <For each={flow.newCategories()}>
                {(name) => (
                  <label
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '6px',
                      'font-size': '13px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={flow.approvedCategories().has(name)}
                      onChange={(e) => {
                        flow.toggleApprovedCategory(name, e.currentTarget.checked)
                      }}
                    />
                    <span>{name}</span>
                  </label>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={flow.newAccounts().length > 0}>
          <div
            style={{
              margin: '4px 0 14px',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              'border-radius': '8px',
            }}
          >
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '4px' }}>
              New accounts to create
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
              These values are treated as accounts (transfer destinations and account-typed
              categories). They'll be created so both legs of a transfer resolve — a value NOT
              listed here already matches an account you have.
            </p>
            <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }}>
              <For each={flow.newAccounts()}>
                {(name) => (
                  <span
                    style={{
                      'font-size': '13px',
                      padding: '2px 8px',
                      border: '1px solid var(--border)',
                      'border-radius': '6px',
                    }}
                  >
                    {name}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Date-range filter: only import transactions within the chosen period. */}
        <div
          style={{
            margin: '4px 0 14px',
            padding: '10px 12px',
            border: '1px solid var(--border)',
            'border-radius': '8px',
          }}
        >
          <p class={styles.mappingLabel} style={{ 'margin-bottom': '4px' }}>
            Date range <span style={{ 'font-weight': '400', opacity: '0.65' }}>(optional)</span>
          </p>
          <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
            Only import transactions within this period — rows outside it are skipped. Leave a side
            blank for no bound.
          </p>
          <div
            style={{
              display: 'flex',
              'flex-wrap': 'wrap',
              'align-items': 'center',
              gap: '8px 14px',
            }}
          >
            <label
              style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'font-size': '13px' }}
            >
              <span style={{ opacity: '0.8' }}>From</span>
              <input
                type="date"
                value={flow.importStartDate()}
                onInput={(e) => flow.setImportStartDate(e.currentTarget.value)}
                style={{
                  padding: '6px 8px',
                  border: '1px solid var(--border)',
                  'border-radius': '6px',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  'font-size': '13px',
                }}
              />
            </label>
            <label
              style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'font-size': '13px' }}
            >
              <span style={{ opacity: '0.8' }}>To</span>
              <input
                type="date"
                value={flow.importEndDate()}
                onInput={(e) => flow.setImportEndDate(e.currentTarget.value)}
                style={{
                  padding: '6px 8px',
                  border: '1px solid var(--border)',
                  'border-radius': '6px',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  'font-size': '13px',
                }}
              />
            </label>
            <Show when={flow.importStartDate() || flow.importEndDate()}>
              <button
                type="button"
                onClick={() => {
                  flow.setImportStartDate('')
                  flow.setImportEndDate('')
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent, #6366f1)',
                  cursor: 'pointer',
                  'font-size': '13px',
                  padding: '0',
                }}
              >
                Clear
              </button>
            </Show>
            <Show when={flow.dateSkippedCount() > 0}>
              <span style={{ 'font-size': '13px', color: 'var(--warning, #f59e0b)' }}>
                {flow.dateSkippedCount()} of {total()} rows outside this range will be skipped
              </span>
            </Show>
          </div>
        </div>

        {/* Transfers whose destination isn't an account would route money into nothing. */}
        <Show when={flow.transferVoidDestinations().count > 0}>
          <div
            style={{
              margin: '4px 0 14px',
              padding: '10px 12px',
              border: '1px solid var(--warning, #f59e0b)',
              'border-radius': '8px',
              background: 'color-mix(in srgb, var(--warning, #f59e0b) 8%, transparent)',
            }}
          >
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '4px' }}>
              Transfers with no destination account
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '0' }}>
              {flow.transferVoidDestinations().count} transfer row
              {flow.transferVoidDestinations().count === 1 ? '' : 's'} point to a value that isn't
              an account ({flow.transferVoidDestinations().names.slice(0, 6).join(', ')}
              {flow.transferVoidDestinations().names.length > 6 ? '…' : ''}). A transfer needs a
              real account on both sides — otherwise the money lands nowhere and balances drift.
              Mark those as accounts, or set their type to Income/Expense.
            </p>
          </div>
        </Show>
      </div>

      {/* Bank-statement rules: tweak categorization/transfers and recalculate in place.
          Spaced so the collapsible control isn't glued to the action bar or the table. */}
      <Show when={flow.bankFiles().length > 0}>
        <div style={{ margin: '20px 0' }}>
          <BankRulesEditor flow={flow} onRecalculate={() => void flow.recalculateBankPreview()} />
        </div>
      </Show>

      {/* Preview filter — narrow the table to only duplicates or only the
          no-account-transfer warning rows. View-only: selection/import unaffected.
          The duplicate/warning chips appear only when there's something to show. */}
      <Show when={flow.filterCounts().duplicates > 0 || flow.filterCounts().noAccountTransfer > 0}>
        <div class={styles.filterBar}>
          <span class={styles.filterBarLabel}>Show:</span>
          <button
            type="button"
            class={`${styles.btn} ${styles.btnSm} ${
              flow.previewFilter() === 'all' ? styles.btnPrimary : styles.btnGhost
            }`}
            onClick={() => {
              flow.applyPreviewFilter('all')
            }}
          >
            All ({flow.filterCounts().all})
          </button>
          <Show when={flow.filterCounts().duplicates > 0}>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnSm} ${
                flow.previewFilter() === 'duplicates' ? styles.btnPrimary : styles.btnGhost
              }`}
              onClick={() => {
                flow.applyPreviewFilter('duplicates')
              }}
            >
              Duplicates ({flow.filterCounts().duplicates})
            </button>
          </Show>
          <Show when={flow.filterCounts().noAccountTransfer > 0}>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnSm} ${
                flow.previewFilter() === 'no-account-transfer' ? styles.btnPrimary : styles.btnGhost
              }`}
              onClick={() => {
                flow.applyPreviewFilter('no-account-transfer')
              }}
            >
              No-account transfers ({flow.filterCounts().noAccountTransfer})
            </button>
          </Show>
        </div>
      </Show>

      {/* Table */}
      <div class={styles.tableWrapper}>
        <table class={styles.previewTable}>
          <thead>
            <tr>
              <th class={styles.selectCol}>
                <input
                  type="checkbox"
                  checked={selectableTotal() > 0 && selected() === selectableTotal()}
                  onChange={(e) => {
                    flow.toggleAll(e.currentTarget.checked)
                  }}
                />
              </th>
              <For each={headers()}>{(h) => <th>{h}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={flow.visibleRowIndices().slice(flow.startRow(), flow.endRow())}>
              {(actualIndex) => {
                const row = () => flow.currentRows()[actualIndex]
                const isDuplicate = () => flow.duplicateSet().has(actualIndex)
                const validationIssue = () =>
                  flow.previewValidationIssues().find((issue) => issue.index === actualIndex)
                // The earlier row this one duplicates, summarised (date · description · amount)
                // from the mapped columns, so the user can see WHY it's flagged.
                const counterpart = () => {
                  const mi = flow.duplicateMatches().get(actualIndex) ?? -1
                  if (mi < 0) return null
                  const r = flow.currentRows()[mi]
                  const m = flow.columnMapping()
                  const summary = [m.date, m.description, m.amount]
                    .map((ci) => (ci !== undefined ? r?.[ci] : undefined))
                    .filter((v): v is string => v !== undefined && v.trim() !== '')
                    .join(' · ')
                  return { rowNo: mi + 1, summary }
                }
                const dupTitle = () => {
                  if (!isDuplicate()) return undefined
                  const c = counterpart()
                  const base = c
                    ? `Potential duplicate of row ${c.rowNo}${c.summary ? `: ${c.summary}` : ''}`
                    : 'Potential duplicate of an earlier row in this import'
                  return `${base} — imported by default; deselect if it is actually a duplicate.`
                }
                return (
                  <tr
                    classList={{
                      [styles.duplicate]: isDuplicate(),
                      [styles.invalidRow]: Boolean(validationIssue()),
                    }}
                    title={validationIssue()?.reason || dupTitle()}
                  >
                    <td class={styles.selectCol}>
                      <input
                        type="checkbox"
                        checked={flow.selectedRows().has(actualIndex)}
                        disabled={Boolean(validationIssue())}
                        onChange={() => {
                          flow.toggleRow(actualIndex)
                        }}
                      />
                      <Show when={isDuplicate()}>
                        <span class={styles.dupBadge}>dup</span>
                        <Show when={counterpart()}>
                          <span
                            style={{
                              'font-size': '10px',
                              color: 'var(--text-secondary)',
                              'margin-left': '4px',
                              'white-space': 'nowrap',
                            }}
                          >
                            = row {counterpart()!.rowNo}
                          </span>
                        </Show>
                      </Show>
                      <Show when={validationIssue()}>
                        <span class={styles.errorBadge}>err</span>
                      </Show>
                    </td>
                    <For each={row()}>{(cell) => <td>{cell ?? ''}</td>}</For>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {flow.visibleRowIndices().length > flow.rowsPerPage() && (
        <div class={styles.pagination}>
          <button
            class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
            disabled={flow.currentPage() === 1}
            onClick={() => flow.setCurrentPage((p) => p - 1)}
          >
            Previous
          </button>
          <span class={styles.pageInfo}>
            Page {flow.currentPage()} of {flow.totalPages()}
          </span>
          <button
            class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
            disabled={flow.currentPage() === flow.totalPages()}
            onClick={() => flow.setCurrentPage((p) => p + 1)}
          >
            Next
          </button>
          <select
            class={styles.pageSize}
            value={flow.rowsPerPage()}
            onChange={(e) => {
              flow.setRowsPerPage(Number(e.target.value))
              flow.setCurrentPage(1)
            }}
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      )}
    </>
  )
}
