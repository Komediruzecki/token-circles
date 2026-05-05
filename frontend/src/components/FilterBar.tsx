/**
 * FilterBar Component
 * Provides filtering options for transactions (date, category, tag)
 */
import { createSignal } from 'solid-js'
import styles from './FilterBar.module.css'

interface FilterOption {
  id: number
  name: string
  color: string
}

interface FilterState {
  categories: FilterOption[]
  tags: FilterOption[]
  selectedCategories: number[] | undefined
  selectedTags: number[] | undefined
  dateRange: { from: string; to: string }
  selectedPreset: string
}

interface FilterBarProps {
  categories: FilterOption[]
  tags: FilterOption[]
  selectedCategories: number[] | undefined
  selectedTags: number[] | undefined
  dateRange: { from: string; to: string }
  selectedPreset: string
  showReconciled?: boolean
  reconciledCount?: number
  onToggleReconciled?: () => void
  onChange: (filters: FilterState) => void
}

export default function FilterBar(props: FilterBarProps) {
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = createSignal(false)
  const [isTagDropdownOpen, setIsTagDropdownOpen] = createSignal(false)

  const selectedCategories = () => props.selectedCategories || []
  const selectedTags = () => props.selectedTags || []

  const toggleCategoryDropdown = () => {
    setIsCategoryDropdownOpen(!isCategoryDropdownOpen())
  }

  const toggleTagDropdown = () => {
    setIsTagDropdownOpen(!isTagDropdownOpen())
  }

  const toggleCategory = (categoryId: number) => {
    const idx = selectedCategories().indexOf(categoryId)
    if (idx >= 0) {
      props.onChange({
        ...props,
        selectedCategories: selectedCategories().filter((id) => id !== categoryId),
      })
    } else {
      props.onChange({
        ...props,
        selectedCategories: [...selectedCategories(), categoryId],
      })
    }
  }

  const toggleTag = (tagId: number) => {
    const idx = selectedTags().indexOf(tagId)
    if (idx >= 0) {
      props.onChange({
        ...props,
        selectedTags: selectedTags().filter((id) => id !== tagId),
      })
    } else {
      props.onChange({
        ...props,
        selectedTags: [...selectedTags(), tagId],
      })
    }
  }

  const clearFilters = () => {
    props.onChange({
      ...props,
      selectedCategories: [],
      selectedTags: [],
      dateRange: { from: '', to: '' },
      selectedPreset: 'month',
    })
  }

  const categoryLabel = () => {
    if (selectedCategories().length === 0) return 'All Categories'
    return `${selectedCategories().length} Selected`
  }

  const tagLabel = () => {
    if (selectedTags().length === 0) return 'All Tags'
    return `${selectedTags().length} Selected`
  }

  const handlePresetClick = (preset: string) => {
    props.onChange({
      ...props,
      selectedPreset: preset,
    })
  }

  const handleDateChange = (field: 'from' | 'to') => (e: Event) => {
    const target = e.target as HTMLInputElement
    props.onChange({
      ...props,
      dateRange: {
        ...props.dateRange,
        [field]: target.value,
      },
    })
  }

  return (
    <div class={styles.filterBar}>
      <div class={styles.filters}>
        <div class={styles.filterGroup}>
          <div class={styles.filterDropdown}>
            <button class={styles.filterBtn} onClick={toggleCategoryDropdown}>
              <span class={styles.filterLabel}>{categoryLabel()}</span>
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width={2}
                viewBox="0 0 24 24"
              >
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isCategoryDropdownOpen() && (
              <div class={styles.filterDropdownContent}>
                <div class={styles.filterOption}>
                  <label class={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={selectedCategories().length === 0}
                      onChange={() => {
                        clearFilters()
                      }}
                    />
                    All Categories
                  </label>
                </div>
                <div class={styles.filterOptionList}>
                  {props.categories.map((cat) => (
                    <label class={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={selectedCategories().includes(cat.id)}
                        onChange={() => {
                          toggleCategory(cat.id)
                        }}
                      />
                      <span class={styles.catDot} style={{ background: `#${cat.color}` }} />
                      <span>{cat.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div class={styles.filterDropdown}>
            <button class={styles.filterBtn} onClick={toggleTagDropdown}>
              <span class={styles.filterLabel}>{tagLabel()}</span>
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width={2}
                viewBox="0 0 24 24"
              >
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isTagDropdownOpen() && (
              <div class={styles.filterDropdownContent}>
                <div class={styles.filterOption}>
                  <label class={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={selectedTags().length === 0}
                      onChange={() => {
                        clearFilters()
                      }}
                    />
                    All Tags
                  </label>
                </div>
                <div class={styles.filterOptionList}>
                  {props.tags.map((tag) => (
                    <label class={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={selectedTags().includes(tag.id)}
                        onChange={() => {
                          toggleTag(tag.id)
                        }}
                      />
                      <span class={styles.tagDot} style={{ background: `#${tag.color}` }} />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div class={styles.dateFilters}>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'month' ? styles.presetBtnActive : ''
            }`}
            onClick={() => {
              handlePresetClick('month')
            }}
          >
            This Month
          </button>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'lastMonth' ? styles.presetBtnActive : ''
            }`}
            onClick={() => {
              handlePresetClick('lastMonth')
            }}
          >
            Last Month
          </button>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'year' ? styles.presetBtnActive : ''
            }`}
            onClick={() => {
              handlePresetClick('year')
            }}
          >
            This Year
          </button>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'custom' ? styles.presetBtnActive : ''
            }`}
            onClick={() => {
              handlePresetClick('custom')
            }}
          >
            Custom
          </button>
        </div>

        {props.selectedPreset === 'custom' && (
          <div class={styles.customDates}>
            <div class={styles.dateInput}>
              <label class={styles.inputLabel}>From</label>
              <input
                type="date"
                class={styles.input}
                value={props.dateRange.from}
                onInput={handleDateChange('from')}
              />
            </div>
            <div class={styles.dateInput}>
              <label class={styles.inputLabel}>To</label>
              <input
                type="date"
                class={styles.input}
                value={props.dateRange.to}
                onInput={handleDateChange('to')}
              />
            </div>
          </div>
        )}

        {props.onToggleReconciled !== undefined && (
          <button
            class={`${styles.reconcileToggle} ${props.showReconciled ? '' : styles.reconcileToggleActive}`}
            onClick={props.onToggleReconciled}
            title={props.showReconciled ? 'Hide reconciled' : 'Show reconciled'}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Reconciled
            {(props.reconciledCount ?? 0) > 0 && (
              <span class={styles.reconcileBadge}>{props.reconciledCount}</span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
