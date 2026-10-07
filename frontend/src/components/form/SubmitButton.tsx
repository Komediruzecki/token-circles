/**
 * A kit form's submit button, which says the form is working while it sends.
 *
 * While `busy` it reads `busyLabel` ("Saving…" unless the form has its own verb, like "Adding…")
 * and is `aria-disabled`, not `disabled`: a disabled button loses focus, so a keyboard user who
 * pressed it would be dropped at the top of the page. It stays focusable, and a click on it while
 * it is busy does nothing. The form's own submit sends once anyway, however it is triggered.
 */
import { splitProps } from 'solid-js'
import styles from './Form.module.css'
import type { JSX } from 'solid-js'

export interface SubmitButtonProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'disabled' | 'onClick'
> {
  /** True while the form sends: pass `form.submitting()`. */
  busy: boolean
  /** What the button says while busy. */
  busyLabel?: string
  children: JSX.Element
}

export const SAVING = 'Saving…'

export default function SubmitButton(props: SubmitButtonProps): JSX.Element {
  const [local, button] = splitProps(props, ['busy', 'busyLabel', 'children', 'class'])
  return (
    <button
      {...button}
      type="submit"
      class={local.class ? `${styles.submit} ${local.class}` : styles.submit}
      aria-disabled={local.busy ? 'true' : undefined}
      onClick={(event) => {
        if (local.busy) event.preventDefault()
      }}
    >
      {local.busy ? (local.busyLabel ?? SAVING) : local.children}
    </button>
  )
}
