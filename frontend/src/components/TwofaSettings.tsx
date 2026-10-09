import { createSignal, For, onMount, Show } from 'solid-js'
import { renderSVG } from 'uqr'
import { SIGN_IN_MESSAGES } from '../../../shared/signInSchema'
import { toast } from '../core/api'
import { apiErrorFrom } from '../core/apiError'
import { apiFetch } from '../core/apiFetch'
import { createForm, Field, FormNotice, SubmitButton } from './form'
import layoutStyles from './Layout.module.css'
import { SIGN_IN_FAILED } from './signInForm'
import styles from './TwofaSettings.module.css'
import type { FieldErrors } from '../../../shared/refusal'

/**
 * Settings card for TOTP two-factor auth: enroll (shared secret + confirmation code), the
 * one-time recovery-codes reveal, and the disable flow — every state change demands a valid
 * code, so a walk-up attacker with an unlocked laptop cannot quietly switch 2FA off.
 *
 * The two code steps are kit forms: a code left empty is marked and focused before anything is
 * sent, and a code the Worker does not take is marked at the field, in its words. Anything else
 * the Worker says (no setup in progress, a limit reached) is the form's notice.
 */
type Status = { enabled: boolean; recoveryCodesLeft: number }

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = (await res.json().catch(() => ({}))) as unknown
  return { ok: res.ok, data }
}

const errorOf = (data: unknown, fallback: string) => (data as { error?: string })?.error || fallback

/** Posts a code step, and throws the Worker's refusal as an `ApiError` for the form to show. */
async function sendCode<T>(url: string, code: string): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw await apiErrorFrom(res)
  return (await res.json().catch(() => ({}))) as T
}

const required = (code: string, words: string): FieldErrors =>
  code.trim() === '' ? { code: words } : {}

