import { createSignal, Show } from 'solid-js'
import { api } from '../core/api'
import { createCaptchaGate } from './captchaGate'
import { createForm, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { SIGN_IN_FAILED } from './signInForm'
import styles from './SignInSteps.module.css'
import Turnstile, { captchaIsStuck, captchaStatusMessage, turnstileEnabled } from './Turnstile'

/**
 * Check your inbox: what the sign-in screen and the sign-in dialog show once an account is
 * created, and once the confirm link is asked for again. A password account signs in after its
 * address is confirmed, so nothing here signs in. It reads the same whether or not the address
 * already had an account: the Worker answered both the same, and an address with an account gets
 * a notice instead of a link.
 *
 * "Send the link again" asks for a fresh confirm link, signed out (POST
 * /api/auth/verify-email/resend), behind the captcha. A limit reached and a request the captcha
 * stopped are said in the notice (captchaGate.ts).
 */
export default function CheckInbox(props: { email: string; onBack: () => void }) {
  // Its own widget: the form that sent the address is gone, and its token with it.
  const captcha = createCaptchaGate()
  const [sentAgain, setSentAgain] = createSignal(false)

  const resend = createForm<{ email: string }>({
    initial: { email: props.email },
    check: () => ({}),
    send: async (values) => {
      setSentAgain(false)
      try {
        await api.resendConfirmLink(values.email, await captcha.next())
      } catch (error) {
        throw captcha.explain(error)
      } finally {
        captcha.spent()
      }
    },
    saved: () => setSentAgain(true),
    failure: SIGN_IN_FAILED,
  })

  return (
    <div data-test-id="check-inbox">
      <p class={styles.lead}>
        We sent a link to <strong data-test-id="check-inbox-address">{props.email}</strong>. Open
        it, then sign in to start using Token Circles.
      </p>
      <FormNotice form={resend} testId="check-inbox-error" />
      <Show when={sentAgain()}>
        <p class={styles.lead} role="status" data-test-id="check-inbox-sent">
          If that address is waiting for its link, a new one is on its way.
        </p>
      </Show>
      <form {...resend.attrs}>
        <Turnstile
          appearance="interaction-only"
          onToken={captcha.onToken}
          onStatus={captcha.onStatus}
        />
        <Show
          when={
            turnstileEnabled &&
            resend.submitting() &&
            !captcha.token() &&
            !captchaIsStuck(captcha.status())
          }
        >
          <div data-test-id="captcha-hint" class={styles.hint}>
            {captchaStatusMessage(captcha.status())}
          </div>
        </Show>
        <SubmitButton
          data-test-id="check-inbox-resend"
          busy={resend.submitting()}
          busyLabel="Sending…"
          class={`${layoutStyles.btn} ${layoutStyles.btnSecondary} ${styles.submit}`}
        >
          Send the link again
        </SubmitButton>
        <p class={styles.links}>
          <button
            type="button"
            data-test-id="check-inbox-back"
            class={`${styles.link} ${styles.linkQuiet}`}
            onClick={() => {
              props.onBack()
            }}
          >
            Back to sign in
          </button>
        </p>
      </form>
    </div>
  )
}
