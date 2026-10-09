import { createEffect, createSignal, Show } from 'solid-js'
import { addressProblems, SIGN_IN_MESSAGES } from '../../../shared/signInSchema'
import { markAccessCleared } from '../core/accessCleared'
import { api } from '../core/api'
import { createCaptchaGate } from './captchaGate'
import { createForm, Field, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { reloadIntoTheApp, SIGN_IN_FAILED } from './signInForm'
import styles from './SignInSteps.module.css'
import Turnstile, { captchaIsStuck, captchaStatusMessage, turnstileEnabled } from './Turnstile'
import type { FieldErrors } from '../../../shared/refusal'

/**
 * Passwordless sign-in: ask the worker to mail a 6-digit code, then trade it for a session.
 * The endpoint answers the same neutral ok whether or not the address has an account, so the
 * code step always follows a send — no branch here may reveal what the server refused to.
 * A 2FA account still gets the authenticator challenge after the code (via onTwofa).
 *
 * Both steps are kit forms. An address that is not one, or a code left empty, is said under its
 * field before anything is sent; a code the Worker does not take is said under the code field, in
 * one answer for a wrong, spent or expired code. A limit reached and a request the captcha stopped
 * are said in the form's notice (captchaGate.ts).
 */
export default function EmailCodeLogin(props: {
  email?: string
  onBack: () => void
  onTwofa: () => void
}) {
  const [step, setStep] = createSignal<'request' | 'verify'>('request')
  // The widget shows here; the send waits for its token rather than the button waiting for it.
  const captcha = createCaptchaGate()

  const request = createForm<{ email: string }>({
    // The address the screen had when this step opened.
    initial: { email: props.email ?? '' },
    check: (values) => addressProblems(values),
    send: async (values) => {
      try {
        await api.requestEmailCode(values.email.trim(), await captcha.next())
      } catch (error) {
        throw captcha.explain(error)
      } finally {
        captcha.spent()
      }
    },
    saved: () => {
      code.reset()
      setStep('verify')
    },
    failure: SIGN_IN_FAILED,
  })

  const code = createForm<{ code: string }, 'second-factor'>({
    initial: { code: '' },
    check: (values): FieldErrors =>
      values.code.trim() === '' ? { code: SIGN_IN_MESSAGES.emailCode } : {},
    send: async (values): Promise<'second-factor'> => {
      const answer = await api.verifyEmailCode(request.values.email.trim(), values.code.trim())
      // Inbox proven, but the account wants the authenticator too: hand over.
      if (answer.twofaRequired) return 'second-factor'
      // Confirming the address cleared the account: the app says what, after the reload.
      if (answer.cleared) markAccessCleared('sign-in')
      return reloadIntoTheApp()
    },
    saved: () => {
      props.onTwofa()
    },
    failure: SIGN_IN_FAILED,
  })

  // The verify form replaces the request form wholesale, dropping focus on <body>; put it on
  // the code field the user is about to type into.
  let codeInput: HTMLInputElement | undefined
  createEffect(() => {
    if (step() === 'verify') codeInput?.focus()
  })

  return (
    <Show
      when={step() === 'verify'}
      fallback={
        <>
          <p class={styles.lead}>
            No password needed. We'll email you a 6-digit code that signs you in.
          </p>
          <FormNotice form={request} testId="emailcode-error" />
          <form {...request.attrs}>
            <Field
              form={request}
              name="email"
              label="Email address"
              class={styles.field}
              labelClass={styles.label}
            >
              {(control) => (
                <input
                  {...control}
                  type="email"
                  data-test-id="emailcode-email"
                  value={request.values.email}
                  onInput={(e) => request.set('email', e.currentTarget.value)}
                  autocomplete="username"
                  class={styles.input}
                />
              )}
            </Field>
            <Turnstile onToken={captcha.onToken} onStatus={captcha.onStatus} />
            {/* The ordinary "not solved yet" hint, which also says why a send is waiting.
                Turnstile draws its own panel for the states the user must fix. */}
            <Show when={turnstileEnabled && !captcha.token() && !captchaIsStuck(captcha.status())}>
              <div data-test-id="captcha-hint" class={styles.hint}>
                {captchaStatusMessage(captcha.status())}
              </div>
            </Show>
            <SubmitButton
              data-test-id="emailcode-send"
              busy={request.submitting()}
              busyLabel="Sending…"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
            >
              Email me a code
            </SubmitButton>
            <p class={styles.links}>
              <button
                type="button"
                data-test-id="emailcode-back"
                class={`${styles.link} ${styles.linkQuiet}`}
                onClick={() => {
                  props.onBack()
                }}
              >
                Back to sign in
              </button>
            </p>
          </form>
        </>
      }
    >
      <p class={styles.lead}>
        If <strong>{request.values.email.trim()}</strong> has an account, a 6-digit code is on its
        way. Enter it below. It expires in 10 minutes.
      </p>
      <FormNotice form={code} testId="emailcode-error" />
      <form {...code.attrs}>
        <Field
          form={code}
          name="code"
          label="Code from the email"
          class={styles.field}
          labelClass={styles.label}
        >
          {(control) => (
            <input
              {...control}
              ref={codeInput}
              type="text"
              data-test-id="emailcode-code"
              placeholder="123456"
              value={code.values.code}
              onInput={(e) => code.set('code', e.currentTarget.value)}
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength={6}
              class={`${styles.input} ${styles.code}`}
            />
          )}
        </Field>
        <SubmitButton
          data-test-id="emailcode-verify"
          busy={code.submitting()}
          busyLabel="Checking…"
          class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
        >
          Sign in
        </SubmitButton>
        <p class={styles.links}>
          Nothing arrived?{' '}
          <button
            type="button"
            data-test-id="emailcode-resend"
            class={styles.link}
            onClick={() => {
              request.reset({ ...request.values })
              setStep('request')
            }}
          >
            Send another
          </button>
        </p>
      </form>
    </Show>
  )
}
