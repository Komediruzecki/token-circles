/**
 * Shared confirm dialog store — signal-based, similar to toastStore.
 *
 * `showConfirm(message, options?)` renders a centered modal (see ConfirmDialog)
 * and resolves true/false. This is the single confirmation surface for the app;
 * destructive actions (delete/reset) pass `{ danger: true }` for a red confirm.
 *
 * Two modes:
 *
 * - Without `onConfirm`, the dialog closes the moment Confirm is clicked and the caller
 *   does its work unobserved. Fine for instant, local actions.
 * - With `onConfirm`, the dialog HOLDS: it runs the work, shows what is happening, and
 *   closes only once that work settles. This is what a slow connection needs — a bulk
 *   delete that closes instantly and then spends seconds on the network reads as "nothing
 *   happened", and a failure reported only to the console leaves rows on screen with no
 *   explanation (reported from production).
 */
import { createRoot, createSignal } from 'solid-js'

/** What the running work is doing right now, for the dialog to display. */
export interface ConfirmProgress {
  /** Human-readable phase, e.g. "Deleting 50 transactions…". */
  label: string
  /** Determinate count. Omit both to show an indeterminate spinner instead of a bar. */
  done?: number
  total?: number
}

/** Work run while the dialog stays open. Call `report` to update what the user sees. */
export type ConfirmWork = (report: (progress: ConfirmProgress) => void) => Promise<void>

export interface ConfirmOptions {
  /** Confirm-button text (default "Confirm"). */
  confirmText?: string
  /** Cancel-button text (default "Cancel"). */
  cancelText?: string
  /** Style the confirm button as destructive (red). */
  danger?: boolean
  /** See the module docs: supplying this keeps the dialog open until the work settles. */
  onConfirm?: ConfirmWork
}

export interface ConfirmRequest {
  id: number
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
  /** null for the plain close-on-confirm mode. */
  work: ConfirmWork | null
  /** True while `work` is running: the dialog is not dismissable and the buttons are held. */
  busy: boolean
  /** True once the work has been running long enough that it may never settle — see
   *  STALL_GRACE_MS. Re-opens the escape hatch that `busy` closes. */
  stalled: boolean
  progress: ConfirmProgress | null
  /** Set when `work` rejected — the dialog stays up and offers a retry. */
  error: string | null
  resolve: (value: boolean) => void
}

/**
 * How long the dialog holds before it offers a way out.
 *
 * Holding it shut is the whole point while a request is in flight — but a request that never
 * settles (a socket that neither responds nor errors, an IndexedDB open blocked by another
 * tab) would otherwise trap the user behind a full-screen overlay with Cancel disabled, no
 * Escape route and no timeout, recoverable only by reloading the page. After this long the
 * user gets an honest exit: the dialog closes, and the work is left to finish or not.
 */
const STALL_GRACE_MS = 10_000

let nextId = 0

const { confirmRequests, setConfirmRequests } = createRoot(() => {
  const [confirmRequests, setConfirmRequests] = createSignal<ConfirmRequest[]>([])
  return { confirmRequests, setConfirmRequests }
})

export { confirmRequests }

function patch(id: number, fields: Partial<ConfirmRequest>): void {
  setConfirmRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))
}

/** Settle and remove, ignoring the busy guard — the work itself finishes this way, and it
 *  is still busy at that moment. Only `resolveConfirm` is guarded. */
function finish(id: number, value: boolean): void {
  const req = confirmRequests().find((r) => r.id === id)
  if (!req) return
  req.resolve(value)
  setConfirmRequests((prev) => prev.filter((r) => r.id !== id))
}

export function showConfirm(message: string, options?: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = ++nextId
    setConfirmRequests((prev) => [
      ...prev,
      {
        id,
        message,
        confirmText: options?.confirmText ?? 'Confirm',
        cancelText: options?.cancelText ?? 'Cancel',
        danger: options?.danger ?? false,
        work: options?.onConfirm ?? null,
        busy: false,
        stalled: false,
        progress: null,
        error: null,
        resolve,
      },
    ])
  })
}

/**
 * The user accepted. With no work attached this is the old behaviour (close, resolve true).
 * With work, the dialog stays up until it settles: on success it closes and resolves true, on
 * failure it stays open carrying the message so the user learns the action did NOT happen.
 */
export async function acceptConfirm(id: number): Promise<void> {
  const req = confirmRequests().find((r) => r.id === id)
  if (!req || req.busy) return
  if (!req.work) {
    finish(id, true)
    return
  }
  patch(id, { busy: true, stalled: false, error: null })
  const stallTimer = setTimeout(() => {
    patch(id, { stalled: true })
  }, STALL_GRACE_MS)
  try {
    await req.work((progress) => {
      patch(id, { progress })
    })
    finish(id, true)
  } catch (err) {
    // An Error with an empty message would render as no banner at all and reset the button,
    // which reads as "nothing happened" — the exact failure this dialog exists to prevent.
    const message = err instanceof Error && err.message ? err.message : null
    patch(id, {
      busy: false,
      stalled: false,
      progress: null,
      error: message ?? 'Something went wrong. Please try again.',
    })
  } finally {
    clearTimeout(stallTimer)
  }
}

/** Dismiss the dialog with `value`. Ignored while work is running — that would resolve the
 *  caller's promise while its own work is still in flight — unless it has been running long
 *  enough to look stuck, at which point escaping beats being trapped. */
export function resolveConfirm(id: number, value: boolean): void {
  const req = confirmRequests().find((r) => r.id === id)
  if (!req || (req.busy && !req.stalled)) return
  finish(id, value)
}
