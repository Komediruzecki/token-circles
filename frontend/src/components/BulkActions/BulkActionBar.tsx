/**
 * Bulk Action Bar Component
 * Floating bar that appears when transactions are selected
 */
import bulkActionBarStyles from './BulkActionBar.module.css'

export interface BulkActionBarProps {
  selectedCount: () => number
  onChangeCategory: () => void
  onChangeType: () => void
  onReconcile: () => void
  onDelete: () => void
  onDeselectAll: () => void
  selectedIds: () => Set<number>
}

export function BulkActionBar(props: BulkActionBarProps) {
  const count = props.selectedCount()

  if (count === 0) {
    return null
  }

  return (
    <div class={bulkActionBarStyles.bulkActionBar}>
      <div class={bulkActionBarStyles.content}>
        <div class={bulkActionBarStyles.selectedInfo}>
          <span class={bulkActionBarStyles.count}>{count}</span>
          <span class={bulkActionBarStyles.label}>transactions selected</span>
        </div>

        <div class={bulkActionBarStyles.actions}>
          <button
            class={bulkActionBarStyles.actionButton}
            onClick={props.onChangeType}
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
            Change Type
          </button>

          <button
            class={bulkActionBarStyles.actionButton}
            onClick={props.onChangeCategory}
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            Change Category
          </button>

          <button
            class={bulkActionBarStyles.actionButton}
            onClick={props.onReconcile}
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Reconcile All
          </button>
        </div>

        <button
          class={bulkActionBarStyles.deselectButton}
          onClick={props.onDeselectAll}
          type="button"
        >
          Deselect All
        </button>
      </div>
    </div>
  )
}

export default function BulkActionBarDefault(props: BulkActionBarProps) {
  return <BulkActionBar {...props} />
}
