import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api } from '../core/api'
import EmailCodeLogin from './EmailCodeLogin'
import styles from './LoginModal.module.css'
import { OrbitSpinner } from './OrbitSpinner'
import Turnstile, {
  captchaIsStuck,
  captchaStatusMessage,
  resetTurnstile,
  turnstileEnabled,
  waitForTurnstileToken,
} from './Turnstile'
import TwofaChallenge from './TwofaChallenge'
import type { TurnstileStatus } from './Turnstile'

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
  const [notice, setNotice] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  // 'signing-in' replaces the form with a branded transition while the register → auto-sign-in
  // handoff runs (mirrors LoginScreen); 'twofa' and 'email-code' are the extra sign-in steps.
  const [stage, setStage] = createSignal<'form' | 'signing-in' | 'twofa' | 'email-code'>('form')
  const [turnstileToken, setTurnstileToken] = createSignal('')
  const [captchaStatus, setCaptchaStatus] = createSignal<TurnstileStatus>(
    turnstileEnabled ? 'loading' : 'disabled'
  )
  // See LoginScreen: a spent token has to take the status with it, or the form explains
  // nothing under a submit button it has just disabled. A stuck widget stays stuck.
  const clearCaptcha = () => {
    resetTurnstile()
    setTurnstileToken('')
    setCaptchaStatus((s) => (captchaIsStuck(s) ? s : 'ready'))
  }

  // Set when the user closes the modal; the register → auto-sign-in
  // continuation checks it so a completed login can't reload the page out from
  // under someone who dismissed the dialog and moved on.
  let dismissed = false
  const close = () => {
    dismissed = true
    props.onClose()
  }

  // Document-level so Escape keeps working during the 'signing-in' stage, when
  // the form (and with it any focused child) is unmounted.
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  })

  const submit = async (e: Event) => {
    e.preventDefault()
    setError('')
    setNotice('')
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
        // The register endpoint deliberately sets no session and never reveals
        // whether the email already existed (anti-enumeration), and login is not
        // gated on email verification — sign the user straight in with the
        // credentials they just chose. The register call consumed the single-use
        // captcha token; reset and wait for a fresh one before the login call.
        setStage('signing-in')
        clearCaptcha()
        try {
          const token = await waitForTurnstileToken(turnstileToken, 20000)
          // The user closed the modal while we waited — drop the handoff
          // (the account exists; they can sign in whenever) instead of
          // reloading the page out from under them.
          if (dismissed) return
          const handoff = await api.loginWithPassword(em, pw, token)
          if (dismissed) return
          if (handoff?.twofaRequired) {
            // "Register" with an existing 2FA-protected account: password matched, the server
            // answered with a challenge — show the code step instead of a dead reload.
            setStage('twofa')
            setLoading(false)
            clearCaptcha()
            return
          }
          // Cookie is set; reload so the app re-checks /auth/me.
          window.location.reload()
          return
        } catch {
          if (dismissed) return
          // Existing account or a captcha hiccup — hand over to manual sign-in
          // without revealing which it was.
          setStage('form')
          setMode('login')
          setPassword('')
          setNotice('Almost done — sign in with your password below.')
          setLoading(false)
          clearCaptcha()
          return
        }
      }
      const login = await api.loginWithPassword(em, pw, turnstileToken())
      if (login?.twofaRequired) {
        // Password verified; the session waits behind the authenticator code.
        setStage('twofa')
        setLoading(false)
        clearCaptcha()
        return
      }
      // Session cookie is set; reload so the app re-checks /auth/me and loads the user's profile.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
      clearCaptcha()
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
        if (e.target === e.currentTarget) close()
      }}
    >
      <div class={styles.modal}>
        <h3 class={styles.title}>{mode() === 'register' ? 'Create account' : 'Sign In'}</h3>
        <p style={{ 'margin-bottom': '16px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
          {stage() === 'signing-in'
            ? 'Welcome aboard.'
            : stage() === 'twofa'
              ? 'Two-factor authentication'
              : stage() === 'email-code'
                ? 'Sign in by email'
                : 'Sign in to sync your data across devices.'}
        </p>

        <Show
          when={stage() === 'form'}
          fallback={
            stage() === 'twofa' ? (
              <TwofaChallenge
                onBack={() => {
                  setStage('form')
                  setPassword('')
                }}
              />
            ) : stage() === 'email-code' ? (
              <EmailCodeLogin
                email={email()}
                onBack={() => setStage('form')}
                onTwofa={() => setStage('twofa')}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': 'center',
                  padding: '18px 0 12px',
                }}
              >
                <OrbitSpinner size={64} label="Account created — signing you in…" />
                {/* The form's widget unmounted with the form; this fresh instance
                    issues the sign-in token (and stays visible in case Cloudflare
                    wants an interactive check). */}
                <Turnstile onToken={setTurnstileToken} onStatus={setCaptchaStatus} />
              </div>
            )
          }
        >
          <Show when={notice()}>
            <div
              data-test-id="auth-notice"
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                'text-align': 'left',
                padding: '10px 12px',
                margin: '0 0 12px',
                'border-radius': '10px',
                border:
                  '1px solid color-mix(in oklab, var(--success, #22c55e) 45%, var(--border, rgba(255,255,255,0.12)))',
                background: 'color-mix(in oklab, var(--success, #22c55e) 12%, transparent)',
                color: 'var(--text, #e6e8eb)',
                'font-size': '13px',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success, #22c55e)"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                style={{ flex: 'none' }}
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>{notice()}</span>
            </div>
          </Show>

          <form onSubmit={submit}>
            <input
              type="email"
              name="email"
              id="login-modal-email"
              placeholder="Email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              autocomplete="username"
              style={inputStyle}
            />
            <input
              type="password"
              name="password"
              id="login-modal-password"
              placeholder="Password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
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
            <Turnstile onToken={setTurnstileToken} onStatus={setCaptchaStatus} />
            {/* Turnstile draws its own, actionable panel for the states the user has to fix
                (blocked script, widget error); this is only the ordinary "not solved yet" hint.
                Without it the modal disabled Sign in and said nothing about why. */}
            <Show
              when={
                turnstileEnabled &&
                !turnstileToken() &&
                !loading() &&
                !captchaIsStuck(captchaStatus())
              }
            >
              <div
                data-test-id="captcha-hint"
                style={{
                  color: 'var(--text-secondary)',
                  'font-size': '12px',
                  margin: '2px 0 10px',
                }}
              >
                {captchaStatusMessage(captchaStatus())}
              </div>
            </Show>
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
                setNotice('')
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

          <div class={styles.actions}>
            <button class={styles.btnCancel} onClick={close} type="button">
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
          <p style={{ margin: '10px 0 0', 'text-align': 'center', 'font-size': '13px' }}>
            <a
              data-test-id="emailcode-open"
              onClick={() => {
                setError('')
                setNotice('')
                setStage('email-code')
              }}
              style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
            >
              Email me a sign-in code
            </a>
          </p>
        </Show>
      </div>
    </div>
  )
}
