/**
 * A kit form's submit button, which says the form is working while it sends.
 *
 * While `busy` it reads `busyLabel` ("Saving…" unless the form has its own verb, like "Adding…")
 * and is `aria-disabled`, not `disabled`: a disabled button loses focus, so a keyboard user who
 * pressed it would be dropped at the top of the page. It stays focusable, and a click on it while
 * it is busy does nothing. The form's own submit sends once anyway, however it is triggered.
 *
 * `unchanged` is the same for a form with nothing new to send, like a settings form that is saved:
 * the button says what its children say ("Saved"), is `aria-disabled`, and a click on it sends
 * nothing. The person who just saved keeps their place on the button.
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
  /** True while there is nothing new to send: the button is inactive but keeps focus. */
  unchanged?: boolean
  children: JSX.Element
}

export const SAVING = 'Saving…'

export default function SubmitButton(props: SubmitButtonProps): JSX.Element {
  const [local, button] = splitProps(props, ['busy', 'busyLabel', 'unchanged', 'children', 'class'])
  const inactive = () => local.busy || local.unchanged === true
  const classes = () =>
    [styles.submit, local.unchanged && !local.busy ? styles.unchanged : '', local.class]
      .filter(Boolean)
      .join(' ')
  return (
    <button
      {...button}
      type="submit"
      class={classes()}
      aria-disabled={inactive() ? 'true' : undefined}
      onClick={(event) => {
        if (inactive()) event.preventDefault()
      }}
    >
      {local.busy ? (local.busyLabel ?? SAVING) : local.children}
    </button>
  )
}
