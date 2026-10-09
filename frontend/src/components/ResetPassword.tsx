import { createSignal, onMount, Show } from 'solid-js'
import { resetPasswordProblems, SIGN_IN_MESSAGES } from '../../../shared/signInSchema'
import { markAccessCleared } from '../core/accessCleared'
import { api } from '../core/api'
import { ApiError } from '../core/apiError'
import { setStorageMode } from '../core/storage/storageFactory'
import { createForm, Field, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { SIGN_IN_FAILED } from './signInForm'
import styles from './SignInSteps.module.css'
import SupportContact from './SupportContact'
import type { FieldErrors } from '../../../shared/refusal'

/**
 * Full-page "set a new password" screen, reached from the magic link in a reset email
 * (#reset-password?token=…). Validates the token up front, then lets the user pick a new
 * password; the worker deliberately does not sign them in, so on success we drop into
 * server mode and reload onto the sign-in screen.
 *
 * A kit form: a password shorter than 8 characters, and a second entry that differs from the
 * first, are marked under their fields before anything is sent. A link that stopped working while
 * the page was open (spent elsewhere, or expired) shows the same screen as one that never worked,
 * which says to ask for a new one.
 */
function tokenFromHash(): string {
  const hash = window.location.hash.slice(1) // e.g. "reset-password?token=abc"
  const qs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  return new URLSearchParams(qs).get('token') ?? ''
}

interface NewPassword {
  password: string
  confirm: string
}

/** What a send led to: the password is set, or the link no longer works. */
type ResetOutcome = 'done' | 'link-gone'

export default function ResetPassword() {
  const token = tokenFromHash()
  const [status, setStatus] = createSignal<'checking' | 'ready' | 'invalid' | 'done'>('checking')

  onMount(async () => {
    if (!token) {
      setStatus('invalid')
      return
    }
    // A reset is for an account on the server, and the link often opens in a browser that starts
    // local-first. Account mode from here, as Sign In switches it, so the check and the new
    // password reach the server. The device's local data is not touched.
    setStorageMode('self-hosted')
    try {
      setStatus((await api.validateResetToken(token)) ? 'ready' : 'invalid')
    } catch {
      setStatus('invalid')
    }
  })

  const form = createForm<NewPassword, ResetOutcome>({
    initial: { password: '', confirm: '' },
    check: (values): FieldErrors => ({
      ...resetPasswordProblems(values),
      ...(values.confirm === values.password ? {} : { confirm: SIGN_IN_MESSAGES.confirmPassword }),
    }),
    send: async (values) => {
      try {
        const { cleared } = await api.resetPassword(token, values.password)
        // The sign-in screen this reloads onto says what else the reset cleared.
        if (cleared) markAccessCleared('reset')
        return 'done'
      } catch (error) {
        // A refusal that names no field is about the link: it was spent or it expired.
        const aboutTheLink =
          error instanceof ApiError &&
          error.status === 400 &&
          Object.keys(error.fields).length === 0
        if (aboutTheLink) return 'link-gone'
        throw error
      }
    },
    saved: (outcome) => {
      if (outcome === 'link-gone') {
        setStatus('invalid')
        return
      }
      setStatus('done')
      // A reset only makes sense for a server account — land in server mode at the sign-in
      // screen. The worker no longer auto-logs-in, so the user signs in with the new password.
      setStorageMode('self-hosted')
      setTimeout(() => {
        window.location.hash = ''
        window.location.reload()
      }, 1200)
    },
    failure: SIGN_IN_FAILED,
  })

  const goToLogin = () => {
    window.location.hash = ''
    window.location.reload()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        padding: '24px',
        background: 'var(--bg, #0b0e14)',
        'overflow-y': 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          'max-width': '360px',
          padding: '32px',
          'border-radius': '16px',
          background: 'var(--surface, #151a23)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          'text-align': 'center',
        }}
      >
        <h1 style={{ 'font-size': '28px', 'font-weight': 700, margin: '0 0 16px' }}>
          Finance<span style={{ color: 'var(--primary)' }}>.</span>
        </h1>

        <Show when={status() === 'checking'}>
          <p style={{ color: 'var(--text-secondary)', 'font-size': '14px' }}>
            Checking your reset link…
          </p>
        </Show>

        <Show when={status() === 'invalid'}>
          <p style={{ color: 'var(--text-secondary)', 'font-size': '14px', margin: '0 0 16px' }}>
            This reset link is invalid or has expired. Request a new one from the sign-in screen.
          </p>
          <button
            class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
            style={{ width: '100%', 'justify-content': 'center' }}
            onClick={goToLogin}
            type="button"
          >
            Back to sign in
          </button>
        </Show>

        <Show when={status() === 'done'}>
          <p style={{ color: 'var(--text-secondary)', 'font-size': '14px' }}>
            Password updated. Redirecting to sign in…
          </p>
        </Show>

        <Show when={status() === 'ready'}>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
            Choose a new password.
          </p>
          <FormNotice form={form} testId="reset-error" />
          <form {...form.attrs}>
            <Field
              form={form}
              name="password"
              label="New password"
              class={styles.field}
              labelClass={styles.label}
            >
              {(control) => (
                <input
                  {...control}
                  type="password"
                  value={form.values.password}
                  onInput={(e) => form.set('password', e.currentTarget.value)}
                  autocomplete="new-password"
                  class={styles.input}
                />
              )}
            </Field>
            <Field
              form={form}
              name="confirm"
              label="Confirm new password"
              class={styles.field}
              labelClass={styles.label}
            >
              {(control) => (
                <input
                  {...control}
                  type="password"
                  value={form.values.confirm}
                  onInput={(e) => form.set('confirm', e.currentTarget.value)}
                  autocomplete="new-password"
                  class={styles.input}
                />
              )}
            </Field>
            <SubmitButton
              busy={form.submitting()}
              busyLabel="Setting your password…"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary} ${styles.submit}`}
            >
              Set new password
            </SubmitButton>
          </form>
          <button
            onClick={goToLogin}
            type="button"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              'font-size': '13px',
              'text-decoration': 'underline',
              'margin-top': '12px',
            }}
          >
            Back to sign in
          </button>
        </Show>

        <div style={{ 'margin-top': '18px', 'text-align': 'center' }}>
          <SupportContact label="Didn't get the email? Contact support" />
        </div>
      </div>
    </div>
  )
}
