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

export function ImportPreviewStep(props: { flow: ImportFlow }) {
  const flow = props.flow
  const headers = () => flow.currentHeaders()
  // Getters so the stats stay reactive — e.g. after Recalculate, which refreshes
  // rows/selection/duplicates without remounting the preview.
  const total = () => flow.currentRows().length
  const selected = () => flow.selectedRows().size
  const duplicates = () => flow.duplicateIndices().length

  return (
    <>
      {/* Command panel: stats + actions on the first row, compact options below,
          then any informational blocks (duplicates, new categories). */}
      <div class={styles.actionBar}>
        <div class={styles.commandRow}>
          <div class={styles.previewStats}>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Total Rows</span>
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
                <span class={styles.statLabel}>Duplicates</span>
                <span class={`${styles.statValue} ${styles.duplicate}`}>{duplicates()}</span>
              </div>
            )}
          </div>
          <div class={styles.importButtons}>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-execute-selected"
              onClick={() => void flow.handleImport('selected')}
              disabled={flow.selectedRows().size === 0}
            >
              Import Selected ({selected()})
            </button>
            {duplicates() > 0 && (
              <button
                class={`${styles.btn} ${styles.btnSecondary}`}
                data-test-id="import-execute-new"
                onClick={() => void flow.handleImport('new')}
              >
                Import Only New
              </button>
            )}
            <button
              class={`${styles.btn} ${styles.btnOutline}`}
              data-test-id="import-execute-all"
              onClick={() => void flow.handleImport('all')}
            >
              Import All
            </button>
            <button class={`${styles.btn} ${styles.btnGhost}`} onClick={flow.resetForm}>
              Cancel
            </button>
          </div>
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
            {duplicates()} duplicate row{duplicates() === 1 ? '' : 's'} (identical to an earlier row
            in this import) unselected by default — check a row, or use "Import All", to include it.
          </p>
        )}
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
      </div>

      {/* Bank-statement rules: tweak categorization/transfers and recalculate in place */}
      <Show when={flow.bankFiles().length > 0}>
        <BankRulesEditor flow={flow} onRecalculate={() => void flow.recalculateBankPreview()} />
      </Show>

      {/* Table */}
      <div class={styles.tableWrapper}>
        <table class={styles.previewTable}>
          <thead>
            <tr>
              <th class={styles.selectCol}>
                <input
                  type="checkbox"
                  checked={selected() === total()}
                  onChange={(e) => {
                    flow.toggleAll(e.currentTarget.checked)
                  }}
                />
              </th>
              <For each={headers()}>{(h) => <th>{h}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={flow.currentRows().slice(flow.startRow(), flow.endRow())}>
              {(row, idx) => {
                const actualIndex = () => flow.startRow() + idx()
                const isDuplicate = () => flow.duplicateSet().has(actualIndex())
                return (
                  <tr
                    classList={{ [styles.duplicate]: isDuplicate() }}
                    title={isDuplicate() ? 'Duplicate of an earlier row in this import' : undefined}
                  >
                    <td class={styles.selectCol}>
                      <input
                        type="checkbox"
                        checked={flow.selectedRows().has(actualIndex())}
                        onChange={() => {
                          flow.toggleRow(actualIndex())
                        }}
                      />
                      <Show when={isDuplicate()}>
                        <span class={styles.dupBadge}>dup</span>
                      </Show>
                    </td>
                    <For each={row}>{(cell) => <td>{cell ?? ''}</td>}</For>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total() > flow.rowsPerPage() && (
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
