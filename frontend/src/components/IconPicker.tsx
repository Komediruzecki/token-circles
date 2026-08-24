import { createMemo, createSignal, For, onCleanup, onMount } from 'solid-js'
import { iconSvgByKey, PICKABLE_ICON_NAMES } from './CategoryIcon'
import styles from './IconPicker.module.css'

interface IconPickerProps {
  /** The icon key currently in the field, so the picker can show which one that is. */
  value?: string | null
  /** Called with the chosen key. The caller writes it into the field and closes this. */
  onPick: (name: string) => void
  onClose: () => void
}

/**
 * The gallery behind the icon field's "Browse" button.
 *
 * The field takes a keyword and resolves it — "food" finds the fork and knife — which works well
 * once you know roughly what is in there, and not at all before that. Typing was the only way to
 * discover the set, so the icons nobody guessed the name of were effectively not shipped.
 *
 * Picking writes the key into the same text field rather than into some parallel piece of state:
 * the field stays the one source of truth, so a chosen icon can still be edited or cleared by
 * hand, and nothing about how the value is stored changes.
 */
export default function IconPicker(props: IconPickerProps) {
  const [filter, setFilter] = createSignal('')

  const matches = createMemo(() => {
    const q = filter().trim().toLowerCase()
    if (!q) return PICKABLE_ICON_NAMES
    return PICKABLE_ICON_NAMES.filter((name) => name.includes(q))
  })

  const selected = () => (props.value ?? '').trim().toLowerCase()

  // Escape closes, from wherever the focus happens to be inside the panel.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The category modal underneath listens for Escape too; without this it closes as well,
        // and dismissing the gallery would throw away the half-filled form behind it.
        e.stopPropagation()
        props.onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true)
    })
  })

  return (
    <div
      class={styles.pickerOverlay}
      data-test-id="icon-picker-overlay"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        class={styles.picker}
        role="dialog"
        aria-modal="true"
        aria-label="Choose an icon"
        onclick={(e) => {
          e.stopPropagation()
        }}
      >
        <div class={styles.pickerHeader}>
          <h4 class={styles.pickerTitle}>Choose an icon</h4>
          <button
            type="button"
            class={styles.pickerClose}
            aria-label="Close icon gallery"
            data-test-id="icon-picker-close"
            onClick={() => {
              props.onClose()
            }}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class={styles.pickerSearch}>
          <input
            type="text"
            class={styles.pickerSearchInput}
            placeholder="Filter icons"
            aria-label="Filter icons"
            data-test-id="icon-picker-filter"
            // Deliberately uncontrolled: binding `value` back to the signal would write to the
            // field while it has focus, which is how this frontend's inputs lose characters.
            oninput={(e) => setFilter(e.currentTarget.value)}
          />
        </div>

        <div class={styles.pickerGrid} data-test-id="icon-picker-grid">
          <For each={matches()}>
            {(name) => (
              <button
                type="button"
                class={`${styles.pickerItem} ${selected() === name ? styles.pickerItemActive : ''}`}
                title={name}
                aria-pressed={selected() === name}
                data-test-id={`icon-picker-item-${name}`}
                onClick={() => {
                  props.onPick(name)
                }}
              >
                <span class={styles.pickerItemGlyph} aria-hidden="true">
                  {iconSvgByKey(name, 22)}
                </span>
                <span class={styles.pickerItemName}>{name}</span>
              </button>
            )}
          </For>
        </div>

        {matches().length === 0 && (
          <p class={styles.pickerEmpty} data-test-id="icon-picker-empty">
            No icon matches that. Clear the filter to see all {PICKABLE_ICON_NAMES.length}.
          </p>
        )}
      </div>
    </div>
  )
}
