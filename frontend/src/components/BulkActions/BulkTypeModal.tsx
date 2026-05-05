/**
 * Bulk Type Modal Component
 * Modal for changing type (income/expense) of selected transactions
 */
import { createEffect, createSignal } from 'solid-js'
import bulkTypeModalStyles from './BulkTypeModal.module.css'

export interface BulkTypeModalProps {
  isOpen: () => boolean
  onClose: () => void
  selectedTransactions: () => Array<{ id: number; currentType: string }>
  onConfirm: (type: 'income' | 'expense') => Promise<void>
}

export function BulkTypeModal(props: BulkTypeModalProps) {
  const [selectedType, setSelectedType] = createSignal<'income' | 'expense' | null>(null)
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  createEffect(() => {
    if (props.isOpen()) {
      setSelectedType(null)
      setIsSubmitting(false)
    }
  })

  const handleConfirm = async () => {
    if (selectedType() === null) return
    setIsSubmitting(true)
    try {
      await props.onConfirm(selectedType()!)
    } catch (error) {
      console.error('Failed to update types:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting()) {
      props.onClose()
    }
  }

  return (
    <div
      class={bulkTypeModalStyles.overlay}
      classList={{ [bulkTypeModalStyles.isOpen]: props.isOpen() }}
    >
      <div class={bulkTypeModalStyles.modal}>
        <div class={bulkTypeModalStyles.header}>
          <h2 class={bulkTypeModalStyles.title}>Change Transaction Type</h2>
          <button
            class={bulkTypeModalStyles.closeButton}
            onClick={handleClose}
            disabled={isSubmitting()}
            type="button"
            aria-label="Close modal"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class={bulkTypeModalStyles.content}>
          <div class={bulkTypeModalStyles.transactionCount}>
            {props.selectedTransactions().length} transactions selected
          </div>

          <div class={bulkTypeModalStyles.typeList}>
            <button
              class={`${bulkTypeModalStyles.typeItem} ${selectedType() === 'income' ? bulkTypeModalStyles.selected : ''}`}
              onClick={() => {
                if (!isSubmitting()) {
                  setSelectedType('income')
                }
              }}
              type="button"
            >
              <div class={bulkTypeModalStyles.typeIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </div>
              <div class={bulkTypeModalStyles.typeInfo}>
                <div class={bulkTypeModalStyles.typeTitle}>Income</div>
                <div class={bulkTypeModalStyles.typeDescription}>
                  {props.selectedTransactions().filter((t) => t.currentType === 'income').length}{' '}
                  already income
                </div>
              </div>
              {selectedType() === 'income' && (
                <div class={bulkTypeModalStyles.checkIcon}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>

            <button
              class={`${bulkTypeModalStyles.typeItem} ${selectedType() === 'expense' ? bulkTypeModalStyles.selected : ''}`}
              onClick={() => {
                if (!isSubmitting()) {
                  setSelectedType('expense')
                }
              }}
              type="button"
            >
              <div class={bulkTypeModalStyles.typeIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                  />
                </svg>
              </div>
              <div class={bulkTypeModalStyles.typeInfo}>
                <div class={bulkTypeModalStyles.typeTitle}>Expense</div>
                <div class={bulkTypeModalStyles.typeDescription}>
                  {props.selectedTransactions().filter((t) => t.currentType === 'expense').length}{' '}
                  already expense
                </div>
              </div>
              {selectedType() === 'expense' && (
                <div class={bulkTypeModalStyles.checkIcon}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          </div>
        </div>

        <div class={bulkTypeModalStyles.footer}>
          <button
            class={bulkTypeModalStyles.cancelButton}
            onClick={handleClose}
            disabled={isSubmitting()}
            type="button"
          >
            Cancel
          </button>
          <button
            class={`${bulkTypeModalStyles.confirmButton} ${!selectedType() || isSubmitting() ? bulkTypeModalStyles.disabled : ''}`}
            onClick={handleConfirm}
            disabled={!selectedType() || isSubmitting()}
            type="button"
          >
            {isSubmitting() ? (
              <span class={bulkTypeModalStyles.spinner}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-dasharray="30"
                    stroke-dashoffset="60"
                  />
                </svg>
              </span>
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BulkTypeModalDefault(props: BulkTypeModalProps) {
  return <BulkTypeModal {...props} />
}
