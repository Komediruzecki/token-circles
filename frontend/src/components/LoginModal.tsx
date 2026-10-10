import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api } from '../core/api'
import { markPasskeyNudgeAfterLogin, passkeysSupported, signInWithPasskey } from '../core/webauthn'
import { createCaptchaGate } from './captchaGate'
import CheckInbox from './CheckInbox'
import EmailCodeLogin from './EmailCodeLogin'
import { Field, FormNotice, SubmitButton } from './form'
import styles from './LoginModal.module.css'
import { createSignInForm, SIGN_IN_REFUSED } from './signInForm'
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

/**
 * The sign-in dialog, for someone using the app with no account who wants to sign in or create
 * one. The password form is the sign-in screen's (signInForm.ts), and so is what follows it:
 * creating an account, or asking for the confirm link again, ends on Check your inbox
 * (CheckInbox), and a refused sign-in offers to send the confirm link again.
 */
export default function LoginModal(props: LoginModalProps) {
  const [mode, setMode] = createSignal<SignInMode>('login')
  // A way in other than the form that failed (a passkey). The form's own problems are its notice.
  const [elsewhere, setElsewhere] = createSignal('')
  // 'inbox' is Check your inbox, for the address `inbox` holds; 'twofa' and 'email-code' are the
  // extra sign-in steps.
  const [stage, setStage] = createSignal<'form' | 'inbox' | 'twofa' | 'email-code'>('form')
  const [inbox, setInbox] = createSignal('')
  // The send waits for the token rather than the button waiting for it (captchaGate.ts).
  const captcha = createCaptchaGate()

  const close = () => {
    props.onClose()
  }

  // Document-level so Escape keeps working on the steps after the form, when the form (and with
  // it any focused child) is unmounted.
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  })

  const saved = (outcome: SignInOutcome) => {
    if (outcome.kind === 'second-factor') setStage('twofa')
    else if (outcome.kind === 'check-inbox') {
      setInbox(outcome.email)
      setStage('inbox')
    }
  }

  const form = createSignInForm({ mode, captcha, saved })

  /** Another mode: the values stay, and nothing from before is said. */
  const switchTo = (next: SignInMode) => {
    setMode(next)
    setElsewhere('')
    form.reset({ ...form.values })
  }

  /** From the refused sign-in: send the confirm link to the address in the form, signed out. */
  const sendConfirmLink = () => {
    switchTo('confirm')
    void form.submit()
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
          {stage() === 'inbox'
            ? 'Check your inbox.'
            : stage() === 'twofa'
              ? 'Two-factor authentication'
              : stage() === 'email-code'
                ? 'Sign in by email'
                : mode() === 'confirm'
                  ? 'Send the confirm link again.'
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
              <CheckInbox
                email={inbox()}
                onBack={() => {
                  switchTo('login')
                  form.reset({ email: inbox(), password: '' })
                  setStage('form')
                }}
              />
            )
          }
        >
          <FormNotice form={form} testId="login-error" />
          {/* The refused sign-in may be an account that is not confirmed yet: the way to its link. */}
          <Show when={mode() === 'login' && form.notice() === SIGN_IN_REFUSED}>
            <p style={{ margin: '-4px 0 12px' }}>
              <button
                type="button"
                data-test-id="send-confirm-link"
                onClick={sendConfirmLink}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--primary)',
                  'font-weight': 600,
                  'font-size': '13px',
                }}
              >
                Send the link again
              </button>
            </p>
          </Show>

          <form
            {...form.attrs}
            onSubmit={(event) => {
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
            <Show when={mode() !== 'confirm'}>
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
            </Show>
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
              busyLabel={
                mode() === 'register'
                  ? 'Creating your account…'
                  : mode() === 'confirm'
                    ? 'Sending…'
                    : 'Signing in…'
              }
              class={styles.btnSubmit}
              style={{ width: '100%', 'justify-content': 'center' }}
            >
              {mode() === 'register'
                ? 'Create account'
                : mode() === 'confirm'
                  ? 'Send the link again'
                  : 'Sign in'}
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
            <Show when={mode() !== 'confirm'}>
              {mode() === 'login' ? "Don't have an account? " : 'Already have an account? '}
            </Show>
            <a
              onClick={() => {
                switchTo(mode() === 'login' ? 'register' : 'login')
              }}
              style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
            >
              {mode() === 'login'
                ? 'Create one'
                : mode() === 'confirm'
                  ? 'Back to sign in'
                  : 'Sign in'}
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
