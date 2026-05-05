/**
 * Quick Add Modal Component
 * Quick transaction entry (Ctrl+Shift+T shortcut)
 */
import { createEffect, createSignal, For } from 'solid-js'
import { api, toast } from '../core/api'
import quickAddModalStyles from './QuickAddModal.module.css'
import type { Category } from '../types/models'

export interface QuickAddModalProps {
  isOpen: () => boolean
  onClose: () => void
  categories: () => Category[]
  onSave: (transaction: any) => void
}

export function QuickAddModal(props: QuickAddModalProps) {
  let amountRef: HTMLInputElement | undefined
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [isMounted, setIsMounted] = createSignal(false)

  const [formData, setFormData] = createSignal({
    amount: 0,
    category_id: null as number | null,
    description: '',
    type: 'expense' as 'income' | 'expense',
    date: new Date().toISOString().split('T')[0],
  })

  const handleSubmit = async () => {
    const data = formData()
    if (data.amount <= 0) {
      toast('Please enter a valid amount', 'error')
      return
    }
    if (!data.category_id) {
      toast('Please select a category', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const newTransaction = await api.createTransaction({
        amount: data.amount,
        category_id: data.category_id!,
        description: data.description || (data.amount >= 0 ? 'Quick Add' : 'Quick Add'),
        type: data.type,
        date: data.date,
        beneficiary: '',
        payor: '',
        currency: 'EUR',
        amount_local: data.amount >= 0 ? data.amount : null,
        exchange_rate: 1,
        notes: '',
        profile_id: 1,
      })
      props.onSave(newTransaction)
      props.onClose()
    } catch (error) {
      console.error('Failed to create transaction:', error)
      toast('Failed to save transaction', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose()
    }
  }

  createEffect(() => {
    if (!isMounted()) {
      setIsMounted(true)
      const handler = handleKeyDown
      document.addEventListener('keydown', handler)
      // Auto-focus amount field on open
      setTimeout(() => {
        amountRef?.focus()
      }, 100)
      return () => {
        document.removeEventListener('keydown', handler)
      }
    }
  })

  return (
    <div class={quickAddModalStyles.overlay} classList={{ [quickAddModalStyles.isOpen]: props.isOpen() }}>
      <div class={quickAddModalStyles.modal}>
        <div class={quickAddModalStyles.header}>
          <h2 class={quickAddModalStyles.title}>Quick Add</h2>
          <button
            class={quickAddModalStyles.closeButton}
            onClick={props.onClose}
            disabled={isSubmitting()}
            type="button"
            aria-label="Close modal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class={quickAddModalStyles.content}>
          <div class={quickAddModalStyles.form}>
            <div class={quickAddModalStyles.formRow}>
              <div class={quickAddModalStyles.formGroup}>
                <label class={quickAddModalStyles.label}>Amount</label>
                <div class={quickAddModalStyles.currencyPrefix}>€</div>
                <input
                  ref={amountRef}
                  class={quickAddModalStyles.amountInput}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData().amount.toString()}
                  onInput={(e) => setFormData({ ...formData(), amount: Number(e.currentTarget.value) })}
                  disabled={isSubmitting()}
                />
              </div>

              <div class={quickAddModalStyles.formGroup}>
                <label class={quickAddModalStyles.label}>Type</label>
                <div class={quickAddModalStyles.typeButtons}>
                  <button
                    class={`${quickAddModalStyles.typeButton} ${formData().type === 'expense' ? quickAddModalStyles.typeSelected : ''}`}
                    onClick={() => setFormData({ ...formData(), type: 'expense' })}
                    type="button"
                  >
                    Expense
                  </button>
                  <button
                    class={`${quickAddModalStyles.typeButton} ${formData().type === 'income' ? quickAddModalStyles.typeSelected : ''}`}
                    onClick={() => setFormData({ ...formData(), type: 'income' })}
                    type="button"
                  >
                    Income
                  </button>
                </div>
              </div>
            </div>

            <div class={quickAddModalStyles.formGroup}>
              <label class={quickAddModalStyles.label}>Category</label>
              <select
                class={quickAddModalStyles.categorySelect}
                value={formData().category_id?.toString() || ''}
                onChange={(e) => setFormData({ ...formData(), category_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                disabled={isSubmitting()}
              >
                <option value="">Select a category</option>
                <For each={props.categories()}>
                  {(category) => (
                    <option value={category.id}>{category.name}</option>
                  )}
                </For>
              </select>
            </div>

            <div class={quickAddModalStyles.formGroup}>
              <label class={quickAddModalStyles.label}>Description</label>
              <input
                class={quickAddModalStyles.descriptionInput}
                type="text"
                placeholder="Enter description..."
                value={formData().description}
                onInput={(e) => setFormData({ ...formData(), description: e.currentTarget.value })}
                disabled={isSubmitting()}
              />
            </div>

            <div class={quickAddModalStyles.formGroup}>
              <label class={quickAddModalStyles.label}>Date</label>
              <input
                class={quickAddModalStyles.dateInput}
                type="date"
                value={formData().date}
                onChange={(e) => setFormData({ ...formData(), date: e.currentTarget.value })}
                disabled={isSubmitting()}
              />
            </div>
          </div>
        </div>

        <div class={quickAddModalStyles.footer}>
          <button
            class={quickAddModalStyles.cancelButton}
            onClick={props.onClose}
            disabled={isSubmitting()}
            type="button"
          >
            Cancel
          </button>
          <button
            class={`${quickAddModalStyles.saveButton} ${isSubmitting() ? quickAddModalStyles.disabled : ''}`}
            onClick={handleSubmit}
            disabled={isSubmitting()}
            type="button"
          >
            {isSubmitting() ? (
              <span class={quickAddModalStyles.spinner}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="30" stroke-dashoffset="60" />
                </svg>
              </span>
            ) : (
              'Save Transaction'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function QuickAddModalDefault(props: QuickAddModalProps) {
  return <QuickAddModal {...props} />
}
