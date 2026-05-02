/**
 * Tag Input Component
 * Inline tag creation with enter key to add
 */
import { createSignal } from 'solid-js'

export interface TagInputProps {
  existingTags: () => string[]
  onAdd: (tag: string) => void
  placeholder?: string
  maxSize?: number
  autoFocus?: boolean
}

export function TagInput(props: TagInputProps) {
  const [tagText, setTagText] = createSignal('')
  const [_isFocused, _setIsFocused] = createSignal(false)

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Escape') {
      setTagText('')
    }
  }

  const addTag = () => {
    const tag = tagText().trim()
    const existing = props.existingTags()

    if (tag && !existing.includes(tag)) {
      props.onAdd(tag)
      setTagText('')
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const removeTag = () => {
    if (tagText().trim()) {
      props.onAdd(tagText().trim())
    }
  }

  return (
    <div
      class={TagInputStyles.tagInput}
    >
      <input
        class={TagInputStyles.input}
        type="text"
        value={tagText()}
        onInput={(e) => setTagText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onBlur={removeTag}
        placeholder={props.placeholder || 'Add tag and press Enter'}
        autocomplete="off"
        autofocus={props.autoFocus}
      />
      <span class={TagInputStyles.divider}>+</span>
    </div>
  )

  return (
    <div
      class={TagInputStyles.tagInput}
    >
      <input
        class={TagInputStyles.input}
        type="text"
        value={tagText()}
        onInput={(e) => setTagText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder || 'Add tag and press Enter'}
        autocomplete="off"
        autofocus={props.autoFocus}
      />
      <span class={TagInputStyles.divider}>+</span>
    </div>
  )
}

export default function TagInputDefault(props: TagInputProps) {
  return <TagInput {...props} />
}

const TagInputStyles = {
  tagInput: 'tag-input',
  input: 'tag-input__input',
  divider: 'tag-input__divider',
}
