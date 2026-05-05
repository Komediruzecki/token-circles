/**
 * BulkActionBar Component
 * Shown when transactions are selected — provides batch operations
 */
import styles from './BulkActionBar.module.css'

interface BulkActionBarProps {
  selectedCount: number
  onClearSelection: () => void
  onDeleteSelected: () => void
  onReconcileSelected: () => void
}

export default function BulkActionBar(props: BulkActionBarProps) {
  if (props.selectedCount === 0) return null

  return (
    <div class={styles.bulkBar}>
      <span class={styles.bulkCount}>{props.selectedCount} selected</span>
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
  )
}
