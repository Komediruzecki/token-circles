/**
 * Auto Categorize Modal Component
 * Suggests categories based on description patterns and allows user to accept/reject
 */
import { createEffect, createSignal } from 'solid-js'
import { api } from '../core/api'
import autoCategorizeModalStyles from './AutoCategorizeModal.module.css'
import type { CategoryMapping } from '../types/models'

export interface AutoCategorizeModalProps {
  isOpen: () => boolean
  onClose: () => void
  uncategorizedTransactions: () => Array<{
    id: number
    description: string
  }>
  onApply: (transactionId: number, categoryId: number) => void
}

export function AutoCategorizeModal(props: AutoCategorizeModalProps) {
  const [categoryMappings, setCategoryMappings] = createSignal<CategoryMapping[]>([])
  const [loading, setLoading] = createSignal(false)
  const [applying, setApplying] = createSignal(false)
  const [pendingUpdates, setPendingUpdates] = createSignal<Record<number, number>>({})
  const [isMounted, setIsMounted] = createSignal(false)

  createEffect(() => {
    if (props.isOpen()) {
      loadCategoryMappings()
      setPendingUpdates({})
    }
  })

  const loadCategoryMappings = async () => {
    setLoading(true)
    try {
      const mappings = await api.getCategoryMappings()
      setCategoryMappings(mappings)
    } catch (error) {
      console.error('Failed to load category mappings:', error)
    } finally {
      setLoading(false)
    }
  }

  const findMatchingCategory = (description: string): CategoryMapping | null => {
    const desc = description.toLowerCase()
    const mappings = categoryMappings()

    for (const mapping of mappings) {
      if (mapping.pattern.toLowerCase() === desc) {
        return mapping
      }
    }

    return null
  }

  const applyCategory = (transactionId: number, categoryId: number) => {
    setPendingUpdates((prev) => ({ ...prev, [transactionId]: categoryId }))
    setApplying(true)
    props.onApply(transactionId, categoryId)
    setApplying(false)
  }

  const applyAll = async () => {
    setApplying(true)
    try {
      for (const [transactionId, categoryId] of Object.entries(pendingUpdates())) {
        props.onApply(Number(transactionId), categoryId)
      }
      props.onClose()
    } finally {
      setApplying(false)
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
      return () => {
        document.removeEventListener('keydown', handler)
      }
    }
  })

  const uncategorized = props.uncategorizedTransactions()

  return (
    <div
      class={autoCategorizeModalStyles.overlay}
      classList={{ [autoCategorizeModalStyles.isOpen]: props.isOpen() }}
    >
      <div class={autoCategorizeModalStyles.modal}>
        <div class={autoCategorizeModalStyles.header}>
          <h2 class={autoCategorizeModalStyles.title}>Auto Categorize</h2>
          <button
            class={autoCategorizeModalStyles.closeButton}
            onClick={props.onClose}
            disabled={applying()}
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

        <div class={autoCategorizeModalStyles.content}>
          <div class={autoCategorizeModalStyles.stats}>
            <span class={autoCategorizeModalStyles.statItem}>
              {uncategorized.length} uncategorized
            </span>
            <span class={autoCategorizeModalStyles.statItem}>
              {Object.keys(pendingUpdates()).length} selected
            </span>
          </div>

          {loading() ? (
            <div class={autoCategorizeModalStyles.loading}>Loading category suggestions...</div>
          ) : uncategorized.length === 0 ? (
            <div class={autoCategorizeModalStyles.empty}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>All transactions are categorized!</p>
            </div>
          ) : (
            <div class={autoCategorizeModalStyles.transactionList}>
              {uncategorized.map((tx) => {
                const matching = findMatchingCategory(tx.description)
                const isSelected = tx.id in pendingUpdates()

                return (
                  <>
                    <div
                      class={`${autoCategorizeModalStyles.transactionItem} ${isSelected ? autoCategorizeModalStyles.selected : ''}`}
                    >
                      <div class={autoCategorizeModalStyles.txInfo}>
                        <p class={autoCategorizeModalStyles.txDescription}>{tx.description}</p>
                        {matching ? (
                          <span
                            class={`${autoCategorizeModalStyles.badge} ${autoCategorizeModalStyles.confidenceHigh}`}
                          >
                            {matching.category_name}
                          </span>
                        ) : (
                          <span class={autoCategorizeModalStyles.badge}>No match</span>
                        )}
                      </div>
                      <button
                        class={autoCategorizeModalStyles.selectBtn}
                        onClick={() => {
                          if (matching) {
                            applyCategory(tx.id, matching.category_id)
                          }
                        }}
                        disabled={applying() || !matching}
                        type="button"
                        aria-label={`Apply ${matching?.category_name}`}
                      >
                        {applying() && tx.id in pendingUpdates() ? (
                          <svg class={autoCategorizeModalStyles.spinnerIcon} viewBox="0 0 24 24">
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
                        ) : isSelected ? (
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
                        ) : (
                          '+'
                        )}
                      </button>
                    </div>
                  </>
                )
              })}
            </div>
          )}
        </div>

        <div class={autoCategorizeModalStyles.footer}>
          <button
            class={autoCategorizeModalStyles.cancelButton}
            onClick={props.onClose}
            disabled={applying()}
            type="button"
          >
            Cancel
          </button>
          <button
            class={`${autoCategorizeModalStyles.applyButton} ${Object.keys(pendingUpdates()).length === 0 ? autoCategorizeModalStyles.disabled : ''}`}
            onClick={applyAll}
            disabled={applying() || Object.keys(pendingUpdates()).length === 0}
            type="button"
          >
            {applying() ? (
              <span class={autoCategorizeModalStyles.spinner}>
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
              `Apply ${Object.keys(pendingUpdates()).length}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AutoCategorizeModalDefault(props: AutoCategorizeModalProps) {
  return <AutoCategorizeModal {...props} />
}
