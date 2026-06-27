import { createSignal, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import styles from './DangerZone.module.css'

/**
 * Account-level Danger Zone (Settings → Billing). Permanently deletes the signed-in user's
 * account and ALL of its data across every profile, and cancels the subscription. Distinct from
 * the profile-level DangerZone (reset / delete a single profile).
 *
 * The worker (DELETE /api/account) requires the user to type their email (or the word "delete"),
 * does the cascade + R2 cleanup + best-effort Stripe cancel, and clears the session cookie — so on
 * success we just drop local profile selection and reload to the sign-in screen.
 */
export default function AccountDeletion() {
  const [confirming, setConfirming] = createSignal(false)
  const [confirmText, setConfirmText] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  const cancel = () => {
    setConfirming(false)
    setConfirmText('')
  }

  const handleDelete = async () => {
    const confirm = confirmText().trim()
    if (!confirm) return
    setLoading(true)
    try {
      const res = await apiFetch('/api/account', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast(data.error || 'Could not delete your account', 'error')
        return
      }
      // Account + session are gone server-side; clear local selection and reload into sign-in.
      try {
        localStorage.removeItem('currentProfileId')
        localStorage.removeItem('selectedProfileIds')
      } catch {
        /* ignore */
      }
      toast('Your account has been deleted', 'success')
      window.location.href = '/'
    } catch {
      toast('Could not delete your account', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class={styles['danger-zone']}>
      <div class={styles['danger-zone-title']}>
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        Delete account
      </div>

      <div class={styles['danger-zone-item']}>
        <div>
          <div class={styles['danger-zone-item-title']}>Delete your account</div>
          <div class={styles['danger-zone-item-desc']}>
            Permanently deletes your account and every profile's data — transactions, accounts,
            budgets, bills, goals, receipts, everything — and cancels your subscription. This cannot
            be undone.
          </div>
        </div>
        <Show when={!confirming()}>
          <button
            class={styles['danger-zone-button']}
            onClick={() => setConfirming(true)}
            disabled={loading()}
          >
            Delete account
          </button>
        </Show>
      </div>

      <Show when={confirming()}>
        <div class={styles['danger-zone-item']}>
          <div style="flex: 1;">
            <div class={styles['danger-zone-item-title']}>Are you absolutely sure?</div>
            <div class={styles['danger-zone-item-desc']}>
              Type your account email (or the word <strong>delete</strong>) to confirm.
            </div>
            <input
              type="text"
              value={confirmText()}
              onInput={(e) => setConfirmText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleDelete()
                if (e.key === 'Escape') cancel()
              }}
              placeholder="you@example.com"
              autocomplete="off"
              style="margin-top: 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); box-sizing: border-box;"
            />
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <button
                onClick={cancel}
                disabled={loading()}
                style="padding: 8px 14px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text); cursor: pointer;"
              >
                Cancel
              </button>
              <button
                class={styles['danger-zone-button']}
                onClick={() => void handleDelete()}
                disabled={loading() || !confirmText().trim()}
              >
                {loading() ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
