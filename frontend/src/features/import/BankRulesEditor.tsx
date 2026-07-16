/**
 * The Bank Imports categorization + transfer rules editor. Rendered on the upload
 * tab, and on the preview step with a Recalculate button that re-runs the transform.
 * Shared by the Import page and the onboarding wizard via the ImportFlow controller.
 */
import { createUniqueId, For, Show } from 'solid-js'
import { produce } from 'solid-js/store'
import {
  loadCategoryRules,
  RULE_GROUPS,
  rulesForGroup,
  saveCategoryRules,
  saveRuleGroup,
} from '../../core/bankImport'
import styles from '../Import.module.css'
import type { ImportFlow } from './importFlow'

export function BankRulesEditor(props: { flow: ImportFlow; onRecalculate?: () => void }) {
  const flow = props.flow
  // Unique per instance: the Import page and the onboarding wizard can both be
  // mounted (keep-alive), and a shared datalist id would cross-wire the combobox.
  const categoryListId = `bank-category-list-${createUniqueId()}`
  return (
    <div style={{ 'margin-top': '16px' }}>
      <button
        class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
        data-test-id="bank-rules-toggle"
        onClick={() => flow.setShowBankRules(!flow.showBankRules())}
      >
        {flow.showBankRules() ? 'Hide' : 'Edit'} categorization &amp; transfer rules
      </button>

      <Show when={flow.showBankRules()}>
        <div
          style={{
            'margin-top': '10px',
            border: '1px solid var(--border)',
            'border-radius': '8px',
            padding: '12px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '14px',
          }}
        >
          <div>
            <label class={styles.mappingLabel} style={{ 'margin-bottom': '6px', display: 'block' }}>
              Mapping
            </label>
            <select
              class={styles.pageSize}
              value={flow.ruleGroup()}
              onChange={(e) => {
                const id = e.currentTarget.value
                // Switching re-seeds the rules to the group's defaults; warn first if the user
                // has edited their rules, so a stray dropdown change can't silently wipe them.
                const customized =
                  JSON.stringify(loadCategoryRules()) !==
                  JSON.stringify(rulesForGroup(flow.ruleGroup()))
                if (
                  customized &&
                  !window.confirm(
                    "Switching the mapping replaces your edited category rules with the selected group's defaults. Your edits will be lost. Continue?"
                  )
                ) {
                  e.currentTarget.value = flow.ruleGroup()
                  return
                }
                flow.setRuleGroup(id)
                saveRuleGroup(id)
                saveCategoryRules(rulesForGroup(id))
                flow.loadBankRules()
                props.onRecalculate?.()
              }}
            >
              <For each={RULE_GROUPS}>{(g) => <option value={g.id}>{g.label}</option>}</For>
            </select>
            <p class={styles.dropzoneHint} style={{ 'margin-top': '6px' }}>
              Choose the base rules: Croatian merchants, or a general Worldwide (English) set.
              Switching replaces the editable rules below with that set; refine them afterward.
            </p>
          </div>
          <div>
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '6px' }}>
              Category keyword rules
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
              A transaction gets the category whose longest matching keyword appears in its
              description (most specific wins). Pick an existing category or type a new one;
              comma-separate keywords.
            </p>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
              <For each={flow.categoryRuleDraft}>
                {(rule, i) => (
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      'align-items': 'center',
                      'flex-wrap': 'wrap',
                    }}
                  >
                    <input
                      class={styles.ruleField}
                      style={{ flex: '0 0 160px' }}
                      list={categoryListId}
                      placeholder="Category (pick or type)"
                      value={rule.category}
                      onInput={(e) => {
                        flow.setCategoryRuleDraft(i(), 'category', e.currentTarget.value)
                      }}
                    />
                    <input
                      class={styles.ruleField}
                      style={{ flex: '1 1 220px' }}
                      placeholder="keyword1, keyword2, ..."
                      value={rule.keywords}
                      onInput={(e) => {
                        flow.setCategoryRuleDraft(i(), 'keywords', e.currentTarget.value)
                      }}
                    />
                    <button
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        flow.setCategoryRuleDraft(
                          produce((d) => {
                            d.splice(i(), 1)
                          })
                        )
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
              <datalist id={categoryListId}>
                <For each={flow.bankCategories()}>{(c) => <option value={c} />}</For>
              </datalist>
            </div>
            <button
              class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
              style={{ 'margin-top': '8px' }}
              onClick={() => {
                flow.setCategoryRuleDraft(
                  produce((d) => {
                    d.push({ category: '', keywords: '' })
                  })
                )
              }}
            >
              Add category rule
            </button>
          </div>

          <div>
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '6px' }}>
              Transfer rules
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
              A movement is treated as a transfer when its text contains one of these keywords or
              one of your account names. Map a counterpart signature (a keyword or a card's last 4
              digits) to the account it represents so both sides are linked.
            </p>
            <input
              class={styles.ruleField}
              style={{ width: '100%', 'margin-bottom': '8px' }}
              placeholder="Transfer keywords: top-up, transfer, ibkr, ..."
              value={flow.transferKeywordDraft()}
              onInput={(e) => {
                flow.setTransferKeywordDraft(e.currentTarget.value)
              }}
            />
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
              <For each={flow.counterpartDraft}>
                {(cp, i) => (
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      'align-items': 'center',
                      'flex-wrap': 'wrap',
                    }}
                  >
                    <input
                      class={styles.ruleField}
                      style={{ flex: '0 0 150px' }}
                      placeholder="Signature (e.g. 1399)"
                      value={cp.signature}
                      onInput={(e) => {
                        flow.setCounterpartDraft(i(), 'signature', e.currentTarget.value)
                      }}
                    />
                    <span style="color: var(--text-secondary);">→</span>
                    <select
                      class={styles.mappingSelect}
                      style={{ flex: '0 0 170px' }}
                      value={cp.account}
                      onChange={(e) => {
                        flow.setCounterpartDraft(i(), 'account', e.currentTarget.value)
                      }}
                    >
                      <option value="">Account…</option>
                      <For each={flow.bankAccounts()}>
                        {(a) => <option value={a.name}>{a.name}</option>}
                      </For>
                    </select>
                    <button
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        flow.setCounterpartDraft(
                          produce((d) => {
                            d.splice(i(), 1)
                          })
                        )
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>
            <button
              class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
              style={{ 'margin-top': '8px' }}
              onClick={() => {
                flow.setCounterpartDraft(
                  produce((d) => {
                    d.push({ signature: '', account: '' })
                  })
                )
              }}
            >
              Add counterpart
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            <Show when={props.onRecalculate}>
              <button
                class={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                disabled={flow.loading()}
                onClick={() => {
                  props.onRecalculate?.()
                }}
              >
                Recalculate preview
              </button>
            </Show>
            <button
              class={`${styles.btn} ${props.onRecalculate ? styles.btnOutline : styles.btnPrimary} ${styles.btnSm}`}
              onClick={flow.saveBankRules}
            >
              Save rules
            </button>
            <button
              class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
              onClick={flow.resetBankRules}
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
