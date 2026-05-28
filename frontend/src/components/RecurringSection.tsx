/**
 * RecurringSection Component
 * Manages recurring transactions — list, create, edit, delete, populate
 */
import { createSignal, For, onMount } from 'solid-js'
import { api } from '../core/api'
import { showConfirm } from '../core/confirmStore'
import styles from './RecurringSection.module.css'
import type { Category, RecurringTransaction } from '../types/models'

interface RecurringSectionProps {
  categories: Category[]
  onRefreshTransactions: () => void
}

type RecurringFormData = Pick<
  RecurringTransaction,
  | 'description'
  | 'amount'
  | 'type'
  | 'frequency'
  | 'day_of_month'
  | 'next_date'
  | 'category_id'
  | 'notes'
>

export default function RecurringSection(props: RecurringSectionProps) {
  const [items, setItems] = createSignal<RecurringTransaction[]>([])
  const [isModalOpen, setIsModalOpen] = createSignal(false)
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [expanded, setExpanded] = createSignal(false)

  // Form fields
  const [formDescription, setFormDescription] = createSignal('')
  const [formAmount, setFormAmount] = createSignal('')
  const [formType, setFormType] = createSignal('expense')
  const [formFrequency, setFormFrequency] = createSignal('monthly')
  const [formDay, setFormDay] = createSignal('')
  const [formNextDate, setFormNextDate] = createSignal(new Date().toISOString().slice(0, 10))
  const [formCategory, setFormCategory] = createSignal<number | null>(null)
  const [formNotes, setFormNotes] = createSignal('')

  const loadItems = async () => {
    try {
      const data = await api.getRecurring()
      setItems(Array.isArray(data) ? data : [])
    } catch {
      // Recurring items will remain empty
    }
  }

  onMount(() => {
    loadItems()
  })

  const openAddModal = () => {
    setEditingId(null)
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = async (item: RecurringTransaction) => {
    setEditingId(item.id)
    setFormDescription(item.description)
    setFormAmount(item.amount.toString())
    setFormType(item.type)
    setFormFrequency(item.frequency)
    setFormDay(item.day_of_month?.toString() || '')
    setFormNextDate(item.next_date || new Date().toISOString().slice(0, 10))
    setFormCategory(item.category_id)
    setFormNotes(item.notes || '')
    setIsModalOpen(true)
  }

  const resetForm = () => {
    setFormDescription('')
    setFormAmount('')
    setFormType('expense')
    setFormFrequency('monthly')
    setFormDay('')
    setFormNextDate(new Date().toISOString().slice(0, 10))
    setFormCategory(null)
    setFormNotes('')
  }

  const handleSave = async () => {
    const data = {
      description: formDescription(),
      amount: parseFloat(formAmount() || '0'),
      type: formType() as RecurringTransaction['type'],
      frequency: formFrequency() as RecurringTransaction['frequency'],
      day_of_month: formDay() ? parseInt(formDay()) : null,
      next_date: formNextDate(),
      category_id: formCategory(),
      notes: formNotes() || null,
    } satisfies RecurringFormData

    try {
      const id = editingId()
      if (id) {
        await api.updateRecurring(id, data)
      } else {
        await api.createRecurring(data)
      }
      setIsModalOpen(false)
      await loadItems()
    } catch (error) {
      console.error('Failed to save recurring transaction:', error)
    }
  }

  const handleDelete = async (item: RecurringTransaction) => {
    if (!(await showConfirm(`Delete recurring "${item.description}"?`))) return
    try {
      await api.deleteRecurring(item.id)
      await loadItems()
    } catch (error) {
      console.error('Failed to delete recurring:', error)
    }
  }

  const handlePopulate = async (item: RecurringTransaction) => {
    try {
      await api.populateRecurring(item.id)
      props.onRefreshTransactions()
    } catch (error) {
      console.error('Failed to populate recurring:', error)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
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
            openAddModal()
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
                      onClick={() => openEditModal(item)}
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
      {isModalOpen() && (
        <div class={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
          <div
            class={styles.modal}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3>{editingId() ? 'Edit Recurring' : 'Add Recurring'}</h3>
              <button class={styles.closeBtn} onClick={() => setIsModalOpen(false)}>
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
            <div class={styles.modalBody}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Description</label>
                <input
                  type="text"
                  class={styles.formControl}
                  value={formDescription()}
                  onInput={(e) => setFormDescription((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    value={formAmount()}
                    onInput={(e) => setFormAmount((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Type</label>
                  <select
                    class={styles.formControl}
                    value={formType()}
                    onChange={(e) => setFormType((e.target as HTMLSelectElement).value)}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Frequency</label>
                  <select
                    class={styles.formControl}
                    value={formFrequency()}
                    onChange={(e) => setFormFrequency((e.target as HTMLSelectElement).value)}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Day of Month</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    class={styles.formControl}
                    value={formDay()}
                    onInput={(e) => setFormDay((e.target as HTMLInputElement).value)}
                    placeholder="1-31"
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Next Date</label>
                <input
                  type="date"
                  class={styles.formControl}
                  value={formNextDate()}
                  onInput={(e) => setFormNextDate((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Category</label>
                <select
                  class={styles.formControl}
                  value={formCategory() ?? ''}
                  onChange={(e) => {
                    const val = (e.target as HTMLSelectElement).value
                    setFormCategory(val ? parseInt(val) : null)
                  }}
                >
                  <option value="">Select category...</option>
                  <For each={props.categories}>
                    {(cat) => <option value={cat.id}>{cat.name}</option>}
                  </For>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Notes</label>
                <textarea
                  class={styles.formControl}
                  rows="2"
                  value={formNotes()}
                  onInput={(e) => setFormNotes((e.target as HTMLTextAreaElement).value)}
                />
              </div>
            </div>
            <div class={styles.modalFooter}>
              <button class={styles.btnSecondary} onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button class={styles.btnPrimary} onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
