import { createSignal, Show } from 'solid-js'
import styles from './DangerZone.module.css'

export interface DangerZoneProps {
  onReset: () => Promise<void>
}

export default function DangerZone(props: DangerZoneProps) {
  const [confirming, setConfirming] = createSignal(false)

  const handleConfirm = async () => {
    setConfirming(false)
    await props.onReset()
  }

  return (
    <div class={styles['danger-zone']}>
      <div class={styles['danger-zone-title']}>
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        Danger Zone
      </div>

      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Reset All Data</div>
          <div class={styles['danger-zone-item-desc']}>
            Permanently delete all transactions, budgets, goals, loans, bills, housing expenses, and
            accounts. This action cannot be undone.
          </div>
        </div>
        <Show when={!confirming()}>
          <button class={styles['danger-zone-button']} onClick={() => setConfirming(true)}>
            Reset All Data
          </button>
        </Show>
      </div>

      <Show when={confirming()}>
        <div class={styles['danger-zone-item']}>
          <div>
            <div class={styles['danger-zone-item-title']}>Are you absolutely sure?</div>
            <div class={styles['danger-zone-item-desc']}>
              This will permanently erase everything. There is no recovery.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button class={styles['danger-zone-button']} onClick={handleConfirm}>
              Yes, Delete Everything
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
