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
            role="alertdialog"
            aria-modal="true"
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
                {req.cancelText}
              </button>
              <button
                class={`${styles.btnConfirm} ${req.danger ? styles.btnDanger : ''}`}
                data-test-id="confirm-accept"
                onClick={() => {
                  resolveConfirm(req.id, true)
                }}
              >
                {req.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </For>
  )
}
