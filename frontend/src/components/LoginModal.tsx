import { createSignal, Show } from 'solid-js'
import { api, toast } from '../core/api'
import styles from './LoginModal.module.css'
import Turnstile, { resetTurnstile, turnstileEnabled } from './Turnstile'

export interface LoginModalProps {
  onClose: () => void
  // Kept for existing call sites; the password/Google flows reload the page, so the app
  // re-checks the session on reload rather than relying on this callback.
  onSuccess: () => void
}

export default function LoginModal(props: LoginModalProps) {
  const [mode, setMode] = createSignal<'login' | 'register'>('login')
  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [turnstileToken, setTurnstileToken] = createSignal('')

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose()
  }

  const submit = async (e: Event) => {
    e.preventDefault()
    setError('')
    const em = email().trim()
    const pw = password()
    if (!em || !pw) {
      setError('Email and password are required')
      return
    }
    if (mode() === 'register' && pw.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      if (mode() === 'register') {
        await api.register(em, pw, turnstileToken())
        // Registration no longer signs you in (and never reveals whether the email already exists):
        // switch to sign-in and point the user to their email.
        toast('Check your email to finish setting up, then sign in.', 'success')
        setMode('login')
        setPassword('')
        setLoading(false)
        resetTurnstile()
        setTurnstileToken('')
        return
      }
      await api.loginWithPassword(em, pw, turnstileToken())
      // Session cookie is set; reload so the app re-checks /auth/me and loads the user's profile.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
      resetTurnstile()
      setTurnstileToken('')
    }
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
      class={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={styles.modal} onKeyDown={handleKeyDown}>
        <h3 class={styles.title}>{mode() === 'register' ? 'Create account' : 'Sign In'}</h3>
        <p style={{ 'margin-bottom': '16px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
          Sign in to sync your data across devices.
        </p>

        <form onSubmit={submit}>
          <input
            type="email"
            placeholder="Email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            autocomplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
            style={inputStyle}
          />
          <Show when={error()}>
            <div
              style={{ color: 'var(--danger, #ef4444)', 'font-size': '13px', margin: '2px 0 10px' }}
            >
              {error()}
            </div>
          </Show>
          <Turnstile onToken={setTurnstileToken} />
          <button
            class={styles.btnSubmit}
            type="submit"
            disabled={loading() || (turnstileEnabled && !turnstileToken())}
            style={{ width: '100%', 'justify-content': 'center' }}
          >
            {loading() ? 'Please wait…' : mode() === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p
          style={{
            margin: '12px 0 0',
            'font-size': '13px',
            color: 'var(--text-secondary)',
            'text-align': 'center',
          }}
        >
          {mode() === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <a
            onClick={() => {
              setMode(mode() === 'login' ? 'register' : 'login')
              setError('')
            }}
            style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
          >
            {mode() === 'login' ? 'Create one' : 'Sign in'}
          </a>
        </p>

        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            margin: '16px 0',
            color: 'var(--text-secondary)',
            'font-size': '12px',
          }}
        >
          <div
            style={{ flex: 1, height: '1px', background: 'var(--border, rgba(255,255,255,0.12))' }}
          />
          or
          <div
            style={{ flex: 1, height: '1px', background: 'var(--border, rgba(255,255,255,0.12))' }}
          />
        </div>

        <div class={styles.actions}>
          <button class={styles.btnCancel} onClick={props.onClose} type="button">
            Cancel
          </button>
          <button
            class={styles.btnSubmit}
            onClick={() => {
              api.loginWithGoogle()
            }}
            type="button"
          >
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  )
}
