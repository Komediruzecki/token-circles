/**
 * The Bank Imports categorization + transfer rules editor. Rendered on the upload
 * tab, and on the preview step with a Recalculate button that re-runs the transform.
 * Shared by the Import page and the onboarding wizard via the ImportFlow controller.
 *
 * The rules are a form on the kit (components/form), written through to the flow's drafts as they
 * are typed, so an edit made on the upload tab is still there on the preview step. A rule half
 * filled in, a category with no keyword or a signature with no account, is marked at the part
 * that is missing and nothing is saved (core/bankImport/rulesCheck.ts). It used to be dropped on
 * save, beside a "Rules saved." that said otherwise.
 */
import {
  batch,
  createEffect,
  createSignal,
  createUniqueId,
  For,
  Index,
  on,
  onCleanup,
  Show,
} from 'solid-js'
import { reconcile } from 'solid-js/store'
import { Field, FormNotice, SubmitButton } from '../../components/form'
import { createForm } from '../../components/form'
import {
  loadCategoryRules,
  RULE_GROUPS,
  rulesForGroup,
  saveCategoryRules,
  saveRuleGroup,
} from '../../core/bankImport'
import { checkBankRuleDrafts } from '../../core/bankImport/rulesCheck'
import styles from '../Import.module.css'
import type { CategoryRuleDraft, CounterpartDraft } from '../../core/bankImport/rulesCheck'
import type { ImportFlow } from './importFlow'

interface BankRuleValues {
  categoryRules: CategoryRuleDraft[]
  transferKeywords: string
  counterparts: CounterpartDraft[]
}

