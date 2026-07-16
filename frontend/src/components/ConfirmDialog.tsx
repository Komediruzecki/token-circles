import { For } from 'solid-js'
import { confirmRequests, resolveConfirm } from '../core/confirmStore'
import styles from './ConfirmDialog.module.css'

export default function ConfirmDialog() {
  return (
    <For each={confirmRequests()}>
      {(req) => (
        <div
          class={styles.overlay}
          onClick={() => {
            resolveConfirm(req.id, false)
          }}
        >
          <div
            class={styles.dialog}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <p class={styles.message}>{req.message}</p>
            <div class={styles.actions}>
              <button
                class={styles.btnCancel}
                data-test-id="confirm-cancel"
                onClick={() => {
                  resolveConfirm(req.id, false)
                }}
              >
                Cancel
              </button>
              <button
                class={styles.btnConfirm}
                data-test-id="confirm-accept"
                onClick={() => {
                  resolveConfirm(req.id, true)
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </For>
  )
}
