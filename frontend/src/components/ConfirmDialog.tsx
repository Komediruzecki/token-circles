import { Index, Show } from 'solid-js'
import { acceptConfirm, confirmRequests, resolveConfirm } from '../core/confirmStore'
import styles from './ConfirmDialog.module.css'
import { OrbitSpinner } from './OrbitSpinner'

export default function ConfirmDialog() {
  // Index, not For: a progress report replaces the request object, and For is keyed by
  // reference — it would tear down and rebuild the dialog on every tick, restarting the
  // spinner. Index keys by position, so the open dialog survives its own updates.
  return (
    <Index each={confirmRequests()}>
      {(req) => {
        const progress = () => req().progress
        const percent = () => {
          const p = progress()
          if (!p || p.done === undefined || p.total === undefined || p.total <= 0) return null
          return Math.min(100, Math.max(0, Math.round((p.done / p.total) * 100)))
        }
        const busyLabel = () => progress()?.label ?? 'Working…'
        return (
          <div
            class={styles.overlay}
            onClick={() => {
              resolveConfirm(req().id, false)
            }}
          >
            <div
              class={styles.dialog}
              role="alertdialog"
              aria-modal="true"
              aria-busy={req().busy}
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <p class={styles.message}>{req().message}</p>

              <Show when={req().busy}>
                <div class={styles.progress} data-test-id="confirm-progress">
                  {/* OrbitSpinner renders `label` as visible text itself — a second copy here
                      would show the phase twice. */}
                  <OrbitSpinner size={36} label={busyLabel()} />
                  <Show when={percent() !== null}>
                    <div
                      class={styles.barTrack}
                      role="progressbar"
                      aria-label={busyLabel()}
                      aria-valuenow={percent() ?? 0}
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      <div class={styles.barFill} style={{ width: `${percent() ?? 0}%` }} />
                    </div>
                  </Show>
                  <Show when={req().stalled}>
                    <p class={styles.progressLabel} data-test-id="confirm-stalled">
                      This is taking longer than usual. You can close this — the action may still
                      finish on its own.
                    </p>
                  </Show>
                </div>
              </Show>

              <Show when={req().error}>
                <p class={styles.error} data-test-id="confirm-error" role="alert">
                  {req().error}
                </p>
              </Show>

              <div class={styles.actions}>
                <button
                  class={styles.btnCancel}
                  data-test-id="confirm-cancel"
                  disabled={req().busy && !req().stalled}
                  onClick={() => {
                    resolveConfirm(req().id, false)
                  }}
                >
                  {req().error || req().stalled ? 'Close' : req().cancelText}
                </button>
                <button
                  class={`${styles.btnConfirm} ${req().danger ? styles.btnDanger : ''}`}
                  data-test-id="confirm-accept"
                  disabled={req().busy}
                  onClick={() => {
                    void acceptConfirm(req().id)
                  }}
                >
                  {req().busy ? 'Working…' : req().error ? 'Try again' : req().confirmText}
                </button>
              </div>
            </div>
          </div>
        )
      }}
    </Index>
  )
}
