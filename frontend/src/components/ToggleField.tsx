import { createUniqueId } from 'solid-js'
import Toggle from './Toggle'
import styles from './ToggleField.module.css'

export interface ToggleFieldProps {
  title: string
  description: string
  checked: (() => boolean) | boolean
  onChange: (value: boolean) => void
  'data-test-id'?: string
}

/**
 * Form setting row with a stable title/description column and a right-aligned switch.
 * The text remains unframed so it reads as part of the form rather than a card within a modal.
 */
export default function ToggleField(props: ToggleFieldProps) {
  const id = createUniqueId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  return (
    <div class={styles.row}>
      <div class={styles.copy}>
        <span class={styles.title} id={titleId}>
          {props.title}
        </span>
        <span class={styles.description} id={descriptionId}>
          {props.description}
        </span>
      </div>
      <Toggle
        checked={props.checked}
        onChange={props.onChange}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-test-id={props['data-test-id']}
      />
    </div>
  )
}
