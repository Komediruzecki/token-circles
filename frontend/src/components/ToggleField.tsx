import { createUniqueId } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import Toggle from './Toggle'
import styles from './ToggleField.module.css'

export interface ToggleFieldProps {
  title: string
  description: string
  checked: (() => boolean) | boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /**
   * The whole row flips the switch: it is a label for it, so a tap on the title, the description
   * or the space around them counts, and a disabled switch takes none. The switch stays the one
   * control a keyboard or a screen reader meets.
   */
  wholeRow?: boolean
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
  const toggleId = `${id}-switch`

  return (
    <Dynamic
      component={props.wholeRow ? 'label' : 'div'}
      class={styles.row}
      classList={{ [styles.rowTarget]: props.wholeRow === true && props.disabled !== true }}
      for={props.wholeRow ? toggleId : undefined}
    >
      <Dynamic component={props.wholeRow ? 'span' : 'div'} class={styles.copy}>
        <span class={styles.title} id={titleId}>
          {props.title}
        </span>
        <span class={styles.description} id={descriptionId}>
          {props.description}
        </span>
      </Dynamic>
      <Toggle
        id={props.wholeRow ? toggleId : undefined}
        checked={props.checked}
        onChange={props.onChange}
        disabled={props.disabled}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-test-id={props['data-test-id']}
      />
    </Dynamic>
  )
}
