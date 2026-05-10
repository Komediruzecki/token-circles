/**
 * FilterBar Component
 * Single-line filter bar with categories, tags, search, date presets, reconcile
 */
import { createMemo, createSignal, For } from 'solid-js'
import styles from './FilterBar.module.css'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface FilterOption {
  id: number
  name: string
  color: string
  type?: string
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
  onCategoryChange?: (ids: number[]) => void
  searchTerm?: string
  onSearchChange?: (term: string) => void
  filterType?: string
  onFilterTypeChange?: (type: string) => void
  onChange: (filters: FilterState) => void
}

export default function FilterBar(props: FilterBarProps) {
  const [isTagDropdownOpen, setIsTagDropdownOpen] = createSignal(false)
  const [isCatDropdownOpen, setIsCatDropdownOpen] = createSignal(false)

  const selectedTags = () => props.selectedTags || []
  const selectedCats = () => props.selectedCategories || []

  const closeAllDropdowns = () => {
    setIsTagDropdownOpen(false)
    setIsCatDropdownOpen(false)
  }

  const toggleTagDropdown = () => {
    setIsTagDropdownOpen(!isTagDropdownOpen())
    setIsCatDropdownOpen(false)
  }

  const toggleCatDropdown = () => {
    setIsCatDropdownOpen(!isCatDropdownOpen())
    setIsTagDropdownOpen(false)
  }

  const toggleTag = (tagId: number) => {
    const idx = selectedTags().indexOf(tagId)
    if (idx >= 0) {
      props.onChange({ ...props, selectedTags: selectedTags().filter((id) => id !== tagId) })
    } else {
      props.onChange({ ...props, selectedTags: [...selectedTags(), tagId] })
    }
  }

  const toggleCat = (catId: number) => {
    const idx = selectedCats().indexOf(catId)
    if (idx >= 0) {
      if (props.onCategoryChange)
        props.onCategoryChange(selectedCats().filter((id) => id !== catId))
    } else {
      if (props.onCategoryChange) props.onCategoryChange([...selectedCats(), catId])
    }
  }

  const clearFilters = () => {
    if (props.onCategoryChange) props.onCategoryChange([])
    if (props.onSearchChange) props.onSearchChange('')
    if (props.onFilterTypeChange) props.onFilterTypeChange('all')
    props.onChange({
      ...props,
      selectedCategories: [],
      selectedTags: [],
      dateRange: { from: '', to: '' },
      selectedPreset: 'month',
    })
  }

  const catLabel = () => {
    if (selectedCats().length === 0) return 'All Categories'
    return `${selectedCats().length} Selected`
  }

  const tagLabel = () => {
    if (selectedTags().length === 0) return 'All Tags'
    return `${selectedTags().length} Selected`
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  const derivedMonth = createMemo(() => {
    const dr = props.dateRange
    if (dr && dr.from) {
      const d = new Date(dr.from)
      if (!isNaN(d.getTime())) return d.getMonth()
    }
    return currentMonth
  })

  const derivedYear = createMemo(() => {
    const dr = props.dateRange
    if (dr && dr.from) {
      const d = new Date(dr.from)
      if (!isNaN(d.getTime())) return d.getFullYear()
    }
    return currentYear
  })

  const years = createMemo(() => {
    const range: number[] = []
    for (let y = currentYear - 5; y <= currentYear + 5; y++) range.push(y)
    return range
  })

  const handleMonthYearChange = (month: number, year: number) => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    props.onChange({
      ...props,
      dateRange: { from: fmt(firstDay), to: fmt(lastDay) },
      selectedPreset: 'custom',
    })
  }

  const handlePresetClick = (preset: string) => {
    props.onChange({ ...props, selectedPreset: preset })
  }

  const handleDateChange = (field: 'from' | 'to') => (e: Event) => {
    const target = e.target as HTMLInputElement
    props.onChange({
      ...props,
      dateRange: { ...props.dateRange, [field]: target.value },
    })
  }

  return (
    <div class={styles.filterBar}>
      <div class={styles.filterRow}>
        {/* Category dropdown */}
        <div class={styles.filterDropdown}>
          <button class={styles.filterBtn} onClick={toggleCatDropdown}>
            <span class={styles.filterLabel}>{catLabel()}</span>
            <svg
              width="10"
              height="10"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isCatDropdownOpen() && (
            <div class={styles.dropdownContent}>
              <div class={styles.optionList}>
                <label class={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={selectedCats().length === 0}
                    onChange={clearFilters}
                  />
                  All Categories
                </label>
                <For each={props.categories}>
                  {(cat) => (
                    <label class={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={selectedCats().includes(cat.id)}
                        onChange={() => {
                          toggleCat(cat.id)
                        }}
                      />
                      <span
                        class={styles.catDot}
                        style={{ background: `#${cat.color || '94a3b8'}` }}
                      />
                      <span>{cat.name}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
          )}
        </div>

        {/* Tag dropdown */}
        <div class={styles.filterDropdown}>
          <button class={styles.filterBtn} onClick={toggleTagDropdown}>
            <span class={styles.filterLabel}>{tagLabel()}</span>
            <svg
              width="10"
              height="10"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isTagDropdownOpen() && (
            <div class={styles.dropdownContent}>
              <div class={styles.optionList}>
                <label class={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={selectedTags().length === 0}
                    onChange={clearFilters}
                  />
                  All Tags
                </label>
                <For each={props.tags}>
                  {(tag) => (
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
                  )}
                </For>
              </div>
            </div>
          )}
        </div>

        {/* Type filter */}
        {props.onFilterTypeChange && (
          <div class={styles.typeBtns}>
            {['all', 'income', 'expense', 'transfer'].map((t) => (
              <button
                class={`${styles.typeBtn} ${(props.filterType || 'all') === t ? styles.typeBtnActive : ''}`}
                onClick={() => props.onFilterTypeChange?.(t)}
              >
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        {props.onSearchChange !== undefined && (
          <input
            type="text"
            class={styles.searchInput}
            placeholder="Search..."
            value={props.searchTerm || ''}
            onInput={(e) => props.onSearchChange?.((e.target as HTMLInputElement).value)}
          />
        )}

        {/* Date presets */}
        <div class={styles.dateFilters}>
          {['month', 'lastMonth', 'year'].map((p) => (
            <button
              class={`${styles.presetBtn} ${props.selectedPreset === p ? styles.presetBtnActive : ''}`}
              onClick={() => {
                handlePresetClick(p)
              }}
            >
              {p === 'month' ? 'This Month' : p === 'lastMonth' ? 'Last Month' : 'This Year'}
            </button>
          ))}
        </div>

        {/* Month/Year nav */}
        <div class={styles.monthYearNav}>
          <select
            class={styles.monthYearSelect}
            value={derivedMonth()}
            onChange={(e) => {
              handleMonthYearChange(parseInt(e.currentTarget.value), derivedYear())
            }}
          >
            <For each={MONTH_NAMES}>{(name, i) => <option value={i()}>{name}</option>}</For>
          </select>
          <select
            class={styles.monthYearSelect}
            value={derivedYear()}
            onChange={(e) => {
              handleMonthYearChange(derivedMonth(), parseInt(e.currentTarget.value))
            }}
          >
            <For each={years()}>{(y) => <option value={y}>{y}</option>}</For>
          </select>
        </div>

        {/* Actions */}
        <div class={styles.filterActions}>
          {props.onToggleReconciled !== undefined && (
            <button
              class={`${styles.reconcileToggle} ${props.showReconciled ? '' : styles.reconcileToggleActive}`}
              onClick={props.onToggleReconciled}
              title={props.showReconciled ? 'Hide reconciled' : 'Show reconciled'}
            >
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {(props.reconciledCount ?? 0) > 0 && (
                <span class={styles.reconcileBadge}>{props.reconciledCount}</span>
              )}
            </button>
          )}
          <button class={styles.clearBtn} onClick={clearFilters}>
            <svg
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Click-outside backdrop for dropdowns */}
      {(isCatDropdownOpen() || isTagDropdownOpen()) && (
        <div class={styles.dropdownBackdrop} onClick={closeAllDropdowns} />
      )}

      {/* Custom date inputs */}
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
    </div>
  )
}
