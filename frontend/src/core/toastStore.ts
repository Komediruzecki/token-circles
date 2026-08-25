/**
 * Shared toast store — signal-based, no DOM manipulation needed.
 *
 * Toasts are pushed from anywhere and rendered by ToastContainer. Use a `channel` for any toast
 * a flow can raise repeatedly (the app-update notice, save confirmations): showing a channelled
 * toast first evicts the previous one on that channel, so a category can never stack up the
 * screen. `action` puts one button in the toast for the rare message that asks for a decision
 * ("Reload"); clicking it always dismisses the toast as well.
 */
import { createRoot, createSignal } from 'solid-js'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  /**
   * Optional subject rendered as a coloured prefix ON the message — same size, same line, not a
   * heading. Omit it for nearly everything; set it only when the toast belongs to something the
   * reader recognises on sight ("Update"). A word derived from the type says nothing the icon
   * and colour do not already say.
   */
  title?: string
  /** Optional action button (e.g. "Reload") rendered in the toast. */
  action?: ToastAction
  /** See module docs — showing a toast on a channel evicts the previous one on that channel. */
  channel?: string
}

export type ToastOptions = Pick<ToastItem, 'title' | 'action' | 'channel'> & {
  /** Override how long the toast stays visible. Non-finite or non-positive values fall back
   *  to the type's default — there is deliberately no "sticky" toast. */
  durationMs?: number
}

/** Warnings and errors linger longer: important feedback should not be missable. */
const DEFAULT_DURATION_MS: Record<ToastItem['type'], number> = {
  info: 5000,
  success: 5000,
  warning: 8000,
  error: 10000,
}

/** A burst of toasts must never grow past the viewport: oldest are dropped, newest kept. */
const MAX_TOASTS = 4

let nextId = 0

const { toasts, setToasts } = createRoot(() => {
  const [toasts, setToasts] = createSignal<ToastItem[]>([])
  return { toasts, setToasts }
})

export { toasts }

/** Pending auto-dismiss timers, so eviction and manual dismissal cancel them. */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function addToast(
  message: string,
  type: ToastItem['type'] = 'info',
  opts?: ToastOptions
): void {
  const id = ++nextId
  if (opts?.channel) removeToastsByChannel(opts.channel)
  // Fields picked explicitly — a spread would smuggle durationMs onto the stored item, a
  // property the ToastItem type says cannot exist.
  const item: ToastItem = {
    id,
    message,
    type,
    title: opts?.title,
    action: opts?.action,
    channel: opts?.channel,
  }
  const dropped: ToastItem[] = []
  setToasts((prev) => {
    const next = [...prev, item]
    dropped.push(...next.slice(0, Math.max(0, next.length - MAX_TOASTS)))
    return next.slice(-MAX_TOASTS)
  })
  for (const toast of dropped) removeToast(toast.id)
  const requested = opts?.durationMs
  const duration =
    typeof requested === 'number' && Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_DURATION_MS[type]
  timers.set(
    id,
    setTimeout(() => {
      removeToast(id)
    }, duration)
  )
}

/** True while a toast on this channel is on screen — lets a caller re-announce only after
 *  its previous notice expired instead of restarting a visible one. */
export function hasToastOnChannel(channel: string): boolean {
  return toasts().some((t) => t.channel === channel)
}

/** Remove a toast immediately — the close button, or an action that was taken. */
export function removeToast(id: number): void {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
  setToasts((prev) => prev.filter((t) => t.id !== id))
}

/** Remove every toast on a channel — for a state that stood down before the user acted. */
export function removeToastsByChannel(channel: string): void {
  for (const t of toasts()) {
    if (t.channel === channel) removeToast(t.id)
  }
}
