/**
 * RecurringSection Component
 * Manages recurring transactions — list, create, edit, delete, populate
 *
 * The dialog is the form kit's (features/recurringForm.ts): a refusal is said under its field, in
 * the words both runtimes use. A failed delete or "Add to transactions" says so in a toast, in the
 * answer's own words when it has them; both used to fail without a word.
 */
import { createSignal, For, Show } from 'solid-js'
import { RECURRING_FREQUENCIES, RECURRING_TYPES } from '../../../shared/recurringSchema'
import { api, errorStatus, formatCurrency, toast } from '../core/api'
import { plainMessage } from '../core/apiError'
import { profileReadScope } from '../core/apiProfileScope'
import { useAppState } from '../core/appStore'
import { showConfirm } from '../core/confirmStore'
import { entityVersion } from '../core/dataVersions'
import { refetchOnActive } from '../core/pageVisibility'
import { createRecurringForm, ruleName } from '../features/recurringForm'
import { Field, FormNotice, SubmitButton } from './form'
import styles from './RecurringSection.module.css'
import type { Category, RecurringTransaction } from '../types/models'

/**
 * A type or frequency the rule being edited was stored with that the dialog no longer offers (an
 * older version saved "deduction" and "biweekly"), or null. The select shows it as stored rather
 * than blank, so the rule opens, and is saved untouched, as it was.
 */
function notOffered(offered: readonly string[], stored: string | undefined): string | null {
  return stored && !offered.includes(stored) ? stored : null
}

const asLabel = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

interface RecurringSectionProps {
  categories: Category[]
  accounts: Array<{ id: number; name: string }>
}

