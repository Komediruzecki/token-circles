/**
 * TaskList Component
 * Generic list for showing items with checkboxes for bulk selection
 */
import { For } from 'solid-js'
import styles from './TaskList.module.css'

interface TaskItem {
  id: number
  [key: string]: any
}

interface TaskListProps {
  items: TaskItem[]
  selectedItems: number[]
  onSelectItem: (id: number, checked: boolean) => void
  renderRow: (item: TaskItem, index: number) => JSX.Element
  emptyMessage?: string
}

export default function TaskList(props: TaskListProps) {
  const toggleSelect = (item: TaskItem) => {
    const idx = props.selectedItems.indexOf(item.id)
    if (idx >= 0) {
      props.onSelectItem(item.id, false)
    } else {
      props.onSelectItem(item.id, true)
    }
  }

  const allSelected = () => {
    return props.selectedItems.length === props.items.length && props.items.length > 0
  }

  const someSelected = () => {
    return props.selectedItems.length > 0 && props.selectedItems.length < props.items.length
  }

  const selectAll = () => {
    if (allSelected()) {
      props.onSelectItem(-1, false) // Clear all
    } else {
      props.onSelectItem(-1, true) // Select all
    }
  }

  return (
    <div class={styles.taskList}>
      {props.items.length === 0 ? (
        <div class={styles.emptyState}>{props.emptyMessage || 'No items'}</div>
      ) : (
        <>
          <div class={styles.taskListHeader}>
            <label class={styles.selectAllCheckbox}>
              <input
                type="checkbox"
                checked={allSelected()}
                class={styles.checkbox}
                onChange={selectAll}
              />
              <span>Select All</span>
            </label>
            <span class={styles.selectedCount}>{props.selectedItems.length} selected</span>
          </div>
          <div class={styles.taskListBody}>
            <For each={props.items}>
              {(item) => (
                <div class={styles.taskListItem}>
                  <label class={styles.taskItemCheckbox}>
                    <input
                      type="checkbox"
                      checked={props.selectedItems.includes(item.id)}
                      class={styles.checkbox}
                      onChange={() => toggleSelect(item)}
                    />
                    <span class={styles.checkboxCustom} />
                  </label>
                  {props.renderRow(item, props.items.indexOf(item))}
                </div>
              )}
            </For>
          </div>
        </>
      )}
    </div>
  )
}