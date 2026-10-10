import { createSignal, Show } from 'solid-js'
import { SIGN_IN_MESSAGES } from '../../../shared/signInSchema'
import { api } from '../core/api'
import { createForm, Field, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { reloadIntoTheApp, SIGN_IN_FAILED } from './signInForm'
import styles from './SignInSteps.module.css'
import type { FieldErrors } from '../../../shared/refusal'

/**
 * The second sign-in step for accounts with 2FA. The password (or Google) step already parked a
 * short-lived challenge cookie; posting a valid authenticator or recovery code trades it for the
 * real session, then a reload lets the app re-check /auth/me exactly like every other login path.
 *
 * A kit form: a code left empty is marked before anything is sent, and a code the Worker does not
 * take is marked at the field. A sign-in that expired, and a limit reached, are said in the form's
 * notice: neither is the code's fault.
 */
/**
 * Drop the ?twofa=1 marker the Google callback appends — on success AND on backing out.
 * A saved or reloaded URL that still carries it would reopen the code screen for a
 * challenge cookie that expired long ago, an unwinnable dead end.
 */
function stripTwofaMarker(): void {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has('twofa')) {
      url.searchParams.delete('twofa')
      window.history.replaceState(null, '', url.toString())
    }
  } catch {
    // Nothing to clean when the URL isn't available (tests stub location).
  }
}

export default function TwofaChallenge(props: { onBack?: () => void }) {
  const [mode, setMode] = createSignal<'totp' | 'recovery'>('totp')

  const form = createForm<{ code: string }>({
    initial: { code: '' },
    check: (values): FieldErrors =>
      values.code.trim() === ''
        ? {
            code: mode() === 'totp' ? SIGN_IN_MESSAGES.appCode : SIGN_IN_MESSAGES.recoveryCode,
          }
        : {},
    send: async (values) => {
      await api.verifySecondFactor(values.code.trim())
      stripTwofaMarker()
      return reloadIntoTheApp()
    },
    failure: SIGN_IN_FAILED,
  })

  const switchMode = (next: 'totp' | 'recovery') => {
    setMode(next)
    form.reset()
  }

  return (
    <>
      <p class={styles.lead}>
        {mode() === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of the recovery codes you saved when enabling two-factor authentication. Each works once.'}
      </p>
      <FormNotice form={form} testId="twofa-error" />
      <form {...form.attrs}>
        <Field
          form={form}
          name="code"
          label={mode() === 'totp' ? 'Authentication code' : 'Recovery code'}
          class={styles.field}
          labelClass={styles.label}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              data-test-id="twofa-code"
              placeholder={mode() === 'totp' ? '123456' : 'XXXXX-XXXXX'}
              value={form.values.code}
              onInput={(e) => form.set('code', e.currentTarget.value)}
              autocomplete="one-time-code"
              inputmode={mode() === 'totp' ? 'numeric' : 'text'}
              maxlength={mode() === 'totp' ? 6 : 12}
              autofocus
              class={`${styles.input} ${mode() === 'totp' ? styles.code : styles.recovery}`}
            />
          )}
        </Field>
        <SubmitButton
          data-test-id="twofa-submit"
          busy={form.submitting()}
          busyLabel="Checking…"
          class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
        >
          Verify
        </SubmitButton>
        {/* Buttons, not onClick-only anchors: the recovery path is the only way in for someone
            whose phone is gone, so it must be in the tab order and visible to assistive tech. */}
        <p class={styles.links}>
          <Show
            when={mode() === 'totp'}
            fallback={
              <button
                type="button"
                data-test-id="twofa-use-totp"
                class={styles.link}
                onClick={() => {
                  switchMode('totp')
                }}
              >
                Use an authenticator code instead
              </button>
            }
          >
            <button
              type="button"
              data-test-id="twofa-use-recovery"
              class={styles.link}
              onClick={() => {
                switchMode('recovery')
              }}
            >
              Lost your device? Use a recovery code
            </button>
          </Show>
        </p>
        <Show when={props.onBack}>
          <p class={styles.links}>
            <button
              type="button"
              data-test-id="twofa-back"
              class={`${styles.link} ${styles.linkQuiet}`}
              onClick={() => {
                stripTwofaMarker()
                props.onBack?.()
              }}
            >
              Back to sign in
            </button>
          </p>
        </Show>
      </form>
    </>
  )
}