export default function RecurringSection(props: RecurringSectionProps) {
  const [items, setItems] = createSignal<RecurringTransaction[]>([])
  const [expanded, setExpanded] = createSignal(false)
  const ruleForm = createRecurringForm()

  // Newest answer wins: the list reloads on every recurring and category write, switch and resume,
  // and answers can land out of order. One is shown only if nothing asked for after it is on
  // screen already. `itemsShownFor` is the profiles the rules on screen were asked for.
  let itemsAsked = 0
  let itemsShown = 0
  let itemsShownFor = ''

  /**
   * Load the rules. A failed load keeps the rules on screen while they are the ones asked for; after
   * a profile switch they are another profile's, which this profile cannot edit (an edit answers
   * 404), so a failed load clears them rather than leave them looking current.
   */
  const loadItems = async () => {
    const asked = ++itemsAsked
    const scope = profileReadScope()
    try {
      const data = await api.getRecurring()
      if (!Array.isArray(data)) throw new TypeError('The recurring list is not a list')
      if (asked < itemsShown) return
      itemsShown = asked
      itemsShownFor = scope
      setItems(data)
    } catch {
      if (asked < itemsShown || itemsShownFor === scope) return
      itemsShown = asked
      itemsShownFor = scope
      setItems([])
    }
  }

  // Loads on mount, and again on a profile switch or any recurring write — from anywhere, this
  // section included, and on resume — while Transactions is visible; hidden, it reloads once on
  // the next show. Adding a row to transactions moves the rule's next date on the server, so that
  // write reloads the list too. None of the writes below reloads it by hand. Each rule's colour
  // is its category's, joined on the server, so a category write reloads the list as well.
  const state = useAppState()
  refetchOnActive(
    'transactions',
    () => [state.profileVersion, entityVersion('recurring'), entityVersion('categories')],
    () => {
      void loadItems()
    }
  )

  // A rule deleted in another tab or on another device first answers 404: gone is what was asked,
  // so the section says so and drops the row. A failed write bumps no counter, so this reload has
  // to be asked for.
  const handleDelete = async (item: RecurringTransaction) => {
    if (
      !(await showConfirm(`Delete recurring "${item.description}"?`, {
        danger: true,
        confirmText: 'Delete',
      }))
    )
      return
    try {
      await api.deleteRecurring(item.id)
      toast(`Deleted ${ruleName(item.description)}.`, 'success')
    } catch (error) {
      if (errorStatus(error) === 404) {
        toast('That recurring transaction was already deleted.', 'info')
        void loadItems()
        return
      }
      console.error('Failed to delete recurring:', error)
      toast(plainMessage(error, "Couldn't delete the recurring transaction. Try again."), 'error')
    }
  }

  // The rules whose "Add to transactions" is on its way. A second press while it is sends nothing:
  // two quick presses sent two populates, and in local-first both added the period.
  const [populating, setPopulating] = createSignal<ReadonlySet<number>>(new Set())

  // The row this adds reaches the transaction list the way every write does: populating bumps
  // `recurring`, which moves `transactions`, and the list follows that counter. A period already
  // added is refused (409) in words that say so.
  const handlePopulate = async (item: RecurringTransaction) => {
    if (populating().has(item.id)) return
    setPopulating((ids) => new Set(ids).add(item.id))
    try {
      await api.populateRecurring(item.id)
      toast(`Added ${ruleName(item.description)} to your transactions.`, 'success')
    } catch (error) {
      if (errorStatus(error) === 404) {
        toast('That recurring transaction was already deleted.', 'info')
        void loadItems()
        return
      }
      console.error('Failed to populate recurring:', error)
      toast(plainMessage(error, "Couldn't add it to your transactions. Try again."), 'error')
    } finally {
      setPopulating((ids) => {
        const left = new Set(ids)
        left.delete(item.id)
        return left
      })
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div class={styles.section}>
      <div class={styles.sectionHeader} onClick={() => setExpanded(!expanded())}>
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          class={`${styles.chevron} ${expanded() ? styles.chevronOpen : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <h2 class={styles.sectionTitle}>Recurring Transactions</h2>
        <span class={styles.count}>{items().length}</span>
        <button
          class={styles.addBtn}
          onClick={(e) => {
            e.stopPropagation()
            ruleForm.openNew()
          }}
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add
        </button>
      </div>

      {expanded() && (
        <div class={styles.list}>
          {items().length === 0 ? (
            <div class={styles.emptyState}>
              <svg
                width="40"
                height="40"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                viewBox="0 0 24 24"
                style="opacity: 0.3"
              >
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p>No recurring items</p>
            </div>
          ) : (
            <For each={items()}>
              {(item) => (
                <div class={styles.item}>
                  <div class={styles.itemInfo}>
                    <span
                      class={styles.categoryDot}
                      style={{ 'background-color': item.category_color || '#94a3b8' }}
                    />
                    <span class={styles.itemName}>{item.description}</span>
                    <span class={styles.itemFreq}>{item.frequency}</span>
                  </div>
                  <div class={styles.itemRight}>
                    <span class={`${styles.itemAmount} ${styles[item.type]}`}>
                      {item.type === 'expense' ? '-' : '+'}
                      {formatCurrency(item.amount)}
                    </span>
                    <span class={styles.itemNext}>{formatDate(item.next_date)}</span>
                    <button
                      class={styles.itemAction}
                      onClick={() => handlePopulate(item)}
                      title="Add to transactions"
                      aria-disabled={populating().has(item.id) ? 'true' : undefined}
                    >
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                    <button
                      class={styles.itemAction}
                      onClick={() => {
                        ruleForm.openEdit(item)
                      }}
                      title="Edit"
                    >
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      class={`${styles.itemAction} ${styles.itemActionDanger}`}
                      onClick={() => handleDelete(item)}
                      title="Delete"
                    >
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </For>
          )}
        </div>
      )}

      {/* Modal */}
      <Show when={ruleForm.isOpen()}>
        <div
          class={styles.modalOverlay}
          onClick={() => {
            ruleForm.close()
          }}
        >
          <div
            class={styles.modal}
            data-test-id="recurring-modal"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3>{ruleForm.editing() ? 'Edit Recurring' : 'Add Recurring'}</h3>
              <button
                type="button"
                class={styles.closeBtn}
                aria-label="Close"
                onClick={() => {
                  ruleForm.close()
                }}
              >
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form {...ruleForm.attrs} data-test-id="recurring-form">
              <div class={styles.modalBody}>
                <FormNotice form={ruleForm} testId="recurring-form-notice" />
                <Field
                  form={ruleForm}
                  name="description"
                  label="Description"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      class={styles.formControl}
                      data-test-id="recurring-form-description"
                      value={ruleForm.values.description}
                      onInput={(e) => ruleForm.set('description', e.currentTarget.value)}
                    />
                  )}
                </Field>
                <div class={styles.formRow}>
                  <Field
                    form={ruleForm}
                    name="amount"
                    label="Amount"
                    class={styles.formGroup}
                    labelClass={styles.formLabel}
                  >
                    {(control) => (
                      <input
                        {...control}
                        type="text"
                        inputmode="decimal"
                        class={styles.formControl}
                        placeholder="0.00"
                        data-test-id="recurring-form-amount"
                        value={ruleForm.values.amount}
                        onInput={(e) => ruleForm.set('amount', e.currentTarget.value)}
                      />
                    )}
                  </Field>
                  <Field
                    form={ruleForm}
                    name="type"
                    label="Type"
                    class={styles.formGroup}
                    labelClass={styles.formLabel}
                  >
                    {(control) => (
                      <select
                        {...control}
                        class={styles.formControl}
                        data-test-id="recurring-form-type"
                        value={ruleForm.values.type}
                        onInput={(e) => ruleForm.set('type', e.currentTarget.value)}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfer</option>
                        <Show when={notOffered(RECURRING_TYPES, ruleForm.editing()?.type)}>
                          {(stored) => (
                            <option value={stored()} selected={ruleForm.values.type === stored()}>
                              {asLabel(stored())}
                            </option>
                          )}
                        </Show>
                      </select>
                    )}
                  </Field>
                </div>
                <div class={styles.formRow}>
                  <Field
                    form={ruleForm}
                    name="frequency"
                    label="Frequency"
                    class={styles.formGroup}
                    labelClass={styles.formLabel}
                  >
                    {(control) => (
                      <select
                        {...control}
                        class={styles.formControl}
                        data-test-id="recurring-form-frequency"
                        value={ruleForm.values.frequency}
                        onInput={(e) => ruleForm.set('frequency', e.currentTarget.value)}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                        <Show
                          when={notOffered(RECURRING_FREQUENCIES, ruleForm.editing()?.frequency)}
                        >
                          {(stored) => (
                            <option
                              value={stored()}
                              selected={ruleForm.values.frequency === stored()}
                            >
                              {asLabel(stored())}
                            </option>
                          )}
                        </Show>
                      </select>
                    )}
                  </Field>
                  <Field
                    form={ruleForm}
                    name="day_of_month"
                    label="Day of Month"
                    class={styles.formGroup}
                    labelClass={styles.formLabel}
                  >
                    {(control) => (
                      <input
                        {...control}
                        type="text"
                        inputmode="numeric"
                        class={styles.formControl}
                        placeholder="1-31"
                        data-test-id="recurring-form-day"
                        value={ruleForm.values.day_of_month}
                        onInput={(e) => ruleForm.set('day_of_month', e.currentTarget.value)}
                      />
                    )}
                  </Field>
                </div>
                <Field
                  form={ruleForm}
                  name="next_date"
                  label="Next Date"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="date"
                      class={styles.formControl}
                      data-test-id="recurring-form-next-date"
                      value={ruleForm.values.next_date}
                      onInput={(e) => ruleForm.set('next_date', e.currentTarget.value)}
                    />
                  )}
                </Field>
                <div class={styles.formRow}>
                  <Field
                    form={ruleForm}
                    name="account_id"
                    label={ruleForm.values.type === 'transfer' ? 'From account' : 'Account'}
                    class={styles.formGroup}
                    labelClass={styles.formLabel}
                  >
                    {(control) => (
                      <select
                        {...control}
                        class={styles.formControl}
                        data-test-id="recurring-form-account"
                        value={ruleForm.values.account_id}
                        onInput={(e) => ruleForm.set('account_id', e.currentTarget.value)}
                      >
                        <option value="">None (reminder only)</option>
                        <For each={props.accounts}>
                          {(a) => (
                            <option
                              value={String(a.id)}
                              selected={String(a.id) === ruleForm.values.account_id}
                            >
                              {a.name}
                            </option>
                          )}
                        </For>
                      </select>
                    )}
                  </Field>
                  <Show when={ruleForm.values.type === 'transfer'}>
                    <Field
                      form={ruleForm}
                      name="transfer_account_id"
                      label="To account"
                      class={styles.formGroup}
                      labelClass={styles.formLabel}
                    >
                      {(control) => (
                        <select
                          {...control}
                          class={styles.formControl}
                          data-test-id="recurring-form-transfer-account"
                          value={ruleForm.values.transfer_account_id}
                          onInput={(e) =>
                            ruleForm.set('transfer_account_id', e.currentTarget.value)
                          }
                        >
                          <option value="">Select destination...</option>
                          <For each={props.accounts}>
                            {(a) => (
                              <option
                                value={String(a.id)}
                                selected={String(a.id) === ruleForm.values.transfer_account_id}
                              >
                                {a.name}
                              </option>
                            )}
                          </For>
                        </select>
                      )}
                    </Field>
                  </Show>
                </div>
                <Field
                  form={ruleForm}
                  name="category_id"
                  label="Category"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <select
                      {...control}
                      class={styles.formControl}
                      data-test-id="recurring-form-category"
                      value={ruleForm.values.category_id}
                      onInput={(e) => ruleForm.set('category_id', e.currentTarget.value)}
                    >
                      <option value="">Select category...</option>
                      <For each={props.categories}>
                        {(cat) => (
                          <option
                            value={String(cat.id)}
                            selected={String(cat.id) === ruleForm.values.category_id}
                          >
                            {cat.name}
                          </option>
                        )}
                      </For>
                    </select>
                  )}
                </Field>
                <Field
                  form={ruleForm}
                  name="notes"
                  label="Notes"
                  class={styles.formGroup}
                  labelClass={styles.formLabel}
                >
                  {(control) => (
                    <textarea
                      {...control}
                      class={styles.formControl}
                      rows="2"
                      data-test-id="recurring-form-notes"
                      value={ruleForm.values.notes}
                      onInput={(e) => ruleForm.set('notes', e.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnSecondary}
                  onClick={() => {
                    ruleForm.close()
                  }}
                >
                  Cancel
                </button>
                <SubmitButton
                  class={styles.btnPrimary}
                  data-test-id="recurring-form-submit"
                  busy={ruleForm.submitting()}
                >
                  Save
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  )
}
