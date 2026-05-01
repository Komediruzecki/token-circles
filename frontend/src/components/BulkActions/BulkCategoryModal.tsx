/**
 * Bulk Category Modal Component
 * Modal for changing categories of selected transactions
 */
import { createSignal, createEffect, For, onCleanup } from 'solid-js'
import bulkCategoryModalStyles from './BulkCategoryModal.module.css'

export interface BulkCategoryModalProps {
  isOpen: () => boolean
  onClose: () => void
  selectedTransactions: () => Array<{ id: number; currentCategory: string }>
  categories: () => Array<{ id: number; name: string; color: string }>
  onConfirm: (categoryId: number) => Promise<void>
}

export function BulkCategoryModal(props: BulkCategoryModalProps) {
  const [selectedCategory, setSelectedCategory] = createSignal<number | null>(null)
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  createEffect(() => {
    if (props.isOpen()) {
      setSelectedCategory(null)
      setIsSubmitting(false)
    }
  })

  const handleConfirm = async () => {
    if (selectedCategory() === null) return
    setIsSubmitting(true)
    try {
      await props.onConfirm(selectedCategory()!)
    } catch (error) {
      console.error('Failed to update categories:', error)
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
    <div class={bulkCategoryModalStyles.overlay} classList={{ [bulkCategoryModalStyles.isOpen]: props.isOpen() }}>
      <div class={bulkCategoryModalStyles.modal}>
        <div class={bulkCategoryModalStyles.header}>
          <h2 class={bulkCategoryModalStyles.title}>Change Category</h2>
          <button
            class={bulkCategoryModalStyles.closeButton}
            onClick={handleClose}
            disabled={isSubmitting()}
            type="button"
            aria-label="Close modal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class={bulkCategoryModalStyles.content}>
          <div class={bulkCategoryModalStyles.transactionCount}>
            {props.selectedTransactions().length} transactions selected
          </div>

          <div class={bulkCategoryModalStyles.categoryList}>
            <For each={props.categories()}>
              {(category) => {
                const isSelected = () => selectedCategory() === category.id
                return (
                  <button
                    class={`${bulkCategoryModalStyles.categoryItem} ${isSelected() ? bulkCategoryModalStyles.selected : ''}`}
                    onClick={() => !isSubmitting() && setSelectedCategory(category.id)}
                    type="button"
                  >
                    <span
                      class={bulkCategoryModalStyles.categoryColor}
                      style={{ backgroundColor: category.color }}
                    />
                    <span class={bulkCategoryModalStyles.categoryName}>{category.name}</span>
                    {isSelected() && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        <div class={bulkCategoryModalStyles.footer}>
          <button
            class={bulkCategoryModalStyles cancelButton}
            onClick={handleClose}
            disabled={isSubmitting()}
            type="button"
          >
            Cancel
          </button>
          <button
            class={`${bulkCategoryModalStyles.confirmButton} ${!selectedCategory() || isSubmitting() ? bulkCategoryModalStyles.disabled : ''}`}
            onClick={handleConfirm}
            disabled={!selectedCategory() || isSubmitting()}
            type="button"
          >
            {isSubmitting() ? (
              <span class={bulkCategoryModalStyles.spinner}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30" strokeDashoffset="60" />
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

export default function BulkCategoryModalDefault(props: BulkCategoryModalProps) {
  return <BulkCategoryModal {...props} />
}
