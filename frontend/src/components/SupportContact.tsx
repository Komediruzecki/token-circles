import { createSignal, Show } from 'solid-js'

// Hits the worker directly (not apiFetch) so it works in any storage mode and while signed out.
const API = (import.meta.env.VITE_API_URL ?? '') as string

function LifebuoyIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ 'vertical-align': '-2px' }}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
      <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
      <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
      <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
    </svg>
  )
}

/**
 * "Contact support" link + modal. Posts to the worker's /api/support/contact, which relays the
 * message to the private support inbox (the address is never exposed to the client). Drop it
 * anywhere — the sign-in screen, the reset screen, Settings.
 */
export default function SupportContact(props: { label?: string; prefillEmail?: string }) {
  const [open, setOpen] = createSignal(false)
  const [email, setEmail] = createSignal(props.prefillEmail ?? '')
  const [message, setMessage] = createSignal('')
  const [status, setStatus] = createSignal<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = createSignal('')

  const send = async (e: Event) => {
    e.preventDefault()
    setError('')
    const em = email().trim()
    const msg = message().trim()
    if (!em || msg.length < 5) {
      setError('Enter your email and a short message')
      return
    }
    setStatus('sending')
    try {
      const res = await fetch(`${API}/api/support/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, message: msg }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send your message')
      setStatus('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message')
      setStatus('idle')
    }
  }

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

  return (
    <>
      <a
        onClick={() => {
          setOpen(true)
          setStatus('idle')
          setError('')
        }}
        style={{
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          'font-size': '13px',
          display: 'inline-flex',
          'align-items': 'center',
          gap: '6px',
        }}
      >
        <LifebuoyIcon />
        {props.label ?? 'Contact support'}
      </a>

      <Show when={open()}>
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            padding: '24px',
            'z-index': 2000,
          }}
        >
          <div
            style={{
              width: '100%',
              'max-width': '420px',
              padding: '24px',
              'border-radius': '16px',
              background: 'var(--surface, #151a23)',
              border: '1px solid var(--border, rgba(255,255,255,0.08))',
              'text-align': 'left',
            }}
          >
            <h3 style={{ margin: '0 0 4px', 'font-size': '18px', color: 'var(--text)' }}>
              Contact support
            </h3>
            <Show
              when={status() !== 'sent'}
              fallback={
                <>
                  <p
                    style={{
                      color: 'var(--text-secondary)',
                      'font-size': '14px',
                      margin: '8px 0 16px',
                    }}
                  >
                    Thanks — your message is on its way. We'll reply to your email.
                  </p>
                  <div style={{ display: 'flex', 'justify-content': 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      style={{
                        padding: '9px 16px',
                        'border-radius': '8px',
                        border: 'none',
                        background: 'var(--primary)',
                        color: '#fff',
                        cursor: 'pointer',
                        'font-size': '14px',
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              }
            >
              <p
                style={{
                  color: 'var(--text-secondary)',
                  'font-size': '13px',
                  margin: '0 0 14px',
                }}
              >
                Trouble signing in or didn't receive an email? Send us a message and we'll get back
                to you.
              </p>
              <form onSubmit={send}>
                <input
                  type="email"
                  placeholder="Your email"
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  autocomplete="email"
                  style={inputStyle}
                />
                <textarea
                  placeholder="How can we help?"
                  value={message()}
                  onInput={(e) => setMessage(e.currentTarget.value)}
                  rows={5}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                <Show when={error()}>
                  <div
                    style={{
                      color: 'var(--danger, #ef4444)',
                      'font-size': '13px',
                      margin: '2px 0 10px',
                    }}
                  >
                    {error()}
                  </div>
                </Show>
                <div style={{ display: 'flex', gap: '8px', 'justify-content': 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    style={{
                      padding: '9px 16px',
                      'border-radius': '8px',
                      border: '1px solid var(--border, rgba(255,255,255,0.12))',
                      background: 'transparent',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      'font-size': '14px',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={status() === 'sending'}
                    style={{
                      padding: '9px 16px',
                      'border-radius': '8px',
                      border: 'none',
                      background: 'var(--primary)',
                      color: '#fff',
                      cursor: 'pointer',
                      'font-size': '14px',
                    }}
                  >
                    {status() === 'sending' ? 'Sending…' : 'Send message'}
                  </button>
                </div>
              </form>
            </Show>
          </div>
        </div>
      </Show>
    </>
  )
}
