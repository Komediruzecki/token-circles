import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api } from '../core/api'
import { markPasskeyNudgeAfterLogin, passkeysSupported, signInWithPasskey } from '../core/webauthn'
import { createCaptchaGate } from './captchaGate'
import EmailCodeLogin from './EmailCodeLogin'
import { Field, FormNotice, SubmitButton } from './form'
import styles from './LoginModal.module.css'
import { OrbitSpinner } from './OrbitSpinner'
import { createSignInForm, reloadIntoTheApp } from './signInForm'
import stepStyles from './SignInSteps.module.css'
import Turnstile, { captchaIsStuck, captchaStatusMessage, turnstileEnabled } from './Turnstile'
import TwofaChallenge from './TwofaChallenge'
import type { SignInMode, SignInOutcome } from './signInForm'

export interface LoginModalProps {
  onClose: () => void
  // Kept for existing call sites; the password/Google flows reload the page, so the app
  // re-checks the session on reload rather than relying on this callback.
  onSuccess: () => void
}

export default function LoginModal(props: LoginModalProps) {
  const [mode, setMode] = createSignal<SignInMode>('login')
  // What the dialog says that is not a problem with the form: the register hand-off.
  const [notice, setNotice] = createSignal('')
  // A way in other than the form that failed (a passkey). The form's own problems are its notice.
  const [elsewhere, setElsewhere] = createSignal('')
  // 'signing-in' replaces the form with a branded transition while the register → auto-sign-in
  // handoff runs (mirrors LoginScreen); 'twofa' and 'email-code' are the extra sign-in steps.
  const [stage, setStage] = createSignal<'form' | 'signing-in' | 'twofa' | 'email-code'>('form')
  // The send waits for the token rather than the button waiting for it (captchaGate.ts).
  const captcha = createCaptchaGate()

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

  /**
   * Creating an account sets no session, and the answer is the same whether or not the address
   * already had an account. Sign in with the password just chosen, on a fresh captcha token: it
   * works for a new account, and for anything else the form takes over (LoginScreen does the same).
   */
  const handOff = async (email: string, password: string) => {
    setStage('signing-in')
    try {
      const token = await captcha.next()
      // The user closed the dialog while we waited: drop the hand-off (the account exists; they
      // can sign in whenever) instead of reloading the page out from under them.
      if (dismissed) return
      const handoff = await api.loginWithPassword(email, password, token)
      captcha.spent()
      if (dismissed) return
      if (handoff?.twofaRequired) {
        // "Create account" with an existing two-factor account whose password matched: the code
        // step, not a dead reload.
        setStage('twofa')
        return
      }
      await reloadIntoTheApp()
    } catch {
      if (dismissed) return
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
    else if (outcome.kind === 'registered') void handOff(outcome.email, outcome.password)
  }

  const form = createSignInForm({ mode, captcha, saved })

  /** The other mode: the values stay, and nothing from before is said. */
  const switchTo = (next: SignInMode) => {
    setMode(next)
    setNotice('')
    setElsewhere('')
    form.reset({ ...form.values })
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
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': 'center',
                  padding: '18px 0 12px',
                }}
              >
                {/* Not "account created": the answer to creating an account is the same whether or
                    not the address had one, so this cannot know which happened. Signing in is
                    what happens in both. */}
                <OrbitSpinner size={64} label="Signing you in…" />
                {/* The form's widget unmounted with the form; this fresh instance
                    issues the sign-in token (and stays visible in case Cloudflare
                    wants an interactive check). */}
                <Turnstile onToken={captcha.onToken} onStatus={captcha.onStatus} />
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

          <FormNotice form={form} testId="login-error" />

          <form
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
              id="login-modal-email"
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
                  autocomplete="username"
                  class={stepStyles.input}
                />
              )}
            </Field>
            <Field
              form={form}
              name="password"
              id="login-modal-password"
              label="Password"
              class={styles.field}
              labelClass={styles.label}
            >
              {(control) => (
                <input
                  {...control}
                  type="password"
                  name="password"
                  value={form.values.password}
                  onInput={(e) => form.set('password', e.currentTarget.value)}
                  autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
                  class={stepStyles.input}
                />
              )}
            </Field>
            <Turnstile onToken={captcha.onToken} onStatus={captcha.onStatus} />
            {/* Turnstile draws its own, actionable panel for the states the user has to fix
                (blocked script, widget error); this is only the ordinary "not solved yet" hint,
                which also says why a submit is waiting. */}
            <Show when={turnstileEnabled && !captcha.token() && !captchaIsStuck(captcha.status())}>
              <div
                data-test-id="captcha-hint"
                style={{
                  color: 'var(--text-secondary)',
                  'font-size': '12px',
                  margin: '2px 0 10px',
                }}
              >
                {captchaStatusMessage(captcha.status())}
              </div>
            </Show>
            <SubmitButton
              busy={form.submitting()}
              busyLabel={mode() === 'register' ? 'Creating your account…' : 'Signing in…'}
              class={styles.btnSubmit}
              style={{ width: '100%', 'justify-content': 'center' }}
            >
              {mode() === 'register' ? 'Create account' : 'Sign in'}
            </SubmitButton>
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
                switchTo(mode() === 'login' ? 'register' : 'login')
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
                // Survives the OAuth round-trip in this tab; see LoginScreen's Google button.
                markPasskeyNudgeAfterLogin()
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
                switchTo(mode())
                setStage('email-code')
              }}
              style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
            >
              Email me a sign-in code
            </a>
            <Show when={passkeysSupported()}>
              {' · '}
              <a
                data-test-id="passkey-signin"
                onClick={() => {
                  setElsewhere('')
                  void signInWithPasskey().then((result) => {
                    if (result.ok) window.location.reload()
                    else if (!result.aborted) setElsewhere(result.error)
                  })
                }}
                style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
              >
                Use a passkey
              </a>
            </Show>
          </p>
          <div role="alert" data-test-id="passkey-error">
            <Show when={elsewhere()}>
              <p class={styles.error}>{elsewhere()}</p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
