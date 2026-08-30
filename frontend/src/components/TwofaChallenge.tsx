import { createSignal, Show } from 'solid-js'
import { apiFetch } from '../core/apiFetch'
import layoutStyles from './Layout.module.css'

/**
 * The second sign-in step for accounts with 2FA. The password (or Google) step already parked a
 * short-lived challenge cookie; posting a valid authenticator or recovery code trades it for the
 * real session, then a reload lets the app re-check /auth/me exactly like every other login path.
 */
export default function TwofaChallenge(props: { onBack?: () => void }) {
  const [mode, setMode] = createSignal<'totp' | 'recovery'>('totp')
  const [code, setCode] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    const value = code().trim()
    if (!value) {
      setError(mode() === 'totp' ? 'Enter the 6-digit code' : 'Enter a recovery code')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      })
      if (res.ok) {
        // Drop the ?twofa=1 marker the Google callback appends, so a later visit to the saved
        // URL doesn't open the code screen for a session that no longer has a challenge.
        try {
          const url = new URL(window.location.href)
          if (url.searchParams.has('twofa')) {
            url.searchParams.delete('twofa')
            window.history.replaceState(null, '', url.toString())
          }
        } catch {
          // Nothing to clean when the URL isn't available (tests stub location).
        }
        window.location.reload()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error || 'That code did not match — try again')
      setLoading(false)
    } catch {
      setError('Network problem — try again')
      setLoading(false)
    }
  }

  const switchMode = (next: 'totp' | 'recovery') => {
    setMode(next)
    setCode('')
    setError('')
  }

  return (
    <form onSubmit={submit}>
      <p
        style={{
          margin: '0 0 14px',
          color: 'var(--text-secondary)',
          'font-size': '13.5px',
          'text-align': 'left',
        }}
      >
        {mode() === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of the recovery codes you saved when enabling two-factor authentication. Each works once.'}
      </p>
      <input
        type="text"
        data-test-id="twofa-code"
        placeholder={mode() === 'totp' ? '123456' : 'XXXXX-XXXXX'}
        value={code()}
        onInput={(e) => setCode(e.currentTarget.value)}
        autocomplete="one-time-code"
        inputmode={mode() === 'totp' ? 'numeric' : 'text'}
        maxlength={mode() === 'totp' ? 6 : 12}
        autofocus
        style={{
          width: '100%',
          padding: '10px 12px',
          'margin-bottom': '10px',
          'border-radius': '8px',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          background: 'var(--bg, #0b0e14)',
          color: 'var(--text, #e6e8eb)',
          'font-size': '16px',
          'letter-spacing': mode() === 'totp' ? '4px' : 'normal',
          'text-align': 'center',
          'box-sizing': 'border-box' as const,
        }}
      />
      <Show when={error()}>
        <div
          data-test-id="twofa-error"
          style={{ color: 'var(--danger, #ef4444)', 'font-size': '13px', margin: '2px 0 10px' }}
        >
          {error()}
        </div>
      </Show>
      <button
        type="submit"
        data-test-id="twofa-submit"
        class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
        style={{ width: '100%', 'justify-content': 'center' }}
        disabled={loading()}
      >
        {loading() ? 'Checking…' : 'Verify'}
      </button>
      <p style={{ margin: '12px 0 0', 'font-size': '13px', color: 'var(--text-secondary)' }}>
        <Show
          when={mode() === 'totp'}
          fallback={
            <a
              data-test-id="twofa-use-totp"
              onClick={() => {
                switchMode('totp')
              }}
              style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
            >
              Use an authenticator code instead
            </a>
          }
        >
          <a
            data-test-id="twofa-use-recovery"
            onClick={() => {
              switchMode('recovery')
            }}
            style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
          >
            Lost your device? Use a recovery code
          </a>
        </Show>
      </p>
      <Show when={props.onBack}>
        <p style={{ margin: '8px 0 0', 'font-size': '13px' }}>
          <a
            data-test-id="twofa-back"
            onClick={() => props.onBack?.()}
            style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            Back to sign in
          </a>
        </p>
      </Show>
    </form>
  )
}
