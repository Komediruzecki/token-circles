import { createSignal, For, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import { showConfirm } from '../core/confirmStore'
import { passkeysSupported, registerPasskey } from '../core/webauthn'
import layoutStyles from './Layout.module.css'

/**
 * Settings card for passkeys: list, add, remove. Renders nothing on browsers without WebAuthn —
 * an option that cannot work is worse than an absent one.
 */
interface PasskeyRow {
  id: string
  name: string | null
  backed_up: number
  created_at: string
  last_used_at: string | null
}

export default function PasskeySettings() {
  const [passkeys, setPasskeys] = createSignal<PasskeyRow[] | null>(null)
  const [busy, setBusy] = createSignal(false)
  // Stale session: the server wants the password (or a 2FA code) before minting options.
  const [reauthNeeded, setReauthNeeded] = createSignal(false)
  const [reauthValue, setReauthValue] = createSignal('')

  if (!passkeysSupported()) return null

  const load = async () => {
    try {
      const res = await apiFetch('/api/auth/passkeys')
      if (res.ok) setPasskeys(((await res.json()) as { passkeys: PasskeyRow[] }).passkeys)
    } catch {
      // The card just stays in its loading-quiet state; adding still works and reloads the list.
    }
  }
  onMount(() => {
    void load()
  })

  const add = async (reauth?: string) => {
    setBusy(true)
    try {
      const result = await registerPasskey('This device', reauth ? { reauth } : undefined)
      if (result.ok) {
        toast('Passkey added — you can now sign in with it', 'success')
        setReauthNeeded(false)
        setReauthValue('')
        void load()
      } else if (result.reauth) {
        setReauthNeeded(true)
        // Only nag when a proof was actually offered and bounced.
        if (reauth) toast(result.error, 'error')
      } else if (!result.aborted) {
        toast(result.error, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: PasskeyRow) => {
    const confirmed = await showConfirm(
      `Remove "${row.name ?? 'Unnamed passkey'}"? It will no longer sign you in on that device.`,
      { confirmText: 'Remove', danger: true }
    )
    if (!confirmed) return
    try {
      const res = await apiFetch(`/api/auth/passkeys/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast('Could not remove the passkey', 'error')
        return
      }
      setPasskeys((list) => (list ?? []).filter((p) => p.id !== row.id))
    } catch {
      toast('Could not remove the passkey', 'error')
    }
  }

  return (
    <div style={{ 'margin-top': '16px' }}>
      <div style={{ 'font-weight': 600, 'font-size': '14px' }}>Passkeys</div>
      <p style={{ margin: '6px 0 10px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
        Sign in with your device's screen lock — no password, phishing-proof, and it counts as
        two-factor on its own.
      </p>
      <Show when={(passkeys() ?? []).length > 0}>
        <div
          style={{ display: 'flex', 'flex-direction': 'column', gap: '6px', margin: '0 0 10px' }}
        >
          <For each={passkeys() ?? []}>
            {(row) => (
              <div
                data-test-id="passkey-row"
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  'border-radius': '8px',
                  border: '1px solid var(--border, rgba(255,255,255,0.12))',
                  'font-size': '13px',
                }}
              >
                <span style={{ flex: 1 }}>
                  {row.name ?? 'Unnamed passkey'}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {row.backed_up ? ' · synced' : ' · this device only'}
                  </span>
                </span>
                <button
                  data-test-id="passkey-delete"
                  class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
                  onClick={() => void remove(row)}
                >
                  Remove
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <button
        data-test-id="passkey-add"
        class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
        disabled={busy()}
        onClick={() => void add()}
      >
        {busy() ? 'Waiting for the device…' : 'Add a passkey'}
      </button>
      <Show when={reauthNeeded()}>
        <div style={{ margin: '10px 0 0' }}>
          <p style={{ margin: '0 0 6px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
            It has been a while since you signed in — confirm your password (or a 2FA code) to add a
            passkey.
          </p>
          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            <input
              type="password"
              data-test-id="passkey-reauth-input"
              placeholder="Password or 2FA code"
              value={reauthValue()}
              onInput={(e) => setReauthValue(e.currentTarget.value)}
              autocomplete="current-password"
              style={{
                padding: '8px 10px',
                'border-radius': '8px',
                border: '1px solid var(--border, rgba(255,255,255,0.12))',
                background: 'var(--bg, #0b0e14)',
                color: 'var(--text, #e6e8eb)',
                'font-size': '14px',
                width: '200px',
              }}
            />
            <button
              data-test-id="passkey-reauth-confirm"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
              disabled={busy() || !reauthValue().trim()}
              onClick={() => void add(reauthValue().trim())}
            >
              Confirm
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
