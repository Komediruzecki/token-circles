import { createSignal, Show } from 'solid-js'
import { api } from '../core/api'
import { setStorageMode } from '../core/storage/storageFactory'
import layoutStyles from './Layout.module.css'
import { LogoMark } from './Logo'
import SupportContact from './SupportContact'
import Turnstile, { resetTurnstile, turnstileEnabled } from './Turnstile'

/**
 * Full-page sign-in gate, shown in server (self-hosted) mode when there's no valid session.
 * Offers email/password (register + login), Google sign-in, and a no-account demo that drops
 * into client-only mode. Client-only mode itself never renders this.
 */
// Format check for inline feedback (matches the worker's own EMAIL_RE, so the
// client can't pass something the server will reject). Deliberately simple —
// exhaustive RFC-5322 validation belongs to the mail server, not a signup form.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const isEmailValid = (value: string) => EMAIL_RE.test(value.trim())

export default function LoginScreen() {
  const [mode, setMode] = createSignal<'login' | 'register' | 'forgot'>('login')
  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [turnstileToken, setTurnstileToken] = createSignal('')
  // Show the "invalid email" hint only after the user has interacted with the
  // field (on blur or first submit), so an untouched empty form isn't red.
  const [emailTouched, setEmailTouched] = createSignal(false)
  const emailInvalid = () => emailTouched() && email().trim() !== '' && !isEmailValid(email())

  const submit = async (e: Event) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setEmailTouched(true)
    const em = email().trim()

    // Reject a malformed address up front — clearer than the server's generic 4xx,
    // and it never burns a captcha token on a request that can't succeed.
    if (em !== '' && !isEmailValid(em)) {
      setError('Please enter a valid email address')
      return
    }

    // Forgot-password: ask the worker to email a reset link. The response never reveals whether
    // the account exists, so we always show the same neutral confirmation.
    if (mode() === 'forgot') {
      if (!em) {
        setError('Email is required')
        return
      }
      setLoading(true)
      try {
        await api.forgotPassword(em, turnstileToken())
        setNotice(
          'If an account exists for that email, a reset link is on its way. Check your inbox.'
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
        resetTurnstile()
        setTurnstileToken('')
      }
      return
    }

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
        setMode('login')
        setPassword('')
        setNotice('Check your email to finish setting up, then sign in below.')
        setLoading(false)
        resetTurnstile()
        setTurnstileToken('')
        return
      }
      await api.loginWithPassword(em, pw, turnstileToken())
      // Cookie is set; reload so the app re-checks /auth/me and renders authenticated.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
      resetTurnstile()
      setTurnstileToken('')
    }
  }

  // Demo = client-only mode (seeded example profiles, no account). Switch storage mode to
  // serverless and reload; the gate won't render in that mode. Switch back in Settings.
  const tryDemo = () => {
    setStorageMode('serverless')
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
        <div style={{ display: 'flex', 'justify-content': 'center', margin: '0 0 10px' }}>
          <LogoMark size={44} />
        </div>
        <h1 style={{ 'font-size': '26px', 'font-weight': 600, margin: '0 0 4px' }}>
          Token Circles
        </h1>
        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
          {mode() === 'register'
            ? 'Create your account.'
            : mode() === 'forgot'
              ? 'Reset your password.'
              : 'Sign in to access your finances.'}
        </p>

        <form onSubmit={submit}>
          <input
            type="email"
            name="email"
            id="login-email"
            placeholder="Email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={emailInvalid()}
            // `username` (not `email`) is the token password managers pair with the password
            // field; combined with name/id it's what Android Chrome autofill keys off of.
            autocomplete="username"
            style={{
              ...inputStyle,
              'margin-bottom': emailInvalid() ? '2px' : inputStyle['margin-bottom'],
              border: emailInvalid() ? '1px solid var(--danger, #ef4444)' : inputStyle.border,
            }}
          />
          <Show when={emailInvalid()}>
            <div
              style={{
                color: 'var(--danger, #ef4444)',
                'font-size': '12.5px',
                'text-align': 'left',
                margin: '0 0 10px',
              }}
            >
              That doesn't look like a valid email address.
            </div>
          </Show>
          <Show when={mode() !== 'forgot'}>
            <input
              type="password"
              name="password"
              id="login-password"
              placeholder="Password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
              style={inputStyle}
            />
          </Show>
          <Show when={mode() === 'login'}>
            <div style={{ 'text-align': 'right', margin: '-4px 0 10px' }}>
              <a
                onClick={() => {
                  setMode('forgot')
                  setError('')
                  setNotice('')
                }}
                style={{ cursor: 'pointer', color: 'var(--text-secondary)', 'font-size': '13px' }}
              >
                Forgot password?
              </a>
            </div>
          </Show>
          <Show when={error()}>
            <div
              style={{ color: 'var(--danger, #ef4444)', 'font-size': '13px', margin: '2px 0 10px' }}
            >
              {error()}
            </div>
          </Show>
          <Show when={notice()}>
            <div
              style={{ color: 'var(--text-secondary)', 'font-size': '13px', margin: '2px 0 10px' }}
            >
              {notice()}
            </div>
          </Show>
          <Turnstile onToken={setTurnstileToken} />
          <Show when={turnstileEnabled && !turnstileToken() && !loading()}>
            <div
              style={{
                color: 'var(--text-secondary)',
                'font-size': '12px',
                margin: '2px 0 10px',
              }}
            >
              Complete the verification above to continue.
            </div>
          </Show>
          <button
            type="submit"
            class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
            style={{ width: '100%', 'justify-content': 'center' }}
            disabled={loading() || (turnstileEnabled && !turnstileToken())}
          >
            {loading()
              ? 'Please wait…'
              : mode() === 'register'
                ? 'Create account'
                : mode() === 'forgot'
                  ? 'Send reset link'
                  : 'Sign in'}
          </button>
        </form>

        <p style={{ margin: '12px 0 0', 'font-size': '13px', color: 'var(--text-secondary)' }}>
          <Show
            when={mode() !== 'forgot'}
            fallback={
              <a
                onClick={() => {
                  setMode('login')
                  setError('')
                  setNotice('')
                }}
                style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
              >
                Back to sign in
              </a>
            }
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
          </Show>
        </p>

        <Show when={mode() !== 'forgot'}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              margin: '18px 0',
              color: 'var(--text-secondary)',
              'font-size': '12px',
            }}
          >
            <div
              style={{
                flex: 1,
                height: '1px',
                background: 'var(--border, rgba(255,255,255,0.12))',
              }}
            />
            or
            <div
              style={{
                flex: 1,
                height: '1px',
                background: 'var(--border, rgba(255,255,255,0.12))',
              }}
            />
          </div>

          <button
            class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
            style={{ width: '100%', 'justify-content': 'center', 'margin-bottom': '10px' }}
            onClick={() => {
              api.loginWithGoogle()
            }}
            type="button"
          >
            Continue with Google
          </button>
          <button
            onClick={tryDemo}
            type="button"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              'font-size': '13px',
              'text-decoration': 'underline',
            }}
          >
            Try the demo — no account needed
          </button>
        </Show>

        <div style={{ 'margin-top': '16px', 'text-align': 'center' }}>
          <SupportContact />
          <div
            style={{
              'margin-top': '10px',
              color: 'var(--text-secondary)',
              'font-size': '11px',
              opacity: 0.7,
            }}
          >
            v{__APP_VERSION__}
          </div>
        </div>
      </div>
    </div>
  )
}
