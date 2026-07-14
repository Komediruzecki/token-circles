import { createSignal } from 'solid-js'

// Global toggle for the Keyboard Shortcuts help modal. Opened by the "?" key
// (App.tsx) and from Settings → About — both drive this single instance.
export const [showShortcuts, setShowShortcuts] = createSignal(false)
