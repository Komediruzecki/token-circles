import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { takeAccessClearedNotice } from '../core/accessCleared'
import { api } from '../core/api'
import { displayVersion } from '../core/appVersion'
import { linkWaiting, takeConfirmLinkProblem } from '../core/emailVerification'
import { FORGOT_PASSWORD, hashRouteName } from '../core/hashRoute'
import { afterHistoryStep, createHistoryStep } from '../core/historyStep'
import { setStorageMode } from '../core/storage/storageFactory'
import {
  conditionalMediationAvailable,
  markPasskeyNudgeAfterLogin,
  passkeysSupported,
  signInWithPasskey,
} from '../core/webauthn'
import CaptchaCheck from './CaptchaCheck'
import { createCaptchaGate } from './captchaGate'
import CheckInbox from './CheckInbox'
import EmailCodeLogin from './EmailCodeLogin'
import FinishSignUp from './FinishSignUp'
import { Field, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import LegalLinks from './LegalLinks'
import styles from './LoginScreen.module.css'
import { LogoMark } from './Logo'
import { createSignInForm, RESET_LINK_SENT, SIGN_IN_REFUSED } from './signInForm'
import SupportContact from './SupportContact'
import TwofaChallenge from './TwofaChallenge'
import type { SignInMode, SignInOutcome } from './signInForm'

/**
 * Full-page sign-in gate, shown in server (self-hosted) mode when there's no valid session.
 * Offers email/password (register + login), Google sign-in, and a no-account demo that drops
 * into client-only mode. Client-only mode itself never renders this.
 *
 * The password form is on the form kit (signInForm.ts): a field that is wrong is said under it,
 * and a wrong address or password is one message for the whole form. That message also covers an
 * account whose address is not confirmed yet, and offers to send the confirm link again. Creating
 * an account, or sending the link again, ends on Check your inbox (CheckInbox), not in the app.
 *
 * A confirm link opened here signed out, which did not sign in by itself, opens the screen on
 * Finish signing up (FinishSignUp): which address it waits for, as k•••@example.com, and fields
 * for that address and its password.
 */
/**
 * Every way out of the screen reloads, and a reload keeps the current history entry: a step's entry
 * (historyStep.ts) still on its way back goes first, or the app would start on it.
 */
function reloadPage() {
  afterHistoryStep(() => {
    window.location.reload()
  })
}

/** What the form says while a confirm link opened here waits for its account to sign in. */
const CONFIRM_BY_SIGNING_IN = 'Sign in to confirm your address.'

export default function LoginScreen() {
  // #forgot-password opens the screen on the form that sends a reset link: the Reset password
  // button of the "already has an account" mail links there.
  const forgotInHash = () => hashRouteName(window.location.hash) === FORGOT_PASSWORD
  const [mode, setMode] = createSignal<SignInMode>(forgotInHash() ? 'forgot' : 'login')
  // What the screen says that is not a problem with the form: a reset link on its way, or a link
  // from an email waiting for this sign-in.
  const [notice, setNotice] = createSignal('')
  // A way in other than the form that failed (a passkey). The form's own problems are its notice.
  const [elsewhere, setElsewhere] = createSignal('')
  // A confirm link opened in this browser that did not confirm: why, with the way to a fresh one.
  const [linkProblem, setLinkProblem] = createSignal('')
  // 'inbox' is Check your inbox, for the address `inbox` holds; 'twofa' is the second factor's code
  // step; 'email-code' is passwordless sign-in; 'finish' finishes a sign-up whose confirm link was
  // opened here.
  const [stage, setStage] = createSignal<'form' | 'inbox' | 'twofa' | 'email-code' | 'finish'>(
    'form'
  )
  const [inbox, setInbox] = createSignal('')

  // The Google callback can't stop for a code mid-redirect, so the worker parks the challenge
  // cookie and sends the browser back with ?twofa=1 — land straight on the code step.
  onMount(() => {
    if (new URLSearchParams(window.location.search).get('twofa') === '1') setStage('twofa')
  })

  // A reset that also confirmed the address reloads onto this screen with what else it removed.
  onMount(() => {
    const words = takeAccessClearedNotice('sign-in-screen')
    if (words !== null) setNotice(words)
  })

  // A confirm link opened in this browser that had expired, or had been used or replaced, comes
  // back here signed out: nothing else would say why it did not confirm.
  onMount(() => {
    const problem = takeConfirmLinkProblem()
    if (problem !== null) setLinkProblem(problem)
  })

  // A link from an email, opened in this browser before signing in: signing in here finishes it
  // (VerifyEmailBanner asks the worker once the app is signed in). A confirm link opens on the
  // step that shows which address it is for and asks for the address and password (FinishSignUp).
  onMount(() => {
    const waiting = linkWaiting()
    if (!waiting) return
    if (waiting.change) setNotice('Sign in to finish changing your address.')
    else setStage('finish')
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
            if (result.ok) reloadPage()
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
  // on a token: the send holds for one instead. While Cloudflare's box waits for a tick, the
  // button waits too (captchaGate.ts). After a wrong password the check solved for it covers the
  // next sign-in tries, and only those.
  const captcha = createCaptchaGate({ signingIn: () => mode() === 'login' })

  const saved = (outcome: SignInOutcome) => {
    if (outcome.kind === 'second-factor') setStage('twofa')
    else if (outcome.kind === 'reset-link-sent') setNotice(RESET_LINK_SENT)
    else {
      setInbox(outcome.email)
      setStage('inbox')
    }
  }

  const form = createSignInForm({ mode, captcha, saved })

  // Each step's way back to the form: its own Back button, and the back gesture (below).
  const leaveTwofa = () => {
    setStage('form')
    form.reset({ email: form.values.email, password: '' })
  }
  const leaveEmailCode = () => {
    setStage('form')
  }
  const leaveInbox = () => {
    switchTo('login')
    form.reset({ email: inbox(), password: '' })
    setStage('form')
  }
  // From Finish signing up, with the address typed there in the form (FinishSignUp's onAddress).
  // Back on the sign-in form, a link that still waits is finished by signing in there, which the
  // notice says.
  const leaveFinish = (to: 'login' | 'forgot' | 'confirm' = 'login') => {
    switchTo(to)
    setStage('form')
    if (to === 'login' && linkWaiting()) setNotice(CONFIRM_BY_SIGNING_IN)
  }

  // The steps after the form are in memory only, so in an installed app the back gesture had no
  // entry to pop and closed the app. One history entry while any step is on screen; popping it is
  // that step's Back. The second factor the Google callback lands on keeps ?twofa=1 on its own
  // entry only, so the form under it does not reopen the step on a reload.
  createHistoryStep({
    active: () => stage() !== 'form',
    back: () => {
      const now = stage()
      if (now === 'twofa') leaveTwofa()
      else if (now === 'email-code') leaveEmailCode()
      else if (now === 'inbox') leaveInbox()
      else if (now === 'finish') leaveFinish()
    },
    below: () => {
      try {
        const url = new URL(window.location.href)
        if (!url.searchParams.has('twofa')) return undefined
        url.searchParams.delete('twofa')
        return url.toString()
      } catch {
        return undefined
      }
    },
  })

  /** Another mode, or another way in: the values stay, and nothing from before is said or sent. */
  const switchTo = (next: SignInMode) => {
    // A send still holding for its token was for the mode left behind: it must never go out.
    captcha.cancel()
    // Leaving the reset form takes #forgot-password off the address, so that neither a reload nor
    // the app after signing in opens the form again. replaceState fires no hashchange.
    if (next !== 'forgot' && forgotInHash()) {
      history.replaceState(history.state, '', window.location.pathname + window.location.search)
    }
    setMode(next)
    setNotice('')
    setElsewhere('')
    setLinkProblem('')
    form.reset({ ...form.values })
  }

  // The address can change to #forgot-password with this screen open: a pasted link only moves
  // the fragment, and loads nothing.
  onMount(() => {
    const onHashChange = () => {
      if (forgotInHash() && mode() !== 'forgot') switchTo('forgot')
    }
    window.addEventListener('hashchange', onHashChange)
    onCleanup(() => {
      window.removeEventListener('hashchange', onHashChange)
    })
  })

  /** From the refused sign-in: send the confirm link to the address in the form, signed out. */
  const sendConfirmLink = () => {
    switchTo('confirm')
    void form.submit()
  }

  // Demo = client-only mode (seeded example profiles, no account). Switch storage mode to
  // serverless and reload; the gate won't render in that mode. Switch back in Settings.
  const tryDemo = () => {
    setStorageMode('serverless')
    reloadPage()
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
            {stage() === 'inbox'
              ? 'Check your inbox.'
              : stage() === 'finish'
                ? 'Finish signing up.'
                : stage() === 'twofa'
                  ? 'Two-factor authentication'
                  : stage() === 'email-code'
                    ? 'Sign in by email'
                    : mode() === 'register'
                      ? 'Create your account.'
                      : mode() === 'forgot'
                        ? 'Reset your password.'
                        : mode() === 'confirm'
                          ? 'Send the confirm link again.'
                          : 'Sign in to access your finances.'}
          </p>
        </div>

        <Show
          when={stage() === 'form'}
          fallback={
            stage() === 'twofa' ? (
              <TwofaChallenge onBack={leaveTwofa} />
            ) : stage() === 'finish' ? (
              <FinishSignUp
                onAddress={(email) => {
                  form.set('email', email)
                }}
                onLeave={leaveFinish}
                onTwofa={() => setStage('twofa')}
                onUnavailable={() => {
                  setStage('form')
                  setNotice(CONFIRM_BY_SIGNING_IN)
                }}
              />
            ) : stage() === 'email-code' ? (
              <EmailCodeLogin
                email={form.values.email}
                onBack={leaveEmailCode}
                onTwofa={() => setStage('twofa')}
              />
            ) : (
              <CheckInbox email={inbox()} onBack={leaveInbox} />
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

          <Show when={linkProblem()}>
            <div data-test-id="link-problem" role="status" class={styles.linkProblem}>
              <p class={styles.linkProblemText}>{linkProblem()}</p>
              <button
                type="button"
                data-test-id="link-problem-resend"
                class={styles.accountLink}
                onClick={() => {
                  switchTo('confirm')
                }}
              >
                Send the link again
              </button>
            </div>
          </Show>

          <FormNotice form={form} testId="login-error" />
          {/* The refused sign-in may be an account that is not confirmed yet: the way to its link. */}
          <Show when={mode() === 'login' && form.notice() === SIGN_IN_REFUSED}>
            <p class={styles.resendLine}>
              <button
                type="button"
                data-test-id="send-confirm-link"
                class={styles.accountLink}
                onClick={sendConfirmLink}
              >
                Send the link again
              </button>
            </p>
          </Show>

          <form
            class={styles.form}
            {...form.attrs}
            onSubmit={(event) => {
              // While Cloudflare's box waits for a tick there is no submit, so nothing is cleared.
              if (captcha.asking()) {
                event.preventDefault()
                return
              }
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
              floating
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

            <Show when={mode() !== 'forgot' && mode() !== 'confirm'}>
              <Field
                form={form}
                name="password"
                id="login-password"
                label="Password"
                class={styles.field}
                floating
                reveal
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
            <CaptchaCheck gate={captcha} hintClass={styles.captchaHint} />

            <SubmitButton
              busy={form.submitting()}
              blocked={captcha.asking()}
              aria-describedby={captcha.asking() ? captcha.hintId : undefined}
              busyLabel={captcha.busyLabel(
                mode() === 'register'
                  ? 'Creating your account…'
                  : mode() === 'forgot' || mode() === 'confirm'
                    ? 'Sending…'
                    : 'Signing in…'
              )}
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
            >
              {mode() === 'register'
                ? 'Create account'
                : mode() === 'forgot'
                  ? 'Send reset link'
                  : mode() === 'confirm'
                    ? 'Send the link again'
                    : 'Sign in'}
            </SubmitButton>
          </form>

          <Show when={mode() !== 'forgot' && mode() !== 'confirm'}>
            <div class={styles.divider}>or</div>

            <div class={styles.alts}>
              <button
                class={`${layoutStyles.btn} ${layoutStyles.btnSecondary} ${styles.altBtn}`}
                onClick={() => {
                  // sessionStorage survives the OAuth round-trip in this tab, so the post-login
                  // passkey nudge works for Google sign-ins too. A failed sign-in wastes the
                  // flag harmlessly — the nudge only renders for an authenticated session.
                  markPasskeyNudgeAfterLogin()
                  // Off to Google from the entry under any step's, so coming back has none to pop.
                  afterHistoryStep(() => {
                    api.loginWithGoogle()
                  })
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
                      if (result.ok) reloadPage()
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
              when={mode() !== 'forgot' && mode() !== 'confirm'}
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
