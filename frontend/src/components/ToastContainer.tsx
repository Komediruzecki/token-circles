/**
 * Toast notification container — renders signal-driven toasts, top-right.
 *
 * Deliberately plain: the icon, the message, and a border tinted by severity are what carry
 * information. A `title` renders as a coloured prefix on the message (not a heading above it),
 * an `action` is one bordered button, and every toast can be dismissed by hand.
 */
import { For, Match, Show, Switch } from 'solid-js'
import { removeToast, toasts } from '../core/toastStore'
import styles from './Toast.module.css'
import type { Component } from 'solid-js'
import type { ToastItem } from '../core/toastStore'

const ToastIcon: Component<{ type: ToastItem['type'] }> = (props) => (
  <Switch>
    <Match when={props.type === 'success'}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
      </svg>
    </Match>
    <Match when={props.type === 'warning'}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10.3 4.2L2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
        <line x1="12" y1="9" x2="12" y2="13.5" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </Match>
    <Match when={props.type === 'error'}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    </Match>
    <Match when={props.type === 'info'}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    </Match>
  </Switch>
)

export default function ToastContainer() {
  return (
    <div class={styles.toastContainer} role="region" aria-label="Notifications">
      <For each={toasts()}>
        {(toast) => (
          <div
            class={`${styles.toast} ${styles[toast.type] || ''}`}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
          >
            <span class={styles.icon} aria-hidden="true">
              <ToastIcon type={toast.type} />
            </span>
            <span class={styles.body}>
              <Show when={toast.title}>
                <strong class={styles.title}>{toast.title}</strong>
              </Show>
              <span class={styles.text}>{toast.message}</span>
            </span>
            <Show when={toast.action}>
              {(action) => (
                <button
                  type="button"
                  class={styles.actionBtn}
                  onClick={() => {
                    action().onClick()
                    removeToast(toast.id)
                  }}
                >
                  {action().label}
                </button>
              )}
            </Show>
            <button
              type="button"
              class={styles.closeBtn}
              onClick={() => {
                removeToast(toast.id)
              }}
              aria-label="Dismiss notification"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  d="M6 6l12 12M18 6L6 18"
                />
              </svg>
            </button>
          </div>
        )}
      </For>
    </div>
  )
}
