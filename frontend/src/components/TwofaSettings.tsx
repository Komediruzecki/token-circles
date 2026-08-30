import { createSignal, For, onMount, Show } from 'solid-js'
import { renderSVG } from 'uqr'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import layoutStyles from './Layout.module.css'

/**
 * Settings card for TOTP two-factor auth: enroll (shared secret + confirmation code), the
 * one-time recovery-codes reveal, and the disable flow — every state change demands a valid
 * code, so a walk-up attacker with an unlocked laptop cannot quietly switch 2FA off.
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

export default function TwofaSettings() {
  const [status, setStatus] = createSignal<Status | null>(null)
  const [view, setView] = createSignal<'idle' | 'enroll' | 'codes' | 'disable'>('idle')
  const [secret, setSecret] = createSignal('')
  const [otpauth, setOtpauth] = createSignal('')
  const [code, setCode] = createSignal('')
  const [error, setError] = createSignal('')
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

  const resetFlow = () => {
    setCode('')
    setError('')
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
      setCode('')
      setError('')
      setView('enroll')
    } catch {
      toast('Network problem — try again', 'error')
    } finally {
      setBusy(false)
    }
  }

  const confirmEnroll = async () => {
    const value = code().trim()
    if (!value) {
      setError('Enter the 6-digit code from your authenticator app')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { ok, data } = await postJson('/api/auth/2fa/enable', { code: value })
      if (!ok) {
        setError(errorOf(data, 'That code did not match — try again'))
        return
      }
      setRecoveryCodes((data as { recoveryCodes: string[] }).recoveryCodes ?? [])
      setCode('')
      setView('codes')
      void loadStatus()
    } catch {
      setError('Network problem — try again')
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

  const confirmDisable = async () => {
    const value = code().trim()
    if (!value) {
      setError('Enter a 6-digit or recovery code to confirm')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { ok, data } = await postJson('/api/auth/2fa/disable', { code: value })
      if (!ok) {
        setError(errorOf(data, 'That code did not match — try again'))
        return
      }
      toast('Two-factor authentication disabled', 'success')
      resetFlow()
      void loadStatus()
    } catch {
      setError('Network problem — try again')
    } finally {
      setBusy(false)
    }
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
  const errorLine = (
    <Show when={error()}>
      <div
        data-test-id="twofa-error"
        style={{ color: 'var(--danger, #ef4444)', 'font-size': '13px', margin: '6px 0 0' }}
      >
        {error()}
      </div>
    </Show>
  )

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
            setCode('')
            setError('')
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
          <p style={{ margin: '10px 0 6px' }}>2. Enter the 6-digit code the app shows:</p>
          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            <input
              type="text"
              data-test-id="twofa-enroll-code"
              placeholder="123456"
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength={6}
              style={codeInputStyle}
            />
            <button
              data-test-id="twofa-enroll-confirm"
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
              disabled={busy()}
              onClick={() => void confirmEnroll()}
            >
              Turn on
            </button>
            <button class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`} onClick={resetFlow}>
              Cancel
            </button>
          </div>
          {errorLine}
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
          <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)' }}>
            Enter a current authenticator code (or a recovery code) to turn two-factor
            authentication off.
          </p>
          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            <input
              type="text"
              data-test-id="twofa-disable-code"
              placeholder="123456"
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              autocomplete="one-time-code"
              style={codeInputStyle}
            />
            <button
              data-test-id="twofa-disable-confirm"
              class={`${layoutStyles.btn} ${layoutStyles.btnDanger ?? layoutStyles.btnSecondary}`}
              disabled={busy()}
              onClick={() => void confirmDisable()}
            >
              Disable
            </button>
            <button class={`${layoutStyles.btn} ${layoutStyles.btnSecondary}`} onClick={resetFlow}>
              Cancel
            </button>
          </div>
          {errorLine}
        </div>
      </Show>
    </div>
  )
}
