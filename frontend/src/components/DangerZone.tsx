import { createSignal, For, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import styles from './DangerZone.module.css'

export interface DangerZoneProps {
  onReset: () => Promise<void>
  onDeleteProfile: (profileId: string | number) => Promise<void>
}

type ConfirmAction =
  | 'reset'
  | 'transactions'
  | 'categories'
  | 'profile'
  | 'profile-delete'
  | 'reseed-demo'
  | null

export default function DangerZone(props: DangerZoneProps) {
  const [confirming, setConfirming] = createSignal<ConfirmAction>(null)
  const [loading, setLoading] = createSignal(false)
  const [profiles, setProfiles] = createSignal<Array<{ id: number; name: string }>>([])
  const [selectedProfileId, setSelectedProfileId] = createSignal<number>(
    parseInt(localStorage.getItem('currentProfileId') || '1', 10)
  )

  const loadProfiles = async () => {
    try {
      const res = await apiFetch('/api/profiles', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setProfiles(data)
        const stored = parseInt(localStorage.getItem('currentProfileId') || '1', 10)
        if (data.length > 0 && !data.some((p: any) => p.id === stored)) {
          setSelectedProfileId(data[0].id)
        } else {
          setSelectedProfileId(stored)
        }
      }
    } catch {
      /* non-critical */
    }
  }

  onMount(() => {
    void loadProfiles()
  })

  const selectedProfileName = () => {
    const p = profiles().find((prof) => prof.id === selectedProfileId())
    return p ? p.name : 'Selected Profile'
  }

  const isDeleteProfileDisabled = () => {
    return selectedProfileId() === 1 || profiles().length <= 1
  }

  const executeDelete = async (endpoint: string, successMsg: string) => {
    setLoading(true)
    try {
      const res = await apiFetch(endpoint, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-Profile-Id': selectedProfileId().toString(),
        },
      })
      if (!res.ok) throw new Error('Operation failed')
      toast(successMsg, 'success')
      window.location.reload()
    } catch {
      toast('Failed to complete the operation', 'error')
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

      {/* Target Profile Selector */}
      <div class={styles['danger-zone-selector-card']}>
        <div class={styles['danger-zone-selector-header']}>
          <label class={styles['danger-zone-selector-label']} for="danger-profile-select">
            Target Profile for Destructive Actions:
          </label>
        </div>
        <div class={styles['select-wrapper']}>
          <select
            id="danger-profile-select"
            class={styles['profile-select']}
            value={selectedProfileId()}
            onchange={(e) => setSelectedProfileId(parseInt(e.currentTarget.value, 10))}
          >
            <For each={profiles()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </select>
        </div>
        <p class={styles['danger-zone-selector-hint']}>
          Profile-specific actions below will only target the profile selected here.
        </p>
      </div>

      <div class={styles['danger-zone-items']}>
        {/* Delete All Transactions */}
        <div class={styles['danger-zone-item']}>
          <Show
            when={confirming() !== 'transactions'}
            fallback={
              <div class={styles['danger-confirm-box']}>
                <div class={styles['danger-confirm-info']}>
                  <div class={styles['danger-confirm-title']}>
                    Delete all transactions for "{selectedProfileName()}"?
                  </div>
                  <div class={styles['danger-confirm-desc']}>
                    This will permanently remove every transaction. This cannot be undone.
                  </div>
                </div>
                <div class={styles['danger-confirm-actions']}>
                  <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    class={styles['danger-zone-confirm-button']}
                    onClick={() => executeDelete('/api/transactions', 'All transactions deleted')}
                    disabled={loading()}
                  >
                    {loading() ? 'Deleting...' : 'Yes, Delete Transactions'}
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles['danger-zone-item-content']}>
              <div class={styles['danger-zone-item-title']}>Delete All Transactions</div>
              <div class={styles['danger-zone-item-desc']}>
                Permanently delete all transactions for the profile{' '}
                <strong>{selectedProfileName()}</strong>. Budgets, categories, and accounts will be
                preserved.
              </div>
            </div>
            <button
              class={styles['danger-zone-button']}
              onClick={() => setConfirming('transactions')}
              disabled={loading()}
            >
              Delete Transactions
            </button>
          </Show>
        </div>

        {/* Delete All Categories */}
        <div class={styles['danger-zone-item']}>
          <Show
            when={confirming() !== 'categories'}
            fallback={
              <div class={styles['danger-confirm-box']}>
                <div class={styles['danger-confirm-info']}>
                  <div class={styles['danger-confirm-title']}>
                    Delete all categories for "{selectedProfileName()}"?
                  </div>
                  <div class={styles['danger-confirm-desc']}>
                    This will replace all categories with defaults. Custom categories will be lost.
                  </div>
                </div>
                <div class={styles['danger-confirm-actions']}>
                  <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    class={styles['danger-zone-confirm-button']}
                    onClick={() => executeDelete('/api/categories', 'Categories reset to defaults')}
                    disabled={loading()}
                  >
                    {loading() ? 'Deleting...' : 'Yes, Reset Categories'}
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles['danger-zone-item-content']}>
              <div class={styles['danger-zone-item-title']}>Delete All Categories</div>
              <div class={styles['danger-zone-item-desc']}>
                Delete all custom categories and restore default categories for the profile{' '}
                <strong>{selectedProfileName()}</strong>. Transactions will be preserved.
              </div>
            </div>
            <button
              class={styles['danger-zone-button']}
              onClick={() => setConfirming('categories')}
              disabled={loading()}
            >
              Delete Categories
            </button>
          </Show>
        </div>

        {/* Clear Profile Data */}
        <div class={styles['danger-zone-item']}>
          <Show
            when={confirming() !== 'profile'}
            fallback={
              <div class={styles['danger-confirm-box']}>
                <div class={styles['danger-confirm-info']}>
                  <div class={styles['danger-confirm-title']}>
                    Clear all data for "{selectedProfileName()}"?
                  </div>
                  <div class={styles['danger-confirm-desc']}>
                    This will delete all transactions, budgets, categories, and accounts for this
                    profile. This cannot be undone.
                  </div>
                </div>
                <div class={styles['danger-confirm-actions']}>
                  <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    class={styles['danger-zone-confirm-button']}
                    onClick={() => executeDelete('/api/profile/data', 'Profile data cleared')}
                    disabled={loading()}
                  >
                    {loading() ? 'Clearing...' : 'Yes, Clear Profile Data'}
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles['danger-zone-item-content']}>
              <div class={styles['danger-zone-item-title']}>Clear Profile Data</div>
              <div class={styles['danger-zone-item-desc']}>
                Delete all transactions, budgets, loans, and categories for the profile{' '}
                <strong>{selectedProfileName()}</strong>. The profile itself will be kept.
              </div>
            </div>
            <button
              class={styles['danger-zone-button']}
              onClick={() => setConfirming('profile')}
              disabled={loading()}
            >
              Clear Profile Data
            </button>
          </Show>
        </div>

        {/* Delete Target Profile */}
        <div class={styles['danger-zone-item']}>
          <Show
            when={confirming() !== 'profile-delete'}
            fallback={
              <div class={styles['danger-confirm-box']}>
                <div class={styles['danger-confirm-info']}>
                  <div class={styles['danger-confirm-title']}>
                    Delete profile "{selectedProfileName()}"?
                  </div>
                  <div class={styles['danger-confirm-desc']}>
                    This will permanently delete the profile and all of its associated transactions,
                    accounts, and settings. This action is absolute and cannot be undone.
                  </div>
                </div>
                <div class={styles['danger-confirm-actions']}>
                  <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    class={styles['danger-zone-confirm-button']}
                    onClick={async () => {
                      setConfirming(null)
                      void props.onDeleteProfile(selectedProfileId())
                    }}
                    disabled={loading()}
                  >
                    {loading() ? 'Deleting...' : 'Yes, Delete Profile'}
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles['danger-zone-item-content']}>
              <div class={styles['danger-zone-item-title']}>Delete Profile</div>
              <div class={styles['danger-zone-item-desc']}>
                Permanently delete the profile <strong>{selectedProfileName()}</strong> and all its
                data. You will be switched to another profile if one exists.
                <Show when={isDeleteProfileDisabled()}>
                  <span class={styles['danger-zone-note']}>
                    {' '}
                    {selectedProfileId() === 1
                      ? '(The default profile cannot be deleted)'
                      : '(Cannot delete the last remaining profile)'}
                  </span>
                </Show>
              </div>
            </div>
            <button
              class={styles['danger-zone-button']}
              onClick={() => setConfirming('profile-delete')}
              disabled={loading() || isDeleteProfileDisabled()}
            >
              Delete Profile
            </button>
          </Show>
        </div>

        {/* Reseed Demo Data */}
        <div class={styles['danger-zone-item']}>
          <Show
            when={confirming() !== 'reseed-demo'}
            fallback={
              <div class={styles['danger-confirm-box']}>
                <div class={styles['danger-confirm-info']}>
                  <div class={styles['danger-confirm-title']}>Reseed demo data?</div>
                  <div class={styles['danger-confirm-desc']}>
                    This will delete all current data and restore the three example profiles. This
                    cannot be undone.
                  </div>
                </div>
                <div class={styles['danger-confirm-actions']}>
                  <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    class={styles['danger-zone-confirm-button']}
                    onClick={async () => {
                      setLoading(true)
                      try {
                        const res = await apiFetch('/api/profiles/reseed-demo', {
                          method: 'POST',
                          credentials: 'include',
                          headers: {
                            'X-Profile-Id': selectedProfileId().toString(),
                          },
                        })
                        if (!res.ok) throw new Error('Reseed failed')
                        toast('Demo data has been restored', 'success')
                        window.location.reload()
                      } catch {
                        toast('Failed to reseed demo data', 'error')
                      } finally {
                        setLoading(false)
                        setConfirming(null)
                      }
                    }}
                    disabled={loading()}
                  >
                    {loading() ? 'Reseeding...' : 'Yes, Reseed Demo Data'}
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles['danger-zone-item-content']}>
              <div class={styles['danger-zone-item-title']}>Reseed Demo Data</div>
              <div class={styles['danger-zone-item-desc']}>
                Delete all data and restore the three example profiles (Low/Mid/High Income) with
                sample transactions. All your current data will be lost.
              </div>
            </div>
            <button
              class={styles['danger-zone-button']}
              onClick={() => setConfirming('reseed-demo')}
              disabled={loading()}
            >
              Reseed Demo Data
            </button>
          </Show>
        </div>

        {/* Reset All Data */}
        <div class={styles['danger-zone-item']}>
          <Show
            when={confirming() !== 'reset'}
            fallback={
              <div class={styles['danger-confirm-box']}>
                <div class={styles['danger-confirm-info']}>
                  <div class={styles['danger-confirm-title']}>Are you absolutely sure?</div>
                  <div class={styles['danger-confirm-desc']}>
                    This will permanently erase everything across all profiles. There is no
                    recovery.
                  </div>
                </div>
                <div class={styles['danger-confirm-actions']}>
                  <button class={styles['danger-zone-cancel']} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    class={styles['danger-zone-confirm-button']}
                    onClick={handleReset}
                    disabled={loading()}
                  >
                    Yes, Delete Everything
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles['danger-zone-item-content']}>
              <div class={styles['danger-zone-item-title']}>Reset All Data</div>
              <div class={styles['danger-zone-item-desc']}>
                Permanently delete all transactions, budgets, goals, loans, bills, housing expenses,
                and accounts across all profiles. This action cannot be undone.
              </div>
            </div>
            <button
              class={styles['danger-zone-button']}
              onClick={() => setConfirming('reset')}
              disabled={loading()}
            >
              Reset All Data
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}
