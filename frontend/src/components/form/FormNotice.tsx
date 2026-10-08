/**
 * The form-level message: what belongs to no field. Offline, a server that is down, a field the
 * server named that this form does not show.
 *
 * The `role="alert"` region is always in the page and only its content comes and goes, because a
 * live region that appears together with its text is not reliably announced.
 */
import { Show } from 'solid-js'
import ErrorGlyph from './ErrorGlyph'
import styles from './Form.module.css'
import type { JSX } from 'solid-js'
import type { Form, FormValues } from './createForm'

export interface FormNoticeProps<T extends FormValues> {
  form: Form<T>
  class?: string
  testId?: string
}

export default function FormNotice<T extends FormValues>(props: FormNoticeProps<T>): JSX.Element {
  return (
    <div role="alert" data-test-id={props.testId ?? 'form-notice'}>
      <Show when={props.form.notice()}>
        {(text) => (
          <p class={props.class ? `${styles.notice} ${props.class}` : styles.notice}>
            <ErrorGlyph />
            <span>{text()}</span>
          </p>
        )}
      </Show>
    </div>
  )
}
