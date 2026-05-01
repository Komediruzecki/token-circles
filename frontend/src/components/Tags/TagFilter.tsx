/**
 * Tag Filter Component
 * Dropdown filter for filtering transactions by tags
 */
import { createSignal, createEffect, For } from 'solid-js'
import tagFilterStyles from './TagFilter.module.css'

export interface TagFilterProps {
  availableTags: () => string[]
  selectedTags: () => Set<string>
  onToggle: (tag: string) => void
  onClear: () => void
}

export function TagFilter(props: TagFilterProps) {
  const [isOpen, setIsOpen] = createSignal(false)
  const [filterText, setFilterText] = createSignal('')
  const tags = props.availableTags()
  const selectedTags = props.selectedTags()

  const filteredTags = () => {
    if (!filterText()) return tags
    return tags.filter((tag) => tag.toLowerCase().includes(filterText().toLowerCase()))
  }

  const selectedCount = () => {
    return Array.from(selectedTags()).length
  }

  const allSelected = () => {
    return selectedTags().size === tags.length && tags.length > 0
  }

  const anySelected = () => {
    return selectedTags().size > 0
  }

  createEffect(() => {
    if (!isOpen()) {
      setFilterText('')
    }
  })

  return (
    <div class={tagFilterStyles.tagFilterContainer}>
      <div class={tagFilterStyles.filterButton} onClick={() => setIsOpen(!isOpen())}>
        <span class={tagFilterStyles.filterLabel}>Filter by tags:</span>
        <span class={tagFilterStyles.filterCount}>
          {anySelected() ? `${selectedCount()} selected` : ''}
        </span>
      </div>

      <Show when={isOpen()}>
        <div class={tagFilterStyles.dropdown}>
          <div class={tagFilterStyles.searchContainer}>
            <input
              class={tagFilterStyles.searchInput}
              type="text"
              placeholder="Search tags..."
              onInput={(e) => setFilterText(e.currentTarget.value)}
            />
            <button
              class={tagFilterStyles.clearSearch}
              onClick={() => setFilterText('')}
              aria-label="Clear search"
              type="button"
            >
              ×
            </button>
          </div>

          <div class={tagFilterStyles.tagList}>
            <div class={tagFilterStyles.selectAllRow}>
              <button
                class={tagFilterStyles.selectAllButton}
                onClick={() => {
                  if (allSelected()) {
                    props.onClear()
                  } else {
                    tags.forEach((tag) => props.onToggle(tag))
                  }
                }}
                type="button"
              >
                {allSelected() ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <For each={filteredTags()}>
              {(tag) => {
                const isSelected = () => selectedTags().has(tag)
                return (
                  <div class={tagFilterStyles.tagItem}>
                    <button
                      class={`${tagFilterStyles.tagCheckbox} ${isSelected() ? tagFilterStyles.selected : ''}`}
                      onClick={() => props.onToggle(tag)}
                      type="button"
                    >
                      <span class={tagFilterStyles.checkboxIndicator}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="white"
                          strokeWidth="2"
                        >
                          <polyline points="2 6 4.5 8.5 10 2.5" />
                        </svg>
                      </span>
                    </button>
                    <span class={tagFilterStyles.tagName}>{tag}</span>
                  </div>
                )
              }}
            </For>

            <Show when={filteredTags().length === 0}>
              <div class={tagFilterStyles.noResults}>No tags found</div>
            </Show>
          </div>

          <div class={tagFilterStyles.footer}>
            <button
              class={tagFilterStyles.clearButton}
              onClick={props.onClear}
              type="button"
            >
              Clear Selection
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default function TagFilterDefault(props: TagFilterProps) {
  return <TagFilter {...props} />
}
