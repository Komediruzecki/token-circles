import { createSignal, Match, onMount, Switch } from 'solid-js'
import { SIGN_IN_MESSAGES } from '../../../shared/signInSchema'
import { api } from '../core/api'
import { ApiError } from '../core/apiError'
import { clearLinkWaiting, linkWaiting, noteAddressConfirmed } from '../core/emailVerification'
import CaptchaCheck from './CaptchaCheck'
import { createCaptchaGate } from './captchaGate'
import { createForm, Field, FormNotice, NOT_SENT, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { reloadIntoTheApp, SIGN_IN_FAILED } from './signInForm'
import styles from './SignInSteps.module.css'
import type { FieldErrors } from '../../../shared/refusal'
import type { SignInMode } from './signInForm'

/** Said when the password does not sign in to the account the link waits for. */
export const FINISH_REFUSED = "That password didn't work. Try again, or reset it."

/** Said when nothing waits for this page anymore: the link was used, replaced, or ran out here. */
export const FINISH_GONE =
  "This link can't finish here anymore. Open the newest link in your email, or send a fresh one."

/**
 * Finish signing up: the sign-in screen's step for a confirm link opened signed out, in a browser
 * the link does not sign in by itself (another browser, another device, or later than the sign-up
 * marker lasts; shared/confirmLinkSignIn.ts).
 *
 * The Worker left the link unspent, with a marker in this browser that scripts cannot read
 * (worker/src/email-link.ts), and says which address it waits for (GET /api/auth/email-link). The
 * page names that address and asks for its password. The sign-in it sends is the ordinary one
 * (POST /api/auth/login), which spends the link it finds in the marker: it confirms the address
 * and signs in, or asks for the second factor first (TwofaChallenge, through onTwofa).
 *
 * - A password the Worker does not take is said for the whole form, unless the link stopped
 *   waiting meanwhile (used in another browser, replaced by a newer one, run out): then the page
 *   says it can't finish here, with the way to a fresh link.
 * - A page left open longer than the marker lasts sends nothing, and says the same.
 * - With no answer about the link (offline, a limit reached), the screen goes back to its sign-in
 *   form, which finishes the link as well (onUnavailable).
 */
export default function FinishSignUp(props: {
  /** The address the link waits for: the sign-in form keeps it for every way back. */
  onAddress: (email: string) => void
  /** Another way in, with the address kept: the sign-in, a reset link, or a fresh confirm link. */
  onLeave: (to: Extract<SignInMode, 'login' | 'forgot' | 'confirm'>) => void
  onTwofa: () => void
  onUnavailable: () => void
}) {
  const [state, setState] = createSignal<'checking' | 'ready' | 'gone'>('checking')
  // The check solved for a wrong password covers the next tries, as on the sign-in form.
  const captcha = createCaptchaGate({ signingIn: () => true })

  const nothingWaits = () => {
    clearLinkWaiting()
    setState('gone')
  }

  /** Whether the link still waits; a check that fails to answer counts as yes. */
  const stillWaiting = async (): Promise<boolean> => {
    try {
      return (await api.confirmLinkWaiting()) !== null
    } catch {
      return true
    }
  }

  const form = createForm<{ email: string; password: string }, 'second-factor'>({
    initial: { email: '', password: '' },
    check: (values): FieldErrors =>
      values.password === '' ? { password: SIGN_IN_MESSAGES.password } : {},
    blocked: captcha.asking,
    send: async (values): Promise<'second-factor'> => {
      // The marker this page finishes the link with has run out: nothing it sends can finish it.
      if (linkWaiting() === null) {
        nothingWaits()
        throw NOT_SENT
      }
      let token: string | undefined
      try {
        token = await captcha.next()
        let login: Awaited<ReturnType<typeof api.loginWithPassword>>
        try {
          login = await api.loginWithPassword(values.email, values.password, token)
        } catch (error) {
          // As on the sign-in form (signInForm.ts): a try that went out on the cover alone goes
          // again with the next token when the Worker asks for the check.
          if (!captcha.checkAgain(error, token)) throw error
          token = await captcha.next()
          login = await api.loginWithPassword(values.email, values.password, token)
        }
        captcha.signedIn()
        if (login?.emailConfirmed) noteAddressConfirmed()
        if (login?.twofaRequired) return 'second-factor'
        return await reloadIntoTheApp()
      } catch (error) {
        const explained = captcha.explain(error, token)
        if (!(explained instanceof ApiError) || explained.status !== 401) throw explained
        if (!(await stillWaiting())) {
          nothingWaits()
          throw NOT_SENT
        }
        throw new ApiError(401, FINISH_REFUSED)
      }
    },
    saved: () => {
      props.onTwofa()
    },
    failure: SIGN_IN_FAILED,
  })

  // Which address the link waits for, if it still waits.
  onMount(() => {
    void api
      .confirmLinkWaiting()
      .then((waiting) => {
        if (waiting === null) {
          nothingWaits()
          return
        }
        form.reset({ email: waiting.email, password: '' })
        props.onAddress(waiting.email)
        setState('ready')
      })
      .catch(() => {
        props.onUnavailable()
      })
  })

  return (
    <div data-test-id="finish-signup">
      <Switch>
        <Match when={state() === 'checking'}>
          <p class={styles.lead} role="status" data-test-id="finish-signup-checking">
            Checking the link…
          </p>
        </Match>
        <Match when={state() === 'gone'}>
          <p class={styles.lead} role="status" data-test-id="finish-signup-gone">
            {FINISH_GONE}
          </p>
          <p class={styles.links}>
            <button
              type="button"
              data-test-id="finish-signup-send-again"
              class={styles.link}
              onClick={() => {
                props.onLeave('confirm')
              }}
            >
              Send the link again
            </button>
          </p>
          <p class={styles.links}>
            <button
              type="button"
              data-test-id="finish-signup-back"
              class={`${styles.link} ${styles.linkQuiet}`}
              onClick={() => {
                props.onLeave('login')
              }}
            >
              Back to sign in
            </button>
          </p>
        </Match>
        <Match when={state() === 'ready'}>
          <p class={styles.lead} data-test-id="finish-signup-lead">
            Enter the password you chose for{' '}
            <strong data-test-id="finish-signup-address">{form.values.email}</strong>. That confirms
            the address and signs you in.
          </p>
          <FormNotice form={form} testId="finish-signup-error" />
          <form
            {...form.attrs}
            onSubmit={(event) => {
              // While Cloudflare's box waits for a tick there is no submit.
              if (captcha.asking()) {
                event.preventDefault()
                return
              }
              void form.submit(event)
            }}
          >
            <Field
              form={form}
              name="email"
              id="finish-signup-email"
              label="Email address"
              class={styles.field}
              floating
            >
              {(control) => (
                <input
                  {...control}
                  type="email"
                  name="email"
                  readOnly
                  value={form.values.email}
                  // The address the link waits for: a password manager pairs the password with it.
                  autocomplete="username"
                  class={styles.input}
                />
              )}
            </Field>
            <Field
              form={form}
              name="password"
              id="finish-signup-password"
              label="Password"
              class={styles.field}
              floating
              reveal
            >
              {(control) => (
                <input
                  {...control}
                  name="password"
                  value={form.values.password}
                  onInput={(e) => form.set('password', e.currentTarget.value)}
                  autocomplete="current-password"
                  class={styles.input}
                />
              )}
            </Field>
            <CaptchaCheck gate={captcha} hintClass={styles.hint} />
            <SubmitButton
              data-test-id="finish-signup-submit"
              busy={form.submitting()}
              blocked={captcha.asking()}
              aria-describedby={captcha.asking() ? captcha.hintId : undefined}
              busyLabel={captcha.busyLabel('Signing in…')}
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
            >
              Confirm and sign in
            </SubmitButton>
          </form>
          <p class={styles.links}>
            <button
              type="button"
              data-test-id="finish-signup-forgot"
              class={styles.link}
              onClick={() => {
                props.onLeave('forgot')
              }}
            >
              Forgot your password?
            </button>
          </p>
          <p class={styles.hint} data-test-id="finish-signup-not-you">
            Not your sign-up? Close this page and nothing changes.
          </p>
        </Match>
      </Switch>
    </div>
  )
}
