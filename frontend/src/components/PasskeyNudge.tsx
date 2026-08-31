import { createSignal, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import { consumePasskeyNudge, passkeysSupported, registerPasskey } from '../core/webauthn'
import layoutStyles from './Layout.module.css'

/**
 * One-time offer after a fresh sign-in on a WebAuthn-capable device with no passkey yet:
 * "add one and skip the password next time". The flag is set just before the login reload
 * (markPasskeyNudgeAfterLogin) and consumed here exactly once, so the banner never nags —
 * dismissing it means not seeing it again until another sign-in.
 */
export default function PasskeyNudge() {
  const [visible, setVisible] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  onMount(() => {
    if (!consumePasskeyNudge() || !passkeysSupported()) return
    void (async () => {
      try {
        const res = await apiFetch('/api/auth/passkeys')
        if (!res.ok) return // local mode or signed out — nothing to offer
        const { passkeys } = (await res.json()) as { passkeys: unknown[] }
        if (passkeys.length === 0) setVisible(true)
      } catch {
        // Offline is no time to offer new sign-in methods.
      }
    })()
  })

  const add = async () => {
    setBusy(true)
    try {
      const result = await registerPasskey('This device')
      if (result.ok) {
        toast('Passkey added — next sign-in is one tap', 'success')
        setVisible(false)
      } else if (result.aborted) {
        setVisible(false)
      } else {
        toast(result.error, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={visible()}>
      <div
        data-test-id="passkey-nudge"
        style={{
          position: 'fixed',
          right: '16px',
          bottom: '16px',
          'z-index': 60,
          'max-width': '340px',
          padding: '14px 16px',
          'border-radius': '12px',
          background: 'var(--surface, #151a23)',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          'box-shadow': '0 8px 30px rgba(0,0,0,0.35)',
          'font-size': '13.5px',
        }}
      >
        <div style={{ 'font-weight': 600, margin: '0 0 4px' }}>Sign in faster next time</div>
        <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)' }}>
          This device supports passkeys — add one and your screen lock signs you in, no password.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            data-test-id="passkey-nudge-add"
            class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
            disabled={busy()}
            onClick={() => void add()}
          >
            {busy() ? 'Waiting…' : 'Add passkey'}
          </button>
          <button
            data-test-id="passkey-nudge-dismiss"
            class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
            onClick={() => setVisible(false)}
          >
            Not now
          </button>
        </div>
      </div>
    </Show>
  )
}
