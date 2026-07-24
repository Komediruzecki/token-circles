/**
 * BulkActionBar Component
 * Shown when transactions are selected — provides batch operations
 * Includes Change Category and Change Type modals (ported from old JS app)
 */
import { createSignal, For } from 'solid-js'
import styles from './BulkActionBar.module.css'

interface Category {
  id: number
  name: string
  color?: string
}

interface BulkActionBarProps {
  selectedCount: number
  categories: Category[]
  onClearSelection: () => void
  onDeleteSelected: () => void
  onReconcileSelected: () => void
  onChangeCategory: (categoryId: number | null) => void
  onChangeType: (type: string) => void
}

export default function BulkActionBar(props: BulkActionBarProps) {
  const [showCategoryModal, setShowCategoryModal] = createSignal(false)
  const [showTypeModal, setShowTypeModal] = createSignal(false)
  const [selectedCategoryId, setSelectedCategoryId] = createSignal<string>('')
  const [selectedType, setSelectedType] = createSignal<string>('')

  if (props.selectedCount === 0) return null

  const handleApplyCategory = () => {
    const catId = selectedCategoryId()
    props.onChangeCategory(catId === '' ? null : parseInt(catId))
    setShowCategoryModal(false)
  }

  const handleApplyType = () => {
    const type = selectedType()
    if (!type) return
    props.onChangeType(type)
    setShowTypeModal(false)
  }

  return (
    <>
      <div class={styles.bulkBar} data-test-id="bulk-action-bar">
        <span class={styles.bulkCount}>{props.selectedCount} selected</span>
        <button
          class={`${styles.btn} ${styles.btnSecondary}`}
          onClick={() => {
            setShowCategoryModal(true)
          }}
        >
          Change Category
        </button>
        <button
          class={`${styles.btn} ${styles.btnSecondary}`}
          onClick={() => {
            setShowTypeModal(true)
          }}
        >
          Change Type
        </button>
        <button class={`${styles.btn} ${styles.btnSecondary}`} onClick={props.onReconcileSelected}>
          Mark Reconciled
        </button>
        <button class={`${styles.btn} ${styles.btnDanger}`} onClick={props.onDeleteSelected}>
          Delete Selected
        </button>
        <button class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onClearSelection}>
          Deselect All
        </button>
      </div>

      {/* Change Category Modal */}
      {showCategoryModal() && (
        <div
          class={styles.modalOverlay}
          onClick={() => {
            setShowCategoryModal(false)
          }}
        >
          <div
            class={styles.modal}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <div class={styles.modalTitle}>Change Category</div>
              <button
                class={styles.modalClose}
                onClick={() => {
                  setShowCategoryModal(false)
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
            <div class={styles.modalBody}>
              <p class={styles.modalSubtext}>
                Apply to <strong>{props.selectedCount}</strong> selected transactions.
              </p>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>New Category</label>
                <select
                  class={styles.formControl}
                  value={selectedCategoryId()}
                  onInput={(e) => {
                    setSelectedCategoryId((e.target as HTMLSelectElement).value)
                  }}
                >
                  <option value="">No Category</option>
                  <For each={props.categories}>
                    {(cat) => <option value={String(cat.id)}>{cat.name}</option>}
                  </For>
                </select>
              </div>
            </div>
            <div class={styles.modalFooter}>
              <button
                class={styles.btnSecondary}
                onClick={() => {
                  setShowCategoryModal(false)
                }}
              >
                Cancel
              </button>
              <button class={styles.btnPrimary} onClick={handleApplyCategory}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Type Modal */}
      {showTypeModal() && (
        <div
          class={styles.modalOverlay}
          onClick={() => {
            setShowTypeModal(false)
          }}
        >
          <div
            class={styles.modal}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <div class={styles.modalTitle}>Change Type</div>
              <button
                class={styles.modalClose}
                onClick={() => {
                  setShowTypeModal(false)
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
            <div class={styles.modalBody}>
              <p class={styles.modalSubtext}>
                Apply to <strong>{props.selectedCount}</strong> selected transactions.
              </p>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>New Type</label>
                <select
                  class={styles.formControl}
                  value={selectedType()}
                  onInput={(e) => {
                    setSelectedType((e.target as HTMLSelectElement).value)
                  }}
                >
                  <option value="">Select type...</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
            </div>
            <div class={styles.modalFooter}>
              <button
                class={styles.btnSecondary}
                onClick={() => {
                  setShowTypeModal(false)
                }}
              >
                Cancel
              </button>
              <button class={styles.btnPrimary} onClick={handleApplyType}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
