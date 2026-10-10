import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { ACCESS_CLEARED_NOTICE, takeAccessCleared } from '../core/accessCleared'
import { api } from '../core/api'
import { displayVersion } from '../core/appVersion'
import { linkWaiting } from '../core/emailVerification'
import { setStorageMode } from '../core/storage/storageFactory'
import {
  conditionalMediationAvailable,
  markPasskeyNudgeAfterLogin,
  passkeysSupported,
  signInWithPasskey,
} from '../core/webauthn'
import { createCaptchaGate } from './captchaGate'
import EmailCodeLogin from './EmailCodeLogin'
import { Field, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import LegalLinks from './LegalLinks'
import styles from './LoginScreen.module.css'
import { LogoMark } from './Logo'
import { OrbitSpinner } from './OrbitSpinner'
import { createSignInForm, reloadIntoTheApp, RESET_LINK_SENT } from './signInForm'
import SupportContact from './SupportContact'
import Turnstile, { captchaIsStuck, captchaStatusMessage, turnstileEnabled } from './Turnstile'
import TwofaChallenge from './TwofaChallenge'
import type { SignInMode, SignInOutcome } from './signInForm'

/**
 * Full-page sign-in gate, shown in server (self-hosted) mode when there's no valid session.
 * Offers email/password (register + login), Google sign-in, and a no-account demo that drops
 * into client-only mode. Client-only mode itself never renders this.
 *
 * The password form is on the form kit (signInForm.ts): a field that is wrong is said under it,
 * and a wrong address or password is one message for the whole form.
 */
export default function LoginScreen() {
  const [mode, setMode] = createSignal<SignInMode>('login')
  // What the screen says that is not a problem with the form: a reset link on its way, the
  // register hand-off, a link from an email waiting for this sign-in.
  const [notice, setNotice] = createSignal('')
  // A way in other than the form that failed (a passkey). The form's own problems are its notice.
  const [elsewhere, setElsewhere] = createSignal('')
  // 'signing-in' replaces the form with a branded transition while the register → auto-sign-in
  // handoff runs; 'twofa' is the second factor's code step; 'email-code' is passwordless sign-in.
  const [stage, setStage] = createSignal<'form' | 'signing-in' | 'twofa' | 'email-code'>('form')

  // The Google callback can't stop for a code mid-redirect, so the worker parks the challenge
  // cookie and sends the browser back with ?twofa=1 — land straight on the code step.
  onMount(() => {
    if (new URLSearchParams(window.location.search).get('twofa') === '1') setStage('twofa')
  })

  // A reset that also confirmed the address reloads onto this screen with what else it cleared.
  onMount(() => {
    if (takeAccessCleared('reset')) setNotice(ACCESS_CLEARED_NOTICE.reset)
  })

  // A link from an email, opened in this browser before signing in: signing in here finishes it
  // (VerifyEmailBanner asks the worker once the app is signed in).
  onMount(() => {
    const waiting = linkWaiting()
    if (!waiting) return
    setNotice(
      waiting.change
        ? 'Sign in to finish changing your address.'
        : 'Sign in to confirm your address.'
    )
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
  // The widget is invisible until Cloudflare wants a click, so the submit button is never gated
  // on a token: the send waits for one instead (captchaGate.ts).
  const captcha = createCaptchaGate()

  /**
   * Creating an account sets no session, and the answer is the same whether or not the address
   * already had an account. Sign in with the password just chosen, on a fresh captcha token (the
   * last one was spent): it works for a new account, and for anything else the form takes over.
   */
  const handOff = async (email: string, password: string) => {
    setStage('signing-in')
    try {
      const handoff = await api.loginWithPassword(email, password, await captcha.next())
      captcha.spent()
      if (handoff?.twofaRequired) {
        // "Create account" with an existing two-factor account whose password matched: the code
        // step, not a reload onto an empty form.
        setStage('twofa')
        return
      }
      await reloadIntoTheApp()
    } catch {
      // An existing account or a captcha hiccup: hand over to signing in by hand, without saying
      // which it was.
      captcha.spent()
      setMode('login')
      form.reset({ email, password: '' })
      setNotice('Almost done — sign in with your password below.')
      setStage('form')
    }
  }

  const saved = (outcome: SignInOutcome) => {
    if (outcome.kind === 'second-factor') setStage('twofa')
    else if (outcome.kind === 'reset-link-sent') setNotice(RESET_LINK_SENT)
    else void handOff(outcome.email, outcome.password)
  }

  const form = createSignInForm({ mode, captcha, saved })

  /** Another mode, or another way in: the values stay, and nothing from before is said. */
  const switchTo = (next: SignInMode) => {
    setMode(next)
    setNotice('')
    setElsewhere('')
    form.reset({ ...form.values })
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
                  form.reset({ email: form.values.email, password: '' })
                }}
              />
            ) : stage() === 'email-code' ? (
              <EmailCodeLogin
                email={form.values.email}
                onBack={() => setStage('form')}
                onTwofa={() => setStage('twofa')}
              />
            ) : (
              <div class={styles.signingIn}>
                {/* Deliberately does not say "account created". The register endpoint returns the
                    same neutral response whether or not the email already existed — that is the
                    anti-enumeration guarantee — so this screen cannot know which happened, and
                    claiming creation tells an existing owner something untrue. Signing in is what
                    is actually happening in both branches. */}
                <OrbitSpinner size={72} label="Signing you in…" />
                {/* The form's widget unmounted with the form; this fresh instance issues the
                    sign-in token. A new mount is also a first execution, which is the only time
                    Cloudflare decides an interaction-only widget may show itself. */}
                <Turnstile
                  appearance="interaction-only"
                  onToken={captcha.onToken}
                  onStatus={captcha.onStatus}
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

          <FormNotice form={form} testId="login-error" />

          <form
            class={styles.form}
            {...form.attrs}
            onSubmit={(event) => {
              setNotice('')
              setElsewhere('')
              void form.submit(event)
            }}
          >
            <Field
              form={form}
              name="email"
              id="login-email"
              label="Email address"
              class={styles.field}
              labelClass={styles.label}
            >
              {(control) => (
                <input
                  {...control}
                  type="email"
                  name="email"
                  value={form.values.email}
                  onInput={(e) => form.set('email', e.currentTarget.value)}
                  // `username` (not `email`) is the token password managers pair with the password
                  // field; combined with name/id it's what Android Chrome autofill keys off of.
                  // `webauthn` additionally lets the autofill dropdown offer saved passkeys while
                  // the conditional request from onMount is pending.
                  autocomplete="username webauthn"
                  class={styles.input}
                />
              )}
            </Field>

            <Show when={mode() !== 'forgot'}>
              <Field
                form={form}
                name="password"
                id="login-password"
                label={<span class={styles.label}>Password</span>}
                class={styles.field}
                labelClass={styles.labelRow}
                tip={
                  <Show when={mode() === 'login'}>
                    <button
                      type="button"
                      class={styles.accountLink}
                      onClick={() => {
                        switchTo('forgot')
                      }}
                    >
                      Forgot password?
                    </button>
                  </Show>
                }
              >
                {(control) => (
                  <input
                    {...control}
                    type="password"
                    name="password"
                    value={form.values.password}
                    onInput={(e) => form.set('password', e.currentTarget.value)}
                    autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
                    class={styles.input}
                  />
                )}
              </Field>
            </Show>

            {/* Invisible unless Cloudflare wants a click. It sits directly above the button so
                that, on the rare occasion it does appear, it reads as part of submitting. */}
            <div class={styles.captchaSlot}>
              <Turnstile
                appearance="interaction-only"
                onToken={captcha.onToken}
                onStatus={captcha.onStatus}
              />
            </div>
            {/* Only while a submit is actually waiting on the token. Before that there is nothing
                to explain — the button is live and the challenge resolves on its own. Turnstile
                draws its own actionable panel for the states the user has to fix. */}
            <Show
              when={
                turnstileEnabled &&
                form.submitting() &&
                !captcha.token() &&
                !captchaIsStuck(captcha.status())
              }
            >
              <div data-test-id="captcha-hint" class={styles.captchaHint}>
                {captchaStatusMessage(captcha.status())}
              </div>
            </Show>

            <SubmitButton
              busy={form.submitting()}
              busyLabel={
                mode() === 'register'
                  ? 'Creating your account…'
                  : mode() === 'forgot'
                    ? 'Sending…'
                    : 'Signing in…'
              }
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
            >
              {mode() === 'register'
                ? 'Create account'
                : mode() === 'forgot'
                  ? 'Send reset link'
                  : 'Sign in'}
            </SubmitButton>
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
                  switchTo(mode())
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
                    setElsewhere('')
                    stopConditional()
                    void signInWithPasskey().then((result) => {
                      if (result.ok) window.location.reload()
                      else if (!result.aborted) setElsewhere(result.error)
                    })
                  }}
                  type="button"
                >
                  Sign in with a passkey
                </button>
              </Show>
            </div>
            <div role="alert" data-test-id="passkey-error">
              <Show when={elsewhere()}>
                <p class={styles.elsewhere}>{elsewhere()}</p>
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
                    switchTo('login')
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
                  switchTo(mode() === 'login' ? 'register' : 'login')
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
          <LegalLinks />
          <span class={styles.version}>v{displayVersion()}</span>
        </div>
      </div>
    </div>
  )
}
