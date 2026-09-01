import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api } from '../core/api'
import { displayVersion } from '../core/appVersion'
import { setStorageMode } from '../core/storage/storageFactory'
import {
  conditionalMediationAvailable,
  markPasskeyNudgeAfterLogin,
  passkeysSupported,
  signInWithPasskey,
} from '../core/webauthn'
import EmailCodeLogin from './EmailCodeLogin'
import layoutStyles from './Layout.module.css'
import styles from './LoginScreen.module.css'
import { LogoMark } from './Logo'
import { OrbitSpinner } from './OrbitSpinner'
import SupportContact from './SupportContact'
import Turnstile, {
  captchaIsStuck,
  captchaStatusMessage,
  resetTurnstile,
  turnstileEnabled,
  waitForTurnstileToken,
} from './Turnstile'
import TwofaChallenge from './TwofaChallenge'
import type { TurnstileStatus } from './Turnstile'

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
  // 'signing-in' replaces the form with a branded transition while the register → auto-sign-in
  // handoff runs; 'twofa' is the second factor's code step; 'email-code' is passwordless sign-in.
  const [stage, setStage] = createSignal<'form' | 'signing-in' | 'twofa' | 'email-code'>('form')

  // The Google callback can't stop for a code mid-redirect, so the worker parks the challenge
  // cookie and sends the browser back with ?twofa=1 — land straight on the code step.
  onMount(() => {
    if (new URLSearchParams(window.location.search).get('twofa') === '1') setStage('twofa')
  })

  // Conditional UI: on capable browsers a background WebAuthn request lets the email field's
  // autofill offer saved passkeys — one tap, no button. It must be aborted before the explicit
  // passkey button runs (the spec allows one pending request) and when the screen unmounts.
  let conditionalAbort: AbortController | undefined
  const stopConditional = () => {
    conditionalAbort?.abort()
    conditionalAbort = undefined
  }
  onMount(() => {
    // Nothing awaits this chain, so an unhandled rejection anywhere in it reaches the global
    // handler and paints "App Crashed" over a login screen that still works. Both links catch.
    void conditionalMediationAvailable()
      .then((available) => {
        if (!available) return
        conditionalAbort = new AbortController()
        return signInWithPasskey({ conditional: true, signal: conditionalAbort.signal }).then(
          (result) => {
            if (result.ok) window.location.reload()
            // Quiet otherwise: an aborted or failed autofill request must not paint the form red —
            // the explicit button is the path that reports errors.
          }
        )
      })
      .catch(() => {
        // Autofill is a convenience; failing to offer it is never worth surfacing.
      })
  })
  onCleanup(stopConditional)
  const [turnstileToken, setTurnstileToken] = createSignal('')
  const [captchaStatus, setCaptchaStatus] = createSignal<TurnstileStatus>(
    turnstileEnabled ? 'loading' : 'disabled'
  )
  // A captcha token is single-use, so every attempt ends by burning it and re-arming the widget.
  // The status has to follow: left at 'solved' while we hold no token, the form would explain
  // nothing at all under a submit button it has just disabled. A widget that is stuck stays
  // stuck — resetting a script that never loaded does not load it.
  const clearCaptcha = () => {
    resetTurnstile()
    setTurnstileToken('')
    setCaptchaStatus((s) => (captchaIsStuck(s) ? s : 'ready'))
  }

  /**
   * The widget is invisible until Cloudflare wants a click, so gating the submit button on a token
   * would disable it with nothing on screen to say why. The button stays live and the wait happens
   * here instead — normally already resolved, since the challenge passes long before anyone has
   * finished typing a password.
   */
  const captchaToken = async (): Promise<string> => {
    if (!turnstileEnabled) return ''
    if (turnstileToken()) return turnstileToken()
    return waitForTurnstileToken(turnstileToken, 20000)
  }
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
        await api.forgotPassword(em, await captchaToken())
        setNotice(
          'If an account exists for that email, a reset link is on its way. Check your inbox.'
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
        clearCaptcha()
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
        await api.register(em, pw, await captchaToken())
        // The register endpoint deliberately sets no session and never reveals
        // whether the email already existed (anti-enumeration), and login is not
        // gated on email verification — so sign the user straight in with the
        // credentials they just chose instead of bouncing them back to the form.
        // The register call consumed the single-use captcha token; reset and
        // wait for the widget to issue a fresh one before the login call.
        setStage('signing-in')
        clearCaptcha()
        try {
          const token = await waitForTurnstileToken(turnstileToken, 20000)
          const handoff = await api.loginWithPassword(em, pw, token)
          if (handoff?.twofaRequired) {
            // "Register" with an existing 2FA-protected account: the password matched, so the
            // server answered with a challenge, not a session. Show the code step — reloading
            // here would land back on an empty form with no explanation.
            setStage('twofa')
            setLoading(false)
            clearCaptcha()
            return
          }
          // Cookie is set; reload lands in the app (a pristine profile opens onboarding).
          markPasskeyNudgeAfterLogin()
          window.location.reload()
          return
        } catch {
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
      const login = await api.loginWithPassword(em, pw, await captchaToken())
      if (login?.twofaRequired) {
        // Password verified; the session waits behind the authenticator code.
        setStage('twofa')
        setLoading(false)
        clearCaptcha()
        return
      }
      // Cookie is set; reload so the app re-checks /auth/me and renders authenticated.
      markPasskeyNudgeAfterLogin()
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
      clearCaptcha()
    }
  }

  // Demo = client-only mode (seeded example profiles, no account). Switch storage mode to
  // serverless and reload; the gate won't render in that mode. Switch back in Settings.
  const tryDemo = () => {
    setStorageMode('serverless')
    window.location.reload()
  }

  return (
    <div class={styles.screen}>
      <div class={styles.card}>
        <div class={styles.header}>
          <div class={styles.brand}>
            <LogoMark size={44} />
          </div>
          <h1 class={styles.title}>Token Circles</h1>
          <p class={styles.subtitle}>
            {stage() === 'signing-in'
              ? 'Welcome aboard.'
              : stage() === 'twofa'
                ? 'Two-factor authentication'
                : stage() === 'email-code'
                  ? 'Sign in by email'
                  : mode() === 'register'
                    ? 'Create your account.'
                    : mode() === 'forgot'
                      ? 'Reset your password.'
                      : 'Sign in to access your finances.'}
          </p>
        </div>

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
              <div class={styles.signingIn}>
                <OrbitSpinner size={72} label="Account created — signing you in…" />
                {/* The form's widget unmounted with the form; this fresh instance issues the
                    sign-in token. A new mount is also a first execution, which is the only time
                    Cloudflare decides an interaction-only widget may show itself. */}
                <Turnstile
                  appearance="interaction-only"
                  onToken={setTurnstileToken}
                  onStatus={setCaptchaStatus}
                />
              </div>
            )
          }
        >
          <Show when={notice()}>
            <div data-test-id="auth-notice" class={styles.notice}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success, #22c55e)"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class={styles.noticeIcon}
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>{notice()}</span>
            </div>
          </Show>

          <form class={styles.form} onSubmit={submit}>
            <div class={styles.field}>
              <div class={styles.labelRow}>
                <label class={styles.label} for="login-email">
                  Email address
                </label>
              </div>
              <input
                type="email"
                name="email"
                id="login-email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailInvalid()}
                // `username` (not `email`) is the token password managers pair with the password
                // field; combined with name/id it's what Android Chrome autofill keys off of.
                // `webauthn` additionally lets the autofill dropdown offer saved passkeys while
                // the conditional request from onMount is pending.
                autocomplete="username webauthn"
                class={`${styles.input} ${emailInvalid() ? styles.inputInvalid : ''}`}
              />
              <Show when={emailInvalid()}>
                <span class={styles.fieldError}>That doesn't look like a valid email address.</span>
              </Show>
            </div>

            <Show when={mode() !== 'forgot'}>
              <div class={styles.field}>
                <div class={styles.labelRow}>
                  <label class={styles.label} for="login-password">
                    Password
                  </label>
                  <Show when={mode() === 'login'}>
                    <button
                      type="button"
                      class={styles.accountLink}
                      onClick={() => {
                        setMode('forgot')
                        setError('')
                        setNotice('')
                      }}
                    >
                      Forgot password?
                    </button>
                  </Show>
                </div>
                <input
                  type="password"
                  name="password"
                  id="login-password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
                  class={styles.input}
                />
              </div>
            </Show>

            <Show when={error()}>
              <div class={styles.formError}>{error()}</div>
            </Show>

            {/* Invisible unless Cloudflare wants a click. It sits directly above the button so
                that, on the rare occasion it does appear, it reads as part of submitting. */}
            <div class={styles.captchaSlot}>
              <Turnstile
                appearance="interaction-only"
                onToken={setTurnstileToken}
                onStatus={setCaptchaStatus}
              />
            </div>
            {/* Only while a submit is actually waiting on the token. Before that there is nothing
                to explain — the button is live and the challenge resolves on its own. Turnstile
                draws its own actionable panel for the states the user has to fix. */}
            <Show
              when={
                turnstileEnabled &&
                loading() &&
                !turnstileToken() &&
                !captchaIsStuck(captchaStatus())
              }
            >
              <div data-test-id="captcha-hint" class={styles.captchaHint}>
                {captchaStatusMessage(captchaStatus())}
              </div>
            </Show>

            <button
              type="submit"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
              disabled={loading()}
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

          <Show when={mode() !== 'forgot'}>
            <div class={styles.divider}>or</div>

            <div class={styles.alts}>
              <button
                class={`${layoutStyles.btn} ${layoutStyles.btnSecondary} ${styles.altBtn}`}
                onClick={() => {
                  // sessionStorage survives the OAuth round-trip in this tab, so the post-login
                  // passkey nudge works for Google sign-ins too. A failed sign-in wastes the
                  // flag harmlessly — the nudge only renders for an authenticated session.
                  markPasskeyNudgeAfterLogin()
                  api.loginWithGoogle()
                }}
                type="button"
              >
                Continue with Google
              </button>
              <button
                data-test-id="emailcode-open"
                class={`${layoutStyles.btn} ${layoutStyles.btnSecondary} ${styles.altBtn}`}
                onClick={() => {
                  setError('')
                  setNotice('')
                  setStage('email-code')
                }}
                type="button"
              >
                Email me a sign-in code
              </button>
              <Show when={passkeysSupported()}>
                <button
                  data-test-id="passkey-signin"
                  class={`${layoutStyles.btn} ${layoutStyles.btnSecondary} ${styles.altBtn}`}
                  onClick={() => {
                    setError('')
                    stopConditional()
                    void signInWithPasskey().then((result) => {
                      if (result.ok) window.location.reload()
                      else if (!result.aborted) setError(result.error)
                    })
                  }}
                  type="button"
                >
                  Sign in with a passkey
                </button>
              </Show>
            </div>
          </Show>

          {/* Both ways of arriving without an account, on one line and below the alternatives they
              compete with — a sign-up link above them reads as the only way in. */}
          <p class={styles.accountLine}>
            <Show
              when={mode() !== 'forgot'}
              fallback={
                <button
                  type="button"
                  class={styles.accountLink}
                  onClick={() => {
                    setMode('login')
                    setError('')
                    setNotice('')
                  }}
                >
                  Back to sign in
                </button>
              }
            >
              {mode() === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                class={styles.accountLink}
                onClick={() => {
                  setMode(mode() === 'login' ? 'register' : 'login')
                  setError('')
                  setNotice('')
                }}
              >
                {mode() === 'login' ? 'Create one' : 'Sign in'}
              </button>
              <Show when={mode() === 'login'}>
                <span class={styles.accountSep}>·</span>
                <button
                  data-test-id="try-no-account"
                  type="button"
                  class={styles.accountLink}
                  onClick={tryDemo}
                >
                  Continue with no account
                </button>
              </Show>
            </Show>
          </p>
        </Show>

        <div class={styles.footer}>
          <SupportContact />
          <span class={styles.version}>v{displayVersion()}</span>
        </div>
      </div>
    </div>
  )
}
