/**
 * FilterBar Component
 * Provides filtering options for transactions (date, category, tag)
 */
import { createSignal } from 'solid-js'
import styles from './FilterBar.module.css'

interface FilterBarProps {
  categories: Array<{ id: number; name: string; color: string }>
  tags: Array<{ id: number; name: string; color: string }>
  selectedCategories: number[]
  selectedTags: number[]
  dateRange: { from: string; to: string }
  selectedPreset: string
  onChange: (filters: any) => void
}

const PRESETS = ['month', 'lastMonth', 'year', 'custom']

export default function FilterBar(props: FilterBarProps) {
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = createSignal(false)
  const [isTagDropdownOpen, setIsTagDropdownOpen] = createSignal(false)

  const toggleCategoryDropdown = () => {
    setIsCategoryDropdownOpen(!isCategoryDropdownOpen())
  }

  const toggleTagDropdown = () => {
    setIsTagDropdownOpen(!isTagDropdownOpen())
  }

  const toggleCategory = (categoryId: number) => {
    const idx = props.selectedCategories.indexOf(categoryId)
    if (idx >= 0) {
      props.onChange({
        ...props,
        selectedCategories: props.selectedCategories.filter(id => id !== categoryId)
      })
    } else {
      props.onChange({
        ...props,
        selectedCategories: [...props.selectedCategories, categoryId]
      })
    }
  }

  const toggleTag = (tagId: number) => {
    const idx = props.selectedTags.indexOf(tagId)
    if (idx >= 0) {
      props.onChange({
        ...props,
        selectedTags: props.selectedTags.filter(id => id !== tagId)
      })
    } else {
      props.onChange({
        ...props,
        selectedTags: [...props.selectedTags, tagId]
      })
    }
  }

  const clearFilters = () => {
    props.onChange({
      ...props,
      selectedCategories: [],
      selectedTags: [],
      dateRange: { from: '', to: '' },
      selectedPreset: 'month'
    })
  }

  const categoryLabel = () => {
    if (props.selectedCategories.length === 0) return 'All Categories'
    return `${props.selectedCategories.length} Selected`
  }

  const tagLabel = () => {
    if (props.selectedTags.length === 0) return 'All Tags'
    return `${props.selectedTags.length} Selected`
  }

  const handlePresetClick = (preset: string) => {
    props.onChange({
      ...props,
      selectedPreset: preset
    })
  }

  const handleDateChange = (field: 'from' | 'to') => (e: Event) => {
    const target = e.target as HTMLInputElement
    props.onChange({
      ...props,
      dateRange: {
        ...props.dateRange,
        [field]: target.value
      }
    })
  }

  return (
    <div class={styles.filterBar}>
      <div class={styles.filters}>
        <div class={styles.filterGroup}>
          <div class={styles.filterDropdown}>
            <button class={styles.filterBtn} onClick={toggleCategoryDropdown}>
              <span class={styles.filterLabel}>{categoryLabel()}</span>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isCategoryDropdownOpen() && (
              <div class={styles.filterDropdownContent}>
                <div class={styles.filterOption}>
                  <label class={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={props.selectedCategories.length === 0}
                      onChange={() => clearFilters()}
                    />
                    All Categories
                  </label>
                </div>
                <div class={styles.filterOptionList}>
                  {props.categories.map(cat => (
                    <label class={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={props.selectedCategories.includes(cat.id)}
                        onChange={() => toggleCategory(cat.id)}
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
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isTagDropdownOpen() && (
              <div class={styles.filterDropdownContent}>
                <div class={styles.filterOption}>
                  <label class={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={props.selectedTags.length === 0}
                      onChange={() => clearFilters()}
                    />
                    All Tags
                  </label>
                </div>
                <div class={styles.filterOptionList}>
                  {props.tags.map(tag => (
                    <label class={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={props.selectedTags.includes(tag.id)}
                        onChange={() => toggleTag(tag.id)}
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
            onClick={() => handlePresetClick('month')}
          >
            This Month
          </button>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'lastMonth' ? styles.presetBtnActive : ''
            }`}
            onClick={() => handlePresetClick('lastMonth')}
          >
            Last Month
          </button>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'year' ? styles.presetBtnActive : ''
            }`}
            onClick={() => handlePresetClick('year')}
          >
            This Year
          </button>
          <button
            class={`${styles.presetBtn} ${
              props.selectedPreset === 'custom' ? styles.presetBtnActive : ''
            }`}
            onClick={() => handlePresetClick('custom')}
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
      </div>
    </div>
  )
}