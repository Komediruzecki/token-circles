/**
 * Shared confirm dialog store — signal-based, similar to toastStore.
 *
 * `showConfirm(message, options?)` renders a centered modal (see ConfirmDialog)
 * and resolves true/false. This is the single confirmation surface for the app;
 * destructive actions (delete/reset) pass `{ danger: true }` for a red confirm.
 */
import { createRoot, createSignal } from 'solid-js'

export interface ConfirmOptions {
  /** Confirm-button text (default "Confirm"). */
  confirmText?: string
  /** Cancel-button text (default "Cancel"). */
  cancelText?: string
  /** Style the confirm button as destructive (red). */
  danger?: boolean
}

export interface ConfirmRequest {
  id: number
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
  resolve: (value: boolean) => void
}

let nextId = 0

const { confirmRequests, setConfirmRequests } = createRoot(() => {
  const [confirmRequests, setConfirmRequests] = createSignal<ConfirmRequest[]>([])
  return { confirmRequests, setConfirmRequests }
})

export { confirmRequests }

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
        resolve,
      },
    ])
  })
}

export function resolveConfirm(id: number, value: boolean): void {
  const req = confirmRequests().find((r) => r.id === id)
  if (req) req.resolve(value)
  setConfirmRequests((prev) => prev.filter((r) => r.id !== id))
}
