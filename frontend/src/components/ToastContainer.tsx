/**
 * Toast notification container — renders signal-driven toasts
 */
import { For } from 'solid-js'
import { toasts } from '../core/toastStore'
import styles from './Toast.module.css'

export default function ToastContainer() {
  return (
    <div class={styles.toastContainer}>
      <For each={toasts()}>
        {(toast) => (
          <div class={`${styles.toast} ${styles[toast.type] || ''}`}>{toast.message}</div>
        )}
      </For>
    </div>
  )
}
