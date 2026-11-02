import { createSignal, Show } from 'solid-js'
import { CAPTCHA_ACTIONS } from '../../../shared/captchaActions'
import { whereTheLinkSignsIn } from '../../../shared/confirmLinkSignIn'
import { api } from '../core/api'
import CaptchaCheck from './CaptchaCheck'
import { createCaptchaGate } from './captchaGate'
import { createForm, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { SIGN_IN_FAILED } from './signInForm'
import styles from './SignInSteps.module.css'

/**
 * Check your inbox: what the sign-in screen and the sign-in dialog show once an account is
 * created, and once the confirm link is asked for again. A password account signs in after its
 * address is confirmed, so nothing here signs in. It reads the same whether or not the address
 * already had an account: the Worker answered both the same, and an address with an account gets
 * a notice instead of a link.
 *
 * It says where the link signs in (shared/confirmLinkSignIn.ts): opened soon enough in the browser
 * that signed up, it confirms the address and signs in by itself. Anywhere else, or later, it asks
 * for the password where it was opened (FinishSignUp), and a sign-in anywhere else is refused until
 * the address is confirmed.
 *
 * "Send the link again" asks for a fresh confirm link, signed out (POST
 * /api/auth/verify-email/resend), behind the captcha. A limit reached and a request the captcha
 * stopped are said in the notice (captchaGate.ts).
 *
 * With no mail at all, creating the account again is the other way: it makes the account when
 * the first sign-up did not, and mails a fresh link to one still waiting for it. That account
 * keeps the password it was created with, hence "the same password", and a sign-up with that
 * password leaves a marker this browser's link signs in with (worker/src/signup-marker.ts).
 */
export default function CheckInbox(props: { email: string; onBack: () => void }) {
  // Its own widget: the form that sent the address is gone, and its token with it.
  const captcha = createCaptchaGate()
  const [sentAgain, setSentAgain] = createSignal(false)

  const resend = createForm<{ email: string }>({
    initial: { email: props.email },
    check: () => ({}),
    blocked: captcha.asking,
    send: async (values) => {
      setSentAgain(false)
      let token: string | undefined
      try {
        token = await captcha.next()
        await api.resendConfirmLink(values.email, token)
      } catch (error) {
        throw captcha.explain(error, token)
      }
    },
    saved: () => setSentAgain(true),
    failure: SIGN_IN_FAILED,
  })

  return (
    <div data-test-id="check-inbox">
      <p class={styles.lead} data-test-id="check-inbox-lead">
        We sent a link to <strong data-test-id="check-inbox-address">{props.email}</strong>.{' '}
        {whereTheLinkSignsIn()}
      </p>
      <FormNotice form={resend} testId="check-inbox-error" />
      <Show when={sentAgain()}>
        <p class={styles.lead} role="status" data-test-id="check-inbox-sent">
          If {props.email} still needs confirming, a fresh link is on its way. Only the newest link
          works.
        </p>
      </Show>
      <form {...resend.attrs}>
        <CaptchaCheck gate={captcha} action={CAPTCHA_ACTIONS.confirmLink} hintClass={styles.hint} />
        <SubmitButton
          data-test-id="check-inbox-resend"
          busy={resend.submitting()}
          blocked={captcha.asking()}
          aria-describedby={captcha.asking() ? captcha.hintId : undefined}
          busyLabel={captcha.busyLabel('Sending…')}
          class={`${layoutStyles.btn} ${layoutStyles.btnSecondary} ${styles.submit}`}
        >
          Send the link again
        </SubmitButton>
        <p class={styles.hint} data-test-id="check-inbox-no-mail">
          No mail after a few minutes? Check your spam folder, or create the account again with the
          same password.
        </p>
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