export default function TwofaSettings() {
  const [status, setStatus] = createSignal<Status | null>(null)
  const [view, setView] = createSignal<'idle' | 'enroll' | 'codes' | 'disable'>('idle')
  const [secret, setSecret] = createSignal('')
  const [otpauth, setOtpauth] = createSignal('')
  const [recoveryCodes, setRecoveryCodes] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)

  const loadStatus = async () => {
    try {
      const res = await apiFetch('/api/auth/2fa/status')
      if (res.ok) setStatus((await res.json()) as Status)
    } catch {
      // The card renders a neutral state without status; nothing actionable to toast on mount.
    }
  }
  onMount(() => {
    void loadStatus()
  })

  const enrollForm = createForm<{ code: string }, string[]>({
    initial: { code: '' },
    check: (values) => required(values.code, SIGN_IN_MESSAGES.appCode),
    send: async (values) =>
      (await sendCode<{ recoveryCodes?: string[] }>('/api/auth/2fa/enable', values.code.trim()))
        .recoveryCodes ?? [],
    saved: (codes) => {
      setRecoveryCodes(codes)
      setView('codes')
      void loadStatus()
    },
    failure: SIGN_IN_FAILED,
  })

  const disableForm = createForm<{ code: string }>({
    initial: { code: '' },
    check: (values) => required(values.code, SIGN_IN_MESSAGES.secondFactor),
    send: (values) => sendCode('/api/auth/2fa/disable', values.code.trim()),
    saved: () => {
      toast('Two-factor authentication disabled', 'success')
      resetFlow()
      void loadStatus()
    },
    failure: SIGN_IN_FAILED,
  })

  const resetFlow = () => {
    enrollForm.reset()
    disableForm.reset()
    setView('idle')
  }

  const beginEnroll = async () => {
    setBusy(true)
    try {
      const { ok, data } = await postJson('/api/auth/2fa/setup')
      if (!ok) {
        toast(errorOf(data, 'Could not start 2FA setup'), 'error')
        return
      }
      const d = data as { secret: string; otpauthUri: string }
      setSecret(d.secret)
      setOtpauth(d.otpauthUri)
      enrollForm.reset()
      setView('enroll')
    } catch {
      toast('Network problem — try again', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyCodes = async () => {
    try {
      await window.navigator.clipboard.writeText(recoveryCodes().join('\n'))
      toast('Recovery codes copied', 'success')
    } catch {
      toast('Copy failed — select and copy them manually', 'error')
    }
  }

  // A file the user can drop somewhere safe — clipboard alone is unavailable in non-secure
  // contexts and pastes get lost; these codes are unrecoverable once this view unmounts.
  const downloadCodes = () => {
    const blob = new Blob(
      [
        `Token Circles recovery codes\nEach code signs you in once.\n\n${recoveryCodes().join('\n')}\n`,
      ],
      { type: 'text/plain' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'token-circles-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const codeInputStyle = {
    padding: '8px 10px',
    'border-radius': '8px',
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    background: 'var(--bg, #0b0e14)',
    color: 'var(--text, #e6e8eb)',
    'font-size': '14px',
    width: '140px',
  }
  const codeRow = { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } as const

  return (
    <div style={{ 'margin-top': '16px' }}>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          'font-weight': 600,
          'font-size': '14px',
        }}
      >
        Two-factor authentication
        <Show when={status()?.enabled}>
          <span
            data-test-id="twofa-enabled-badge"
            style={{
              'font-size': '11.5px',
              'font-weight': 600,
              padding: '2px 8px',
              'border-radius': '999px',
              color: 'var(--success, #22c55e)',
              border: '1px solid color-mix(in oklab, var(--success, #22c55e) 45%, transparent)',
              background: 'color-mix(in oklab, var(--success, #22c55e) 12%, transparent)',
            }}
          >
            Enabled
          </span>
        </Show>
      </div>

      {/* ── Disabled, idle: the pitch and the button ── */}
      <Show when={view() === 'idle' && status() && !status()!.enabled}>
        <p style={{ margin: '6px 0 10px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
          Protect sign-in with a 6-digit code from an authenticator app (Aegis, Google
          Authenticator, 1Password…) on top of your password.
        </p>
        <button
          data-test-id="twofa-enable-btn"
          class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
          disabled={busy()}
          onClick={() => void beginEnroll()}
        >
          Enable two-factor authentication
        </button>
      </Show>

      {/* ── Enabled, idle: status + disable ── */}
      <Show when={view() === 'idle' && status()?.enabled}>
        <p style={{ margin: '6px 0 10px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
          Signing in asks for an authenticator code. {status()!.recoveryCodesLeft} recovery
          {status()!.recoveryCodesLeft === 1 ? ' code remains' : ' codes remain'}. To get a fresh
          set, disable and re-enable.
        </p>
        <Show when={status()!.recoveryCodesLeft <= 3}>
          {/* The codes are the only way in after a lost authenticator; at zero the account is
              unrecoverable, so the countdown must get loud well before that. */}
          <p
            data-test-id="twofa-codes-low"
            style={{
              margin: '0 0 10px',
              padding: '8px 10px',
              'border-radius': '8px',
              border: '1px solid color-mix(in oklab, var(--danger, #ef4444) 45%, transparent)',
              background: 'color-mix(in oklab, var(--danger, #ef4444) 10%, transparent)',
              'font-size': '13px',
            }}
          >
            {status()!.recoveryCodesLeft === 0
              ? 'No recovery codes left — if you lose the authenticator now, this account cannot be recovered. Disable and re-enable two-factor to get a fresh set while you still can.'
              : 'Recovery codes are running low. Disable and re-enable two-factor to get a fresh set before they run out.'}
          </p>
        </Show>
        <button
          data-test-id="twofa-disable-btn"
          class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
          onClick={() => {
            disableForm.reset()
            setView('disable')
          }}
        >
          Disable…
        </button>
      </Show>

      {/* ── Enroll: secret + confirm ── */}
      <Show when={view() === 'enroll'}>
        <div style={{ margin: '8px 0 0', 'font-size': '13px', color: 'var(--text-secondary)' }}>
          <p style={{ margin: '0 0 8px' }}>1. Scan this with your authenticator app:</p>
          {/* Rendered locally by uqr — the shared secret must never leave the page, so no
              external QR image service is an option here. White backing keeps it scannable
              in dark mode. */}
          <div
            data-test-id="twofa-qr"
            style={{
              width: '176px',
              padding: '8px',
              'border-radius': '8px',
              background: '#ffffff',
              'line-height': 0,
            }}
            innerHTML={renderSVG(otpauth(), { border: 0, pixelSize: 4 })}
          />
          <p style={{ margin: '10px 0 8px' }}>
            On this device,{' '}
            <a
              data-test-id="twofa-otpauth"
              href={otpauth()}
              style={{ color: 'var(--primary)', 'font-weight': 600 }}
            >
              open it directly
            </a>
            , or enter this key manually:
          </p>
          <code
            data-test-id="twofa-secret"
            style={{
              display: 'block',
              padding: '8px 10px',
              'border-radius': '8px',
              background: 'var(--bg, #0b0e14)',
              border: '1px solid var(--border, rgba(255,255,255,0.12))',
              'font-size': '13px',
              'word-break': 'break-all',
              'user-select': 'all',
              color: 'var(--text, #e6e8eb)',
            }}
          >
            {secret()}
          </code>
          <FormNotice form={enrollForm} testId="twofa-error" />
          <form {...enrollForm.attrs}>
            <Field
              form={enrollForm}
              name="code"
              label="2. Enter the 6-digit code the app shows:"
              labelClass={styles.stepLabel}
            >
              {(control) => (
                <div style={codeRow}>
                  <input
                    {...control}
                    type="text"
                    data-test-id="twofa-enroll-code"
                    placeholder="123456"
                    value={enrollForm.values.code}
                    onInput={(e) => enrollForm.set('code', e.currentTarget.value)}
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    maxlength={6}
                    style={codeInputStyle}
                  />
                  <SubmitButton
                    data-test-id="twofa-enroll-confirm"
                    busy={enrollForm.submitting()}
                    busyLabel="Turning on…"
                    class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
                  >
                    Turn on
                  </SubmitButton>
                  <button
                    type="button"
                    class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
                    onClick={resetFlow}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </Field>
          </form>
        </div>
      </Show>

      {/* ── The one-time recovery-codes reveal ── */}
      <Show when={view() === 'codes'}>
        <div style={{ margin: '8px 0 0', 'font-size': '13px' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>
            Two-factor authentication is on. Save these recovery codes somewhere safe — each signs
            you in once if you lose the authenticator, and{' '}
            <strong style={{ color: 'var(--text)' }}>they will not be shown again</strong>.
          </p>
          <div
            data-test-id="twofa-recovery-codes"
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '6px',
              padding: '10px',
              'border-radius': '8px',
              background: 'var(--bg, #0b0e14)',
              border: '1px solid var(--border, rgba(255,255,255,0.12))',
              'font-family': 'var(--font-mono, monospace)',
              'user-select': 'all',
            }}
          >
            <For each={recoveryCodes()}>{(c) => <span>{c}</span>}</For>
          </div>
          <div style={{ display: 'flex', gap: '8px', 'margin-top': '10px' }}>
            <button
              data-test-id="twofa-copy-codes"
              class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
              onClick={() => void copyCodes()}
            >
              Copy codes
            </button>
            <button
              data-test-id="twofa-download-codes"
              class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
              onClick={downloadCodes}
            >
              Download codes
            </button>
            <button
              data-test-id="twofa-codes-done"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
              onClick={resetFlow}
            >
              I saved them
            </button>
          </div>
        </div>
      </Show>

      {/* ── Disable: prove a factor first ── */}
      <Show when={view() === 'disable'}>
        <div style={{ margin: '8px 0 0', 'font-size': '13px' }}>
          <FormNotice form={disableForm} testId="twofa-error" />
          <form {...disableForm.attrs}>
            <Field
              form={disableForm}
              name="code"
              label="Enter a current authenticator code (or a recovery code) to turn two-factor authentication off."
              labelClass={styles.disableLabel}
            >
              {(control) => (
                <div style={codeRow}>
                  <input
                    {...control}
                    type="text"
                    data-test-id="twofa-disable-code"
                    placeholder="123456"
                    value={disableForm.values.code}
                    onInput={(e) => disableForm.set('code', e.currentTarget.value)}
                    autocomplete="one-time-code"
                    style={codeInputStyle}
                  />
                  <SubmitButton
                    data-test-id="twofa-disable-confirm"
                    busy={disableForm.submitting()}
                    busyLabel="Turning off…"
                    class={`${layoutStyles.btn} ${layoutStyles.btnDanger ?? layoutStyles.btnSecondary}`}
                  >
                    Disable
                  </SubmitButton>
                  <button
                    type="button"
                    class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`}
                    onClick={resetFlow}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </Field>
          </form>
        </div>
      </Show>
    </div>
  )
}
