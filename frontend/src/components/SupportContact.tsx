import { createSignal, Show } from 'solid-js'
import { supportProblems } from '../../../shared/signInSchema'
import { apiErrorFrom, networkError } from '../core/apiError'
import { createCaptchaGate } from './captchaGate'
import { createForm, Field, FormNotice, SubmitButton } from './form'
import styles from './SignInSteps.module.css'
import Turnstile from './Turnstile'

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

/** The notice for a send that failed in a way the Worker did not put into words. */
const NOT_SENT = "Your message didn't send. Try again in a moment."

/**
 * "Contact support" link + modal. Posts to the worker's /api/support/contact, which relays the
 * message to the private support inbox (the address is never exposed to the client). Drop it
 * anywhere — the sign-in screen, the reset screen, Settings.
 *
 * A kit form: an address that is missing or not an address, and a message shorter than 5
 * characters or longer than 5,000, are marked under their fields before anything is sent; a field
 * the Worker names is marked the same way. A limit reached and a request the captcha stopped are
 * said in the form's notice, and mark no field.
 */
export default function SupportContact(props: { label?: string; prefillEmail?: string }) {
  const [open, setOpen] = createSignal(false)
  const [status, setStatus] = createSignal<'idle' | 'sent'>('idle')
  const [ticketId, setTicketId] = createSignal('')
  // The widget is invisible unless Cloudflare wants a click, so the send button is never gated on
  // a token: the send waits for one instead. Normally it is there before the message is typed.
  const captcha = createCaptchaGate()

  const form = createForm<{ email: string; message: string }, string>({
    initial: { email: props.prefillEmail ?? '', message: '' },
    check: (values) => supportProblems(values),
    send: async (values) => {
      try {
        const turnstileToken = await captcha.next()
        let response: Response
        try {
          response = await fetch(`${API}/api/support/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: values.email.trim(),
              message: values.message.trim(),
              turnstileToken,
            }),
          })
        } catch (cause) {
          throw networkError(cause)
        }
        if (!response.ok) throw await apiErrorFrom(response)
        const data = (await response.json().catch(() => ({}))) as { ticketId?: unknown }
        return typeof data.ticketId === 'string' ? data.ticketId : ''
      } catch (error) {
        throw captcha.explain(error)
      } finally {
        captcha.spent()
      }
    },
    saved: (ticket) => {
      setTicketId(ticket)
      setStatus('sent')
    },
    failure: NOT_SENT,
  })

  return (
    <>
      <a
        onClick={() => {
          setOpen(true)
          setStatus('idle')
          form.reset({ ...form.values })
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
                  <Show when={ticketId()}>
                    <p style={{ 'font-size': '13px', margin: '0 0 16px', color: 'var(--text)' }}>
                      Your reference number: <strong>{ticketId()}</strong>
                    </p>
                  </Show>
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
              <FormNotice form={form} testId="support-error" />
              <form {...form.attrs}>
                <Field
                  form={form}
                  name="email"
                  label="Your email address"
                  class={styles.field}
                  labelClass={styles.label}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="email"
                      value={form.values.email}
                      onInput={(e) => form.set('email', e.currentTarget.value)}
                      autocomplete="email"
                      class={styles.input}
                    />
                  )}
                </Field>
                <Field
                  form={form}
                  name="message"
                  label="Message"
                  class={styles.field}
                  labelClass={styles.label}
                >
                  {(control) => (
                    <textarea
                      {...control}
                      placeholder="How can we help?"
                      value={form.values.message}
                      onInput={(e) => form.set('message', e.currentTarget.value)}
                      rows={5}
                      class={styles.input}
                      style={{ resize: 'vertical' }}
                    />
                  )}
                </Field>
                {/* Invisible unless Cloudflare wants a click. It has to be rendered for a token to
                    exist at all — the send button waits on one rather than being disabled by it. */}
                <Turnstile
                  appearance="interaction-only"
                  onToken={captcha.onToken}
                  onStatus={captcha.onStatus}
                />
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
                  <SubmitButton
                    busy={form.submitting()}
                    busyLabel="Sending…"
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
                    Send message
                  </SubmitButton>
                </div>
              </form>
            </Show>
          </div>
        </div>
      </Show>
    </>
  )
}
