/**
 * Tag Chips Component
 * Displays tags as clickable chips with optional remove buttons
 */
import { For, Show } from 'solid-js'
import tagChipsStyles from './TagChips.module.css'

export interface TagChipsProps {
  tags: () => string[]
  onRemove?: (tag: string) => void
  editable?: boolean
  maxSize?: number
  pill?: boolean
}

export function TagChips(props: TagChipsProps) {
  const tags = props.tags()
  const displayedTags = props.maxSize && props.maxSize > 0
    ? tags.slice(0, props.maxSize)
    : tags

  if (displayedTags.length === 0) {
    return null
  }

  return (
    <div class={tagChipsStyles.tagChips}>
      <Show when={displayedTags.length > (props.maxSize || 0)}>
        <span class={tagChipsStyles.moreTags}>+{displayedTags.length - (props.maxSize || 0)} more</span>
      </Show>
      <For each={displayedTags}>
        {(tag) => (
          <span class={`${tagChipsStyles.tagChip} ${props.pill ? tagChipsStyles.pill : ''}`}>
            {tag}
            <Show when={props.editable && props.onRemove}>
              <button
                class={tagChipsStyles.removeButton}
                onClick={() => props.onRemove?.(tag)}
                aria-label={`Remove tag ${tag}`}
                type="button"
              >
                ×
              </button>
            </Show>
          </span>
        )}
      </For>
    </div>
  )
}

export default function TagChipsDefault(props: TagChipsProps) {
  return <TagChips {...props} />
}
