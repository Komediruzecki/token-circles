/**
 * Column-mapping step of the import flow: map source columns onto the 12 target
 * fields and review detected category types (with per-account setup for values
 * flagged as accounts). Shared by the Import page and the onboarding wizard.
 */
import { For, Show } from 'solid-js'
import { getLocalCurrency } from '../../core/api'
import { FIELD_NAMES } from '../../core/importMapping'
import styles from '../Import.module.css'
import type { ImportFlow } from './importFlow'

/**
 * `embedded`: rendered inside the onboarding wizard, whose footer carries the
 * step's forward action — hide the in-body Cancel/Continue row so there's a
 * single visible CTA. The standalone Import page omits it.
 */
export function ImportMappingStep(props: { flow: ImportFlow; embedded?: boolean }) {
  const flow = props.flow
  const headers = () => flow.currentHeaders()
  return (
    <>
      <div class={styles.mappingSection}>
        <h2 class={styles.mappingTitle}>Map columns</h2>
        <p class={styles.mappingSubtitle}>
          Map your data columns to the 12 required fields. Fields in bold are required.
        </p>

        <div class={styles.mappingGrid}>
          <For each={FIELD_NAMES}>
            {(field) => (
              <div class={styles.mappingField}>
                <label class={styles.mappingLabel}>
                  {field.label}
                  {field.required && <span class={styles.required}>*</span>}
                </label>
                <select
                  class={styles.mappingSelect}
                  data-test-id={`import-map-${field.key}`}
                  value={flow.columnMapping()[field.key] ?? ''}
                  onChange={(e) => {
                    flow.handleColumnMappingChange(field.key, parseInt(e.target.value))
                  }}
                >
                  <option value="">-- Select column --</option>
                  <For each={headers()}>{(h, i) => <option value={i()}>{h}</option>}</For>
                </select>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Category type review */}
      <div class={styles.categoryReview}>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '16px',
            'margin-bottom': '16px',
            'flex-wrap': 'wrap',
          }}
        >
          <h3 class={styles.categoryReviewTitle} style={{ margin: 0 }}>
            Category types
          </h3>
          <label
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '6px',
              'font-size': '13px',
              color: 'var(--text-secondary)',
            }}
          >
            Tracking start date:
            <input
              type="date"
              value={flow.universalStartDate()}
              onchange={(e) => {
                flow.applyUniversalStartDate(e.currentTarget.value)
              }}
              style={{
                padding: '4px 8px',
                border: '1px solid var(--border)',
                'border-radius': '4px',
                'font-size': '13px',
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            />
          </label>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
          <table class={styles.categoryTable}>
            <thead>
              <tr>
                <th>Category</th>
                <th class={styles.categoryTableType}>Type</th>
                <th class={styles.categoryTableConfig}>Account setup</th>
              </tr>
            </thead>
            <tbody>
              <For each={flow.detectCategories()}>
                {(category) => {
                  const currentType = () => flow.categoryTypes()[category] || 'expense'
                  const isAccount = () => currentType() === 'account'
                  return (
                    <tr>
                      <td class={styles.categoryTableName}>{category}</td>
                      <td class={styles.categoryTableType}>
                        <div class={styles.pillGroup}>
                          <button
                            class={`${styles.pill} ${currentType() === 'expense' ? styles.expenseActive : ''}`}
                            onClick={() => {
                              flow.handleCategoryTypeToggle(category, 'expense')
                            }}
                          >
                            Expense
                          </button>
                          <button
                            class={`${styles.pill} ${currentType() === 'income' ? styles.incomeActive : ''}`}
                            onClick={() => {
                              flow.handleCategoryTypeToggle(category, 'income')
                            }}
                          >
                            Income
                          </button>
                          <button
                            class={`${styles.pill} ${isAccount() ? styles.accountActive : ''}`}
                            onClick={() => {
                              flow.handleCategoryTypeToggle(category, 'account')
                            }}
                          >
                            Account
                          </button>
                        </div>
                      </td>
                      <td class={styles.categoryTableConfig}>
                        {isAccount() ? (
                          <div class={styles.accountConfig}>
                            <select
                              class={styles.accountTypeSelect}
                              value={flow.accountTypes()[category] || 'giro'}
                              onchange={(e) => {
                                const v = { ...flow.accountTypes() }
                                v[category] = e.currentTarget.value
                                flow.setAccountTypes(v)
                              }}
                            >
                              <option value="giro">Giro</option>
                              <option value="savings">Savings</option>
                              <option value="ib">Investment</option>
                              <option value="cash">Cash</option>
                            </select>
                            <input
                              type="text"
                              inputmode="decimal"
                              class={styles.accountBalanceInput}
                              placeholder={`Starting balance (${getLocalCurrency()})`}
                              title={`Account starting balance in ${getLocalCurrency()}`}
                              value={flow.accountBalances()[category] || ''}
                              oninput={(e) => {
                                const v = { ...flow.accountBalances() }
                                v[category] = e.currentTarget.value
                                flow.setAccountBalances(v)
                              }}
                            />
                            <input
                              type="date"
                              class={styles.accountDateInput}
                              placeholder="Start date"
                              title="Date the account was opened or when tracking began"
                              value={flow.accountBalanceDates()[category] || ''}
                              onchange={(e) => {
                                const v = { ...flow.accountBalanceDates() }
                                v[category] = e.currentTarget.value
                                flow.setAccountBalanceDates(v)
                              }}
                            />
                          </div>
                        ) : (
                          <span style="color:var(--text-secondary);font-size:12px;">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      <div class={styles.previewHeader}>
        <span>
          Total rows: {flow.currentRows().length} | Mapped:{' '}
          {Object.keys(flow.columnMapping()).length}/12
        </span>
        <Show when={!props.embedded}>
          <div class={styles.previewActions}>
            <button class={`${styles.btn} ${styles.btnOutline}`} onClick={flow.resetForm}>
              Cancel
            </button>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              data-test-id="import-continue-preview"
              onClick={() => {
                void flow.goToPreview()
              }}
              disabled={flow.loading()}
            >
              Continue to preview
            </button>
          </div>
        </Show>
      </div>
    </>
  )
}
