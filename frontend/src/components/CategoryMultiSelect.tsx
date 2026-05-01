/**
 * Category Multi-Select Component
 * Dropdown with checkbox-style category selection
 */
import { createSignal, createEffect, onCleanup, onMount } from 'solid-js'
import categoryMultiSelectStyles from './CategoryMultiSelect.module.css'
import { api } from '../core/api'
import type { Category } from '../types/models'

export interface CategoryMultiSelectProps {
  categories: () => Category[]
  selectedCategoryIds: () => number[]
  onChange: (selectedIds: number[]) => void
  placeholder?: string
}

export function CategoryMultiSelect(props: CategoryMultiSelectProps) {
  const [isOpen, setIsOpen] = createSignal(false)
  const [searchTerm, setSearchTerm] = createSignal('')
  const [filteredCategories, setFilteredCategories] = createSignal<Category[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [hoverIndex, setHoverIndex] = createSignal(-1)

  const [loading, setLoading] = createSignal(false)

  createEffect(() => {
    const all = props.categories()
    const term = searchTerm().toLowerCase()

    setFilteredCategories(
      all.filter((cat) =>
        cat.name.toLowerCase().includes(term) &&
        props.selectedCategoryIds().includes(cat.id)
      )
    )
  })

  const toggleCategory = (categoryId: number) => {
    const selected = props.selectedCategoryIds()
    const index = selected.indexOf(categoryId)
    const newSelected = index >= 0 ? selected.filter((id) => id !== categoryId) : [...selected, categoryId]
    props.onChange(newSelected)
  }

  const toggleAll = () => {
    const selected = props.selectedCategoryIds()
    const allIds = props.categories().map((c) => c.id)
    const newSelected = selected.length === allIds.length ? [] : allIds
    props.onChange(newSelected)
  }

  const deselectAll = () => {
    props.onChange([])
  }

  const getSelectedNames = () => {
    const selected = props.selectedCategoryIds()
    const categories = props.categories()
    return selected
      .map((id) => categories.find((c) => c.id === id)?.name)
      .filter((name): name is string => name !== undefined)
  }

  const containerRef = createSignal<HTMLElement | null>(null)

  const handleToggleDropdown = () => {
    setIsOpen(!isOpen())
    if (!isOpen()) {
      setSearchTerm('')
      setSelectedIndex(0)
    }
  }

  const handleClickOutside = (e: MouseEvent) => {
    const container = containerRef() as HTMLElement
    if (container && !container.contains(e.target as Node)) {
      setIsOpen(false)
    }
  }

  const handleSearchInput = (e: InputEvent) => {
    const target = e.target as HTMLInputElement
    setSearchTerm(target.value)
    setSelectedIndex(0)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = filteredCategories()
    const currentIndex = selectedIndex()

    if (e.key === 'ArrowDown' && currentIndex < items.length - 1) {
      e.preventDefault()
      setSelectedIndex(currentIndex + 1)
    } else if (e.key === 'ArrowUp' && currentIndex > 0) {
      e.preventDefault()
      setSelectedIndex(currentIndex - 1)
    } else if (e.key === 'Enter' && currentIndex >= 0 && currentIndex < items.length) {
      e.preventDefault()
      toggleCategory(items[currentIndex].id)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleBlur = () => {
    setTimeout(() => setIsOpen(false), 150)
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside)
  })

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside)
  })

  const selectedCount = () => props.selectedCategoryIds().length
  const countText = () => {
    if (selectedCount() === 0) return props.placeholder || 'Select categories'
    if (selectedCount() === 1) return getSelectedNames()[0]
    return `${getSelectedNames()[0]} + ${selectedCount() - 1} more`
  }

  return (
    <div
      class={categoryMultiSelectStyles.container}
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onClick={handleToggleDropdown}
      onBlur={handleBlur}
    >
      <button class={categoryMultiSelectStyles.selectBtn}>
        <span class={categoryMultiSelectStyles.selectValue}>{countText()}</span>
        <svg
          class={`${categoryMultiSelectStyles.arrow} ${isOpen() ? categoryMultiSelectStyles.arrowOpen : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen() && (
        <div class={categoryMultiSelectStyles.dropdown}>
          <div class={categoryMultiSelectStyles.header}>
            <button class={categoryMultiSelectStyles.selectAllBtn} onClick={toggleAll}>
              {props.selectedCategoryIds().length === props.categories().length ? 'Deselect All' : 'Select All'}
            </button>
            <button class={categoryMultiSelectStyles.deselectAllBtn} onClick={deselectAll}>
              Clear
            </button>
          </div>

          <input
            type="text"
            class={categoryMultiSelectStyles.searchInput}
            placeholder="Search categories..."
            value={searchTerm()}
            onInput={handleSearchInput}
          />

          <div class={categoryMultiSelectStyles.categoryList}>
            {filteredCategories().length === 0 ? (
              <div class={categoryMultiSelectStyles.noResults}>No categories match</div>
            ) : (
              filteredCategories().map((category, index) => (
                <button
                  key={category.id}
                  class={`${categoryMultiSelectStyles.categoryItem} ${
                    hoverIndex() === index ? categoryMultiSelectStyles.hovered : ''
                  }`}
                  onMouseEnter={() => setHoverIndex(index)}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCategory(category.id)
                  }}
                >
                  <input
                    type="checkbox"
                    checked={props.selectedCategoryIds().includes(category.id)}
                    readOnly
                  />
                  <span class={categoryMultiSelectStyles.categoryColor} style={{ backgroundColor: category.color }} />
                  <span class={categoryMultiSelectStyles.categoryName}>{category.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CategoryMultiSelectDefault(props: CategoryMultiSelectProps) {
  return <CategoryMultiSelect {...props} />
}