export function BankRulesEditor(props: { flow: ImportFlow; onRecalculate?: () => void }) {
  const flow = props.flow
  // Unique per instance: the Import page and the onboarding wizard can both be
  // mounted (keep-alive), and a shared datalist id would cross-wire the combobox.
  const categoryListId = `bank-category-list-${createUniqueId()}`

  /*
   * Confirmation lives HERE, beside the buttons, not in the page-top banner. The editor sits far
   * down a scrolling step — in onboarding especially — and a message rendered above the fold is a
   * message nobody sees. Cleared after a few seconds; the timer dies with the component.
   */
  const [confirmation, setConfirmation] = createSignal<string | null>(null)
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined
  const confirm = (text: string) => {
    setConfirmation(text)
    clearTimeout(confirmationTimer)
    confirmationTimer = setTimeout(() => setConfirmation(null), 4000)
  }
  onCleanup(() => {
    clearTimeout(confirmationTimer)
  })

  /** The flow's drafts, as the form holds them. */
  const drafts = (): BankRuleValues => ({
    categoryRules: flow.categoryRuleDraft.map((rule) => ({
      category: rule.category,
      keywords: rule.keywords,
    })),
    transferKeywords: flow.transferKeywordDraft(),
    counterparts: flow.counterpartDraft.map((counterpart) => ({
      signature: counterpart.signature,
      account: counterpart.account,
    })),
  })
  // What a save that passes does next: confirm beside the buttons, or, from Recalculate, run the
  // preview again with the rules it saved.
  const confirmSaved = () => {
    confirm('Rules saved.')
  }
  const runRecalculate = () => {
    props.onRecalculate?.()
  }
  let afterSave = confirmSaved
  const form = createForm<BankRuleValues, () => void>({
    initial: drafts(),
    check: (values) => checkBankRuleDrafts(values),
    // The drafts are the form's values already: they are written through as they are typed.
    send: () => {
      flow.saveBankRules()
      return afterSave
    },
    // Saving loads the rules back as the flow keeps them, without a rule left wholly empty and
    // with each list of keywords written out the same way: the form starts over from them.
    saved: (next) => {
      form.reset(drafts())
      next()
    },
    failure: "Couldn't save the rules. Try again.",
  })
  // The flow loads its drafts again without the form: when it first reaches them (the onboarding
  // wizard mounts this before it does), on a reset to defaults, another mapping group, another
  // profile. The form starts over from them; an edit typed here is already in them. Not while the
  // form saves: the save loads them too, and a reset then would drop its answer.
  createEffect(
    on(
      () => JSON.stringify(drafts()),
      (now) => {
        if (!form.submitting() && now !== JSON.stringify(form.values)) form.reset(drafts())
      }
    )
  )

  const setRules = (rules: CategoryRuleDraft[]) => {
    batch(() => {
      form.set('categoryRules', rules)
      flow.setCategoryRuleDraft(reconcile(rules.map((rule) => ({ ...rule }))))
    })
  }
  const setRule = (index: number, field: keyof CategoryRuleDraft, text: string) => {
    setRules(
      form.values.categoryRules.map((rule, i) => (i === index ? { ...rule, [field]: text } : rule))
    )
  }
  const setCounterparts = (counterparts: CounterpartDraft[]) => {
    batch(() => {
      form.set('counterparts', counterparts)
      flow.setCounterpartDraft(reconcile(counterparts.map((counterpart) => ({ ...counterpart }))))
    })
  }
  const setCounterpart = (index: number, field: keyof CounterpartDraft, text: string) => {
    setCounterparts(
      form.values.counterparts.map((counterpart, i) =>
        i === index ? { ...counterpart, [field]: text } : counterpart
      )
    )
  }
  const recalculate = () => {
    // The kit calls `send` before its first await, so the save it starts here is the one that
    // reads this.
    afterSave = runRecalculate
    void form.submit()
    afterSave = confirmSaved
  }
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
        <form
          {...form.attrs}
          data-test-id="bank-rules-form"
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
          <FormNotice form={form} />
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
              <Index each={form.values.categoryRules}>
                {(rule, i) => (
                  <div class={styles.ruleRow} data-test-id="bank-rule-row">
                    <Field
                      form={form}
                      name={`categoryRules.${i}.category`}
                      label="Category"
                      class={styles.ruleCategoryField}
                      labelClass={styles.visuallyHidden}
                    >
                      {(control) => (
                        <input
                          {...control}
                          class={styles.ruleField}
                          list={categoryListId}
                          placeholder="Category (pick or type)"
                          value={rule().category}
                          onInput={(e) => {
                            setRule(i, 'category', e.currentTarget.value)
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      form={form}
                      name={`categoryRules.${i}.keywords`}
                      label="Keywords"
                      class={styles.ruleKeywordsField}
                      labelClass={styles.visuallyHidden}
                    >
                      {(control) => (
                        <input
                          {...control}
                          class={styles.ruleField}
                          placeholder="keyword1, keyword2, ..."
                          value={rule().keywords}
                          onInput={(e) => {
                            setRule(i, 'keywords', e.currentTarget.value)
                          }}
                        />
                      )}
                    </Field>
                    <button
                      type="button"
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        setRules(form.values.categoryRules.filter((_, j) => j !== i))
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </Index>
              <datalist id={categoryListId}>
                <For each={flow.bankCategories()}>{(c) => <option value={c} />}</For>
              </datalist>
            </div>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
              style={{ 'margin-top': '8px' }}
              onClick={() => {
                setRules([...form.values.categoryRules, { category: '', keywords: '' }])
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
            <Field
              form={form}
              name="transferKeywords"
              label="Transfer keywords"
              class={styles.ruleTransferField}
              labelClass={styles.visuallyHidden}
            >
              {(control) => (
                <input
                  {...control}
                  class={styles.ruleField}
                  style={{ width: '100%' }}
                  placeholder="Transfer keywords: top-up, transfer, ibkr, ..."
                  value={form.values.transferKeywords}
                  onInput={(e) => {
                    const text = e.currentTarget.value
                    batch(() => {
                      form.set('transferKeywords', text)
                      flow.setTransferKeywordDraft(text)
                    })
                  }}
                />
              )}
            </Field>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
              <Index each={form.values.counterparts}>
                {(counterpart, i) => (
                  <div class={styles.ruleRow} data-test-id="bank-counterpart-row">
                    <Field
                      form={form}
                      name={`counterparts.${i}.signature`}
                      label="Signature"
                      class={styles.ruleSignatureField}
                      labelClass={styles.visuallyHidden}
                    >
                      {(control) => (
                        <input
                          {...control}
                          class={styles.ruleField}
                          placeholder="Signature (e.g. 1111)"
                          value={counterpart().signature}
                          onInput={(e) => {
                            setCounterpart(i, 'signature', e.currentTarget.value)
                          }}
                        />
                      )}
                    </Field>
                    <span class={styles.ruleArrow} aria-hidden="true">
                      →
                    </span>
                    <Field
                      form={form}
                      name={`counterparts.${i}.account`}
                      label="Account"
                      class={styles.ruleAccountField}
                      labelClass={styles.visuallyHidden}
                    >
                      {(control) => (
                        <select
                          {...control}
                          class={styles.mappingSelect}
                          value={counterpart().account}
                          onChange={(e) => {
                            setCounterpart(i, 'account', e.currentTarget.value)
                          }}
                        >
                          <option value="">Account…</option>
                          <For each={flow.bankAccounts()}>
                            {(a) => (
                              <option value={a.name} selected={a.name === counterpart().account}>
                                {a.name}
                              </option>
                            )}
                          </For>
                        </select>
                      )}
                    </Field>
                    <button
                      type="button"
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        setCounterparts(form.values.counterparts.filter((_, j) => j !== i))
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </Index>
            </div>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
              style={{ 'margin-top': '8px' }}
              onClick={() => {
                setCounterparts([...form.values.counterparts, { signature: '', account: '' }])
              }}
            >
              Add counterpart
            </button>
          </div>

          <div
            style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'align-items': 'center' }}
          >
            <Show when={props.onRecalculate}>
              <button
                type="button"
                class={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                disabled={flow.loading()}
                onClick={recalculate}
              >
                Recalculate preview
              </button>
            </Show>
            <SubmitButton
              class={`${styles.btn} ${props.onRecalculate ? styles.btnOutline : styles.btnPrimary} ${styles.btnSm}`}
              busy={form.submitting()}
              data-test-id="bank-rules-save"
            >
              Save rules
            </SubmitButton>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
              onClick={() => {
                flow.resetBankRules()
                confirm('Rules reset to defaults.')
              }}
            >
              Reset to defaults
            </button>
            <Show when={confirmation()}>
              <span
                class={styles.inlineConfirmation}
                data-test-id="bank-rules-confirmation"
                role="status"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {confirmation()}
              </span>
            </Show>
          </div>
        </form>
      </Show>
    </div>
  )
}
