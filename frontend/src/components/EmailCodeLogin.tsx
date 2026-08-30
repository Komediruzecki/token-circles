import { createSignal, Show } from 'solid-js'
import { apiFetch } from '../core/apiFetch'
import { markPasskeyNudgeAfterLogin } from '../core/webauthn'
import layoutStyles from './Layout.module.css'
import Turnstile, { resetTurnstile, turnstileEnabled } from './Turnstile'

/**
 * Passwordless sign-in: ask the worker to mail a 6-digit code, then trade it for a session.
 * The endpoint answers the same neutral ok whether or not the address has an account, so the
 * code step always follows a send — no branch here may reveal what the server refused to.
 * A 2FA account still gets the authenticator challenge after the code (via onTwofa).
 */
export default function EmailCodeLogin(props: {
  email?: string
  onBack: () => void
  onTwofa: () => void
}) {
  const [step, setStep] = createSignal<'request' | 'verify'>('request')
  const [email, setEmail] = createSignal(props.email ?? '')
  const [code, setCode] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [turnstileToken, setTurnstileToken] = createSignal('')

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    'margin-bottom': '10px',
    'border-radius': '8px',
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    background: 'var(--bg, #0b0e14)',
    color: 'var(--text, #e6e8eb)',
    'font-size': '14px',
    'box-sizing': 'border-box' as const,
  }

  const sendCode = async (e: Event) => {
    e.preventDefault()
    const em = email().trim()
    if (!em) {
      setError('Email is required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/auth/email-code/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, turnstileToken: turnstileToken() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error || 'Could not send the code — try again')
        return
      }
      setCode('')
      setStep('verify')
    } catch {
      setError('Network problem — try again')
    } finally {
      setLoading(false)
      // The token is single-use; re-arm the widget for a possible resend.
      resetTurnstile()
      setTurnstileToken('')
    }
  }

  const verify = async (e: Event) => {
    e.preventDefault()
    const value = code().trim()
    if (!value) {
      setError('Enter the 6-digit code from the email')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/auth/email-code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email().trim(), code: value }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error || 'Invalid or expired code')
        setLoading(false)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { twofaRequired?: boolean }
      if (body.twofaRequired) {
        // Inbox proven, but the account wants the authenticator too — hand over.
        setLoading(false)
        props.onTwofa()
        return
      }
      markPasskeyNudgeAfterLogin()
      window.location.reload()
    } catch {
      setError('Network problem — try again')
      setLoading(false)
    }
  }

  return (
    <Show
      when={step() === 'verify'}
      fallback={
        <form onSubmit={sendCode}>
          <p
            style={{
              margin: '0 0 14px',
              color: 'var(--text-secondary)',
              'font-size': '13.5px',
              'text-align': 'left',
            }}
          >
            No password needed — we'll email you a 6-digit code that signs you in.
          </p>
          <input
            type="email"
            data-test-id="emailcode-email"
            placeholder="Email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            autocomplete="username"
            style={inputStyle}
          />
          <Show when={error()}>
            <div
              data-test-id="emailcode-error"
              style={{ color: 'var(--danger, #ef4444)', 'font-size': '13px', margin: '2px 0 10px' }}
            >
              {error()}
            </div>
          </Show>
          <Turnstile onToken={setTurnstileToken} />
          <button
            type="submit"
            data-test-id="emailcode-send"
            class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
            style={{ width: '100%', 'justify-content': 'center' }}
            disabled={loading() || (turnstileEnabled && !turnstileToken())}
          >
            {loading() ? 'Sending…' : 'Email me a code'}
          </button>
          <p style={{ margin: '12px 0 0', 'font-size': '13px' }}>
            <a
              data-test-id="emailcode-back"
              onClick={() => {
                props.onBack()
              }}
              style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              Back to sign in
            </a>
          </p>
        </form>
      }
    >
      <form onSubmit={verify}>
        <p
          style={{
            margin: '0 0 14px',
            color: 'var(--text-secondary)',
            'font-size': '13.5px',
            'text-align': 'left',
          }}
        >
          If <strong style={{ color: 'var(--text)' }}>{email().trim()}</strong> has an account, a
          6-digit code is on its way. Enter it below — it expires in 10 minutes.
        </p>
        <input
          type="text"
          data-test-id="emailcode-code"
          placeholder="123456"
          value={code()}
          onInput={(e) => setCode(e.currentTarget.value)}
          autocomplete="one-time-code"
          inputmode="numeric"
          maxlength={6}
          style={{
            ...inputStyle,
            'font-size': '16px',
            'letter-spacing': '4px',
            'text-align': 'center',
          }}
        />
        <Show when={error()}>
          <div
            data-test-id="emailcode-error"
            style={{ color: 'var(--danger, #ef4444)', 'font-size': '13px', margin: '2px 0 10px' }}
          >
            {error()}
          </div>
        </Show>
        <button
          type="submit"
          data-test-id="emailcode-verify"
          class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
          style={{ width: '100%', 'justify-content': 'center' }}
          disabled={loading()}
        >
          {loading() ? 'Checking…' : 'Sign in'}
        </button>
        <p style={{ margin: '12px 0 0', 'font-size': '13px', color: 'var(--text-secondary)' }}>
          Nothing arrived?{' '}
          <a
            data-test-id="emailcode-resend"
            onClick={() => {
              setStep('request')
              setError('')
            }}
            style={{ cursor: 'pointer', color: 'var(--primary)', 'font-weight': 600 }}
          >
            Send another
          </a>
        </p>
      </form>
    </Show>
  )
}
