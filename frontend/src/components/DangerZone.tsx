import { createSignal, Show } from 'solid-js'
import { apiFetch } from '../core/apiFetch'
import styles from './DangerZone.module.css'

export interface DangerZoneProps {
  onReset: () => Promise<void>
  onDeleteProfile: () => Promise<void>
}

type ConfirmAction = 'reset' | 'transactions' | 'categories' | 'profile' | 'profile-delete' | null

export default function DangerZone(props: DangerZoneProps) {
  const [confirming, setConfirming] = createSignal<ConfirmAction>(null)
  const [loading, setLoading] = createSignal(false)

  const executeDelete = async (endpoint: string, successMsg: string) => {
    setLoading(true)
    try {
      const res = await apiFetch(endpoint, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) throw new Error('Operation failed')
      alert(successMsg)
      window.location.reload()
    } catch {
      alert('Failed to complete the operation')
    } finally {
      setLoading(false)
      setConfirming(null)
    }
  }

  const handleReset = async () => {
    setConfirming(null)
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

      {/* Delete All Transactions */}
      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Delete All Transactions</div>
          <div class={styles['danger-zone-item-desc']}>
            Permanently delete all transactions for the current profile. Budgets, categories, and
            accounts will be preserved.
          </div>
        </div>
        <Show when={confirming() !== 'transactions'}>
          <button
            class={styles['danger-zone-button']}
            onClick={() => setConfirming('transactions')}
            disabled={loading()}
          >
            Delete Transactions
          </button>
        </Show>
      </div>

      <Show when={confirming() === 'transactions'}>
        <div class={styles['danger-zone-item']}>
          <div>
            <div class={styles['danger-zone-item-title']}>Delete all transactions?</div>
            <div class={styles['danger-zone-item-desc']}>
              This will permanently remove every transaction. This cannot be undone.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              class={styles['danger-zone-button']}
              onClick={() => executeDelete('/api/transactions', 'All transactions deleted')}
              disabled={loading()}
            >
              {loading() ? 'Deleting...' : 'Yes, Delete Transactions'}
            </button>
          </div>
        </div>
      </Show>

      {/* Delete All Categories */}
      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Delete All Categories</div>
          <div class={styles['danger-zone-item-desc']}>
            Delete all custom categories and restore default categories. Transactions will be
            preserved.
          </div>
        </div>
        <Show when={confirming() !== 'categories'}>
          <button
            class={styles['danger-zone-button']}
            onClick={() => setConfirming('categories')}
            disabled={loading()}
          >
            Delete Categories
          </button>
        </Show>
      </div>

      <Show when={confirming() === 'categories'}>
        <div class={styles['danger-zone-item']}>
          <div>
            <div class={styles['danger-zone-item-title']}>Delete all categories?</div>
            <div class={styles['danger-zone-item-desc']}>
              This will replace all categories with defaults. Custom categories will be lost.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              class={styles['danger-zone-button']}
              onClick={() => executeDelete('/api/categories', 'Categories reset to defaults')}
              disabled={loading()}
            >
              {loading() ? 'Deleting...' : 'Yes, Reset Categories'}
            </button>
          </div>
        </div>
      </Show>

      {/* Delete Profile Data */}
      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Clear Profile Data</div>
          <div class={styles['danger-zone-item-desc']}>
            Delete all transactions, budgets, loans, and categories for this profile. The profile
            itself will be kept.
          </div>
        </div>
        <Show when={confirming() !== 'profile'}>
          <button
            class={styles['danger-zone-button']}
            onClick={() => setConfirming('profile')}
            disabled={loading()}
          >
            Clear Profile Data
          </button>
        </Show>
      </div>

      <Show when={confirming() === 'profile'}>
        <div class={styles['danger-zone-item']}>
          <div>
            <div class={styles['danger-zone-item-title']}>Clear all profile data?</div>
            <div class={styles['danger-zone-item-desc']}>
              This will delete all data for this profile while keeping the profile itself. Cannot be
              undone.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              class={styles['danger-zone-button']}
              onClick={() => executeDelete('/api/profile/data', 'Profile data cleared')}
              disabled={loading()}
            >
              {loading() ? 'Clearing...' : 'Yes, Clear Profile Data'}
            </button>
          </div>
        </div>
      </Show>

      {/* Delete Current Profile */}
      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Delete Current Profile</div>
          <div class={styles['danger-zone-item-desc']}>
            Permanently delete the current profile and all its data. You will be switched to another
            profile if one exists. The default profile cannot be deleted.
          </div>
        </div>
        <Show when={confirming() !== 'profile-delete'}>
          <button
            class={styles['danger-zone-button']}
            onClick={() => setConfirming('profile-delete')}
            disabled={loading()}
          >
            Delete Profile
          </button>
        </Show>
      </div>

      <Show when={confirming() === 'profile-delete'}>
        <div class={styles['danger-zone-item']}>
          <div>
            <div class={styles['danger-zone-item-title']}>Delete this profile?</div>
            <div class={styles['danger-zone-item-desc']}>
              This will permanently delete the current profile and all its data. This cannot be
              undone.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              class={styles['danger-zone-button']}
              onClick={() => {
                setConfirming(null)
                void props.onDeleteProfile()
              }}
              disabled={loading()}
            >
              {loading() ? 'Deleting...' : 'Yes, Delete Profile'}
            </button>
          </div>
        </div>
      </Show>

      {/* Reset All Data */}
      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Reset All Data</div>
          <div class={styles['danger-zone-item-desc']}>
            Permanently delete all transactions, budgets, goals, loans, bills, housing expenses, and
            accounts. This action cannot be undone.
          </div>
        </div>
        <Show when={confirming() !== 'reset'}>
          <button class={styles['danger-zone-button']} onClick={() => setConfirming('reset')}>
            Reset All Data
          </button>
        </Show>
      </div>

      <Show when={confirming() === 'reset'}>
        <div class={styles['danger-zone-item']}>
          <div>
            <div class={styles['danger-zone-item-title']}>Are you absolutely sure?</div>
            <div class={styles['danger-zone-item-desc']}>
              This will permanently erase everything. There is no recovery.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button class={styles['danger-zone-button']} onClick={handleReset}>
              Yes, Delete Everything
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
