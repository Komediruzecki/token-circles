/**
 * BulkActionBar Component
 * Shown when transactions are selected — provides batch operations
 * Includes Change Category and Change Type modals (ported from old JS app)
 */
import { createEffect, createSignal, For, Show } from 'solid-js'
import styles from './BulkActionBar.module.css'

interface Category {
  id: number
  name: string
  color?: string
}

interface Tag {
  id: number
  name: string
  color?: string
}

interface BulkActionBarProps {
  selectedCount: number
  categories: Category[]
  tags: Tag[]
  onClearSelection: () => void
  onDeleteSelected: () => void
  onReconcileSelected: () => void
  onChangeCategory: (categoryId: number | null) => void
  onChangeType: (type: string) => void
  /** Add or remove the given tags across the selected transactions. */
  onApplyTags: (tagIds: number[], mode: 'add' | 'remove') => void | Promise<void>
  /** Create a new tag inline; resolves to the created tag (or null on failure). */
  onCreateTag: (name: string) => Promise<Tag | null>
}

export default function BulkActionBar(props: BulkActionBarProps) {
  const [showCategoryModal, setShowCategoryModal] = createSignal(false)
  const [showTypeModal, setShowTypeModal] = createSignal(false)
  const [showTagModal, setShowTagModal] = createSignal(false)
  const [selectedCategoryId, setSelectedCategoryId] = createSignal<string>('')
  const [selectedType, setSelectedType] = createSignal<string>('')
  const [tagMode, setTagMode] = createSignal<'add' | 'remove'>('add')
  const [pickedTagIds, setPickedTagIds] = createSignal<number[]>([])
  const [newTagName, setNewTagName] = createSignal('')
  const [applyingTags, setApplyingTags] = createSignal(false)

  // Emptying the selection tears the whole bar down (see the <Show> below). Disarm the modals as
  // that happens, otherwise one left open stays flagged and springs back the next time rows are
  // selected — the user would reselect and land in a modal they never reopened.
  createEffect(() => {
    if (props.selectedCount === 0) {
      setShowCategoryModal(false)
      setShowTypeModal(false)
      setShowTagModal(false)
    }
  })

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

  const openTagModal = () => {
    setTagMode('add')
    setPickedTagIds([])
    setNewTagName('')
    setShowTagModal(true)
  }

  const toggleTag = (id: number) =>
    setPickedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleCreateNewTag = async () => {
    const name = newTagName().trim()
    if (!name) return
    const created = await props.onCreateTag(name)
    if (created) {
      setPickedTagIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]))
      setNewTagName('')
    }
  }

  const handleApplyTags = async () => {
    const ids = pickedTagIds()
    if (!ids.length || applyingTags()) return
    setApplyingTags(true)
    try {
      await props.onApplyTags(ids, tagMode())
      setShowTagModal(false)
    } finally {
      setApplyingTags(false)
    }
  }

  return (
    // Gate on the selection reactively. This used to be an `if (props.selectedCount === 0) return
    // null` in the component body — but a Solid component body runs ONCE, and Transactions mounts
    // this bar while nothing is selected, so that check latched on the initial 0 and the bar never
    // appeared no matter how many rows were later selected. <Show> re-evaluates, which is what
    // makes every bulk action here (Tag included) reachable at all.
    <Show when={props.selectedCount > 0}>
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
        <button
          class={`${styles.btn} ${styles.btnSecondary}`}
          data-test-id="bulk-tag-btn"
          onClick={openTagModal}
        >
          Tag
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

      {/* Bulk Tag Modal — add or remove tags across the selection (additive; other tags untouched) */}
      <Show when={showTagModal()}>
        <div
          class={styles.modalOverlay}
          onClick={() => {
            setShowTagModal(false)
          }}
        >
          <div
            class={styles.modal}
            data-test-id="bulk-tag-modal"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <div class={styles.modalTitle}>Tag transactions</div>
              <button
                class={styles.modalClose}
                onClick={() => {
                  setShowTagModal(false)
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
                {tagMode() === 'add' ? 'Add' : 'Remove'} tags {tagMode() === 'add' ? 'to' : 'from'}{' '}
                <strong>{props.selectedCount}</strong> selected transaction
                {props.selectedCount === 1 ? '' : 's'}.
              </p>
              <div class={styles.formGroup}>
                <div class={styles.tagModeToggle}>
                  <button
                    type="button"
                    class={`${styles.tagModeBtn} ${tagMode() === 'add' ? styles.tagModeBtnActive : ''}`}
                    onClick={() => setTagMode('add')}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    class={`${styles.tagModeBtn} ${tagMode() === 'remove' ? styles.tagModeBtnActive : ''}`}
                    onClick={() => setTagMode('remove')}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Tags</label>
                <Show
                  when={props.tags.length > 0}
                  fallback={<p class={styles.emptyHint}>No tags yet — create one below.</p>}
                >
                  <div class={styles.tagChips} data-test-id="bulk-tag-chips">
                    <For each={props.tags}>
                      {(tag) => (
                        <button
                          type="button"
                          class={`${styles.tagChip} ${pickedTagIds().includes(tag.id) ? styles.tagChipActive : ''}`}
                          onClick={() => toggleTag(tag.id)}
                        >
                          <span
                            class={styles.tagChipDot}
                            style={{ background: tag.color || 'var(--primary)' }}
                          />
                          {tag.name}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <Show when={tagMode() === 'add'}>
                <div class={styles.newTagRow}>
                  <input
                    class={styles.formControl}
                    type="text"
                    placeholder="Create a new tag..."
                    data-test-id="bulk-tag-new-input"
                    value={newTagName()}
                    onInput={(e) => setNewTagName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleCreateNewTag()
                      }
                    }}
                  />
                  <button
                    type="button"
                    class={styles.btnSecondary}
                    disabled={!newTagName().trim()}
                    onClick={() => void handleCreateNewTag()}
                  >
                    Create
                  </button>
                </div>
              </Show>
            </div>
            <div class={styles.modalFooter}>
              <button
                class={styles.btnSecondary}
                onClick={() => {
                  setShowTagModal(false)
                }}
              >
                Cancel
              </button>
              <button
                class={styles.btnPrimary}
                data-test-id="bulk-tag-apply"
                disabled={pickedTagIds().length === 0 || applyingTags()}
                onClick={() => void handleApplyTags()}
              >
                {applyingTags() ? 'Applying…' : tagMode() === 'add' ? 'Add tags' : 'Remove tags'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  )
}
