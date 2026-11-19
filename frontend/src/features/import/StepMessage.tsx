/**
 * What the import flow has to say, on the step it is about (maff, 19 Nov): its error under the form
 * or the buttons that raised it, or its short notice ("Preview recalculated from your rules.").
 * Both sat in one banner at the top of the page, where after an import the balances and the
 * subscription offer stood between it and the form, and on a phone it was a screen away.
 *
 * One is drawn per step: each tab of the upload step under its own form, Map columns under its
 * source, the preview and the bank summary under their buttons.
 */
import { Show } from 'solid-js'
import styles from '../Import.module.css'
import type { ImportFlow } from './importFlow'

export function StepMessage(props: { flow: Pick<ImportFlow, 'error' | 'resultMessage'> }) {
  return (
    <Show
      when={props.flow.error()}
      fallback={
        <Show when={props.flow.resultMessage()}>
          {(notice) => (
            <p
              class={`${styles.resultMessage} ${styles.success} ${styles.stepMessage}`}
              role="status"
              data-test-id="import-notice"
            >
              {notice().text}
            </p>
          )}
        </Show>
      }
    >
      {(message) => (
        <p
          class={`${styles.resultMessage} ${styles.error} ${styles.stepMessage}`}
          role="alert"
          data-test-id="import-error"
        >
          {message()}
        </p>
      )}
    </Show>
  )
}
