import { createSignal, Show } from 'solid-js'
import styles from './ConfirmButton.module.css'
import type { JSX} from 'solid-js';

export interface ConfirmButtonProps {
  onConfirm: () => void | Promise<void>
  label?: JSX.Element
  confirmLabel?: string
  class?: string
}

export default function ConfirmButton(props: ConfirmButtonProps) {
  const [confirming, setConfirming] = createSignal(false)

  const handleConfirm = async () => {
    setConfirming(false)
    await props.onConfirm()
  }

  const handleCancel = () => setConfirming(false)

  return (
    <Show
      when={confirming()}
      fallback={
        <button
          class={props.class || styles.btn}
          onClick={() => setConfirming(true)}
          style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px' }}
        >
          {props.label || 'Delete'}
        </button>
      }
    >
      <span class={styles.wrapper}>
        <span class={styles.confirmLabel}>{props.confirmLabel || 'Confirm?'}</span>
        <button class={styles.btnYes} onClick={handleConfirm}>Yes</button>
        <button class={styles.btnNo} onClick={handleCancel}>No</button>
      </span>
    </Show>
  )
}
