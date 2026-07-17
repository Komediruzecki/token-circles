import { showConfirm } from '../core/confirmStore'
import styles from './ConfirmButton.module.css'
import type { JSX } from 'solid-js'

export interface ConfirmButtonProps {
  onConfirm: () => void | Promise<void>
  /** Trigger content (an icon or short text). Defaults to "Delete". */
  label?: JSX.Element
  /** Question shown in the confirm modal. */
  message?: string
  /** Confirm-button text in the modal (default "Delete"). */
  confirmText?: string
  /** Style the modal's confirm as destructive (red). Default true. */
  danger?: boolean
  class?: string
  'data-test-id'?: string
  'aria-label'?: string
}

/**
 * A trigger that asks for confirmation via the shared centered modal
 * (ConfirmDialog) before running `onConfirm`. Replaces the old inline
 * Confirm?/Yes/No affordance, which overflowed narrow cards; the trigger
 * button itself is unchanged, so call sites keep their look.
 */
export default function ConfirmButton(props: ConfirmButtonProps) {
  const handleClick = async () => {
    const ok = await showConfirm(props.message ?? 'Are you sure? This can’t be undone.', {
      confirmText: props.confirmText ?? 'Delete',
      danger: props.danger ?? true,
    })
    if (ok) await props.onConfirm()
  }

  return (
    <button
      class={props.class || styles.btn}
      onClick={() => void handleClick()}
      data-test-id={props['data-test-id']}
      aria-label={props['aria-label']}
      style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px' }}
    >
      {props.label || 'Delete'}
    </button>
  )
}
