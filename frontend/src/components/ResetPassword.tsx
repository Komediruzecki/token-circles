import { createSignal, onMount, Show } from 'solid-js'
import { api } from '../core/api'
import { setStorageMode } from '../core/storage/storageFactory'
import layoutStyles from './Layout.module.css'

/**
 * Full-page "set a new password" screen, reached from the magic link in a reset email
 * (#reset-password?token=…). Validates the token up front, then lets the user pick a new
 * password; on success the worker signs them in, so we drop into server mode and reload.
 */
function tokenFromHash(): string {
  const hash = window.location.hash.slice(1) // e.g. "reset-password?token=abc"
  const qs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  return new URLSearchParams(qs).get('token') ?? ''
}

export default function ResetPassword() {
  const token = tokenFromHash()
  const [status, setStatus] = createSignal<'checking' | 'ready' | 'invalid' | 'done'>('checking')
  const [password, setPassword] = createSignal('')
  const [confirm, setConfirm] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  onMount(async () => {
    if (!token) {
      setStatus('invalid')
      return
    }
    try {
      setStatus((await api.validateResetToken(token)) ? 'ready' : 'invalid')
    } catch {
      setStatus('invalid')
    }
  })

  const submit = async (e: Event) => {
    e.preventDefault()
    setError('')
    if (password().length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password() !== confirm()) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await api.resetPassword(token, password())
      setStatus('done')
      // A reset only makes sense for a server account — land in server mode at the sign-in
      // screen. The worker no longer auto-logs-in, so the user signs in with the new password.
      setStorageMode('self-hosted')
      setTimeout(() => {
        window.location.hash = ''
        window.location.reload()
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password')
      setLoading(false)
    }
  }

  const goToLogin = () => {
    window.location.hash = ''
    window.location.reload()
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    'margin-bottom': '10px',
    'border-radius': '8px',
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    background: 'var(--bg, #0b0e14)',
    color: 'var(--text, #e6e8eb)',
    'font-size': '14px',
    'box-sizing': 'border-box' as const,
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        padding: '24px',
        background: 'var(--bg, #0b0e14)',
        'overflow-y': 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          'max-width': '360px',
          padding: '32px',
          'border-radius': '16px',
          background: 'var(--surface, #151a23)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          'text-align': 'center',
        }}
      >
        <h1 style={{ 'font-size': '28px', 'font-weight': 700, margin: '0 0 16px' }}>
          Finance<span style={{ color: 'var(--primary)' }}>.</span>
        </h1>

        <Show when={status() === 'checking'}>
          <p style={{ color: 'var(--text-secondary)', 'font-size': '14px' }}>
            Checking your reset link…
          </p>
        </Show>

        <Show when={status() === 'invalid'}>
          <p style={{ color: 'var(--text-secondary)', 'font-size': '14px', margin: '0 0 16px' }}>
            This reset link is invalid or has expired. Request a new one from the sign-in screen.
          </p>
          <button
            class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
            style={{ width: '100%', 'justify-content': 'center' }}
            onClick={goToLogin}
            type="button"
          >
            Back to sign in
          </button>
        </Show>

        <Show when={status() === 'done'}>
          <p style={{ color: 'var(--text-secondary)', 'font-size': '14px' }}>
            Password updated. Redirecting to sign in…
          </p>
        </Show>

        <Show when={status() === 'ready'}>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
            Choose a new password.
          </p>
          <form onSubmit={submit}>
            <input
              type="password"
              placeholder="New password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete="new-password"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm()}
              onInput={(e) => setConfirm(e.currentTarget.value)}
              autocomplete="new-password"
              style={inputStyle}
            />
            <Show when={error()}>
              <div
                style={{
                  color: 'var(--danger, #ef4444)',
                  'font-size': '13px',
                  margin: '2px 0 10px',
                }}
              >
                {error()}
              </div>
            </Show>
            <button
              type="submit"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
              style={{ width: '100%', 'justify-content': 'center' }}
              disabled={loading()}
            >
              {loading() ? 'Please wait…' : 'Set new password'}
            </button>
          </form>
          <button
            onClick={goToLogin}
            type="button"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              'font-size': '13px',
              'text-decoration': 'underline',
              'margin-top': '12px',
            }}
          >
            Back to sign in
          </button>
        </Show>
      </div>
    </div>
  )
}
