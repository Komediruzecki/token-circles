import { createSignal, onCleanup, onMount, Show } from 'solid-js'

// Cloudflare Turnstile (CAPTCHA) widget for the public auth forms. Renders ONLY when
// VITE_TURNSTILE_SITE_KEY is set; otherwise it's a no-op and the forms work unchanged — matching
// the worker gate, which is disabled until TURNSTILE_SECRET is set. Set BOTH to enable the captcha.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const CHALLENGE_HOST = 'challenges.cloudflare.com'
const SCRIPT_SRC = `https://${CHALLENGE_HOST}/turnstile/v0/api.js?render=explicit`
// A refused connection fires onerror in milliseconds; a null-routed or silently-dropped host
// (the shape most DNS filters and corporate proxies take) fires nothing at all. Without this the
// widget sits in 'loading' forever and the form's submit button stays disabled with no
// explanation — indistinguishable, from the user's side, from an app that is simply broken.
const SCRIPT_TIMEOUT_MS = 12000

export const turnstileEnabled = !!SITE_KEY

/**
 * What the captcha is doing right now. The distinction that matters is `unreachable` vs `ready`:
 * both leave us without a token and both disable the submit button, but only one of them is
 * something the person in front of the screen can do anything about.
 */
export type TurnstileStatus =
  | 'disabled' // no site key in this build — the gate is off, forms submit unguarded
  | 'loading' // fetching the widget script
  | 'ready' // rendered, waiting for the challenge to pass
  | 'solved' // we hold a token
  | 'unreachable' // the script never loaded: blocked, filtered, or offline
  | 'failed' // the widget loaded and then errored
  | 'expired' // the token aged out before it was used

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) {
        // Drop the cached promise so a retry is a real second attempt rather than a replay of
        // the same rejection — a blocked request often succeeds once the user allows the domain
        // for this site, and that retry has to be able to work.
        scriptPromise = null
        reject(err)
      } else {
        resolve()
      }
    }
    const timer = setTimeout(() => {
      finish(new Error(`Turnstile did not load within ${SCRIPT_TIMEOUT_MS}ms`))
    }, SCRIPT_TIMEOUT_MS)
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => {
      finish()
    }
    s.onerror = () => {
      finish(new Error('Failed to load Turnstile'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/** Forget any in-flight or completed script load, so the next call re-fetches. */
export function resetTurnstileScriptCache(): void {
  scriptPromise = null
}

/** Reset every Turnstile widget on the page (tokens are single-use — call after a failed submit). */
export function resetTurnstile(): void {
  try {
    window.turnstile?.reset()
  } catch {
    /* ignore */
  }
}

/**
 * Wait for the widget to auto-issue a fresh token after resetTurnstile() —
 * used by the register → auto-sign-in flow, where the register call consumed
 * the previous single-use token. Resolves '' immediately when the captcha is
 * disabled; rejects when no token arrives within the timeout.
 */
export function waitForTurnstileToken(getToken: () => string, timeoutMs = 8000): Promise<string> {
  if (!turnstileEnabled) return Promise.resolve('')
  const existing = getToken()
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = setInterval(() => {
      const t = getToken()
      if (t) {
        clearInterval(poll)
        resolve(t)
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(poll)
        reject(new Error('Verification timed out'))
      }
    }, 150)
  })
}

/**
 * What to tell the user, given where the captcha got stuck. Exported so the wording lives in one
 * place rather than in near-copies across the two auth forms — and so a test can assert it
 * without driving a widget that, by definition, does not load.
 */
export function captchaStatusMessage(status: TurnstileStatus): string {
  switch (status) {
    case 'unreachable':
      return `The verification step could not load. It comes from ${CHALLENGE_HOST} — an ad blocker, a privacy extension, or a network filter is almost always the reason. Allow that domain for this site, or try a different network, then retry.`
    case 'failed':
      return 'Verification could not run. That is usually a blocked third-party request, or a temporary problem at Cloudflare. Retry, or try a different network.'
    case 'expired':
      return 'Verification expired before it was used. Complete it again to continue.'
    case 'loading':
      return 'Loading the verification step…'
    case 'ready':
      return 'Complete the verification above to continue.'
    default:
      return ''
  }
}

/** Is this a state the user cannot clear by waiting, or by clicking the widget? */
export function captchaIsStuck(status: TurnstileStatus): boolean {
  return status === 'unreachable' || status === 'failed'
}

export default function Turnstile(props: {
  onToken: (token: string) => void
  onStatus?: (status: TurnstileStatus) => void
}) {
  let el: HTMLDivElement | undefined
  let widgetId: string | undefined
  const [status, setStatus] = createSignal<TurnstileStatus>(SITE_KEY ? 'loading' : 'disabled')

  const report = (next: TurnstileStatus) => {
    setStatus(next)
    props.onStatus?.(next)
  }

  const mountWidget = () => {
    if (!SITE_KEY || !el) return
    report('loading')
    loadScript()
      .then(() => {
        if (!window.turnstile || !el) {
          report('unreachable')
          return
        }
        widgetId = window.turnstile.render(el, {
          sitekey: SITE_KEY,
          callback: (token: string) => {
            props.onToken(token)
            report('solved')
          },
          'error-callback': (code?: string) => {
            // Keep the code: Cloudflare's 1xxxxx codes are the only way to tell a blocked
            // subrequest from a bad site key after the fact, and nothing else records it.
            console.warn(`Turnstile error-callback${code ? ` (${code})` : ''}`)
            props.onToken('')
            report('failed')
          },
          'expired-callback': () => {
            props.onToken('')
            report('expired')
          },
        })
        report('ready')
      })
      .catch((err: unknown) => {
        console.warn(`Turnstile script did not load: ${String(err)}`)
        props.onToken('')
        report('unreachable')
      })
  }

  const retry = () => {
    resetTurnstileScriptCache()
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.remove(widgetId)
      } catch {
        /* the widget may already be gone */
      }
      widgetId = undefined
    }
    if (el) el.textContent = ''
    mountWidget()
  }

  onMount(mountWidget)

  onCleanup(() => {
    if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
  })

  return (
    <Show when={SITE_KEY}>
      <div ref={el} style="margin: 4px 0 12px; display: flex; justify-content: center;" />
      <Show when={captchaIsStuck(status())}>
        <div
          data-test-id="captcha-blocked"
          role="alert"
          style={{
            display: 'flex',
            'align-items': 'flex-start',
            gap: '8px',
            'text-align': 'left',
            padding: '10px 12px',
            margin: '0 0 12px',
            'border-radius': '10px',
            border:
              '1px solid color-mix(in oklab, var(--warning, #f59e0b) 45%, var(--border, rgba(255,255,255,0.12)))',
            background: 'color-mix(in oklab, var(--warning, #f59e0b) 12%, transparent)',
            color: 'var(--text, #e6e8eb)',
            'font-size': '13px',
            'line-height': '1.45',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--warning, #f59e0b)"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style={{ flex: 'none', 'margin-top': '1px' }}
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div>
            <div>{captchaStatusMessage(status())}</div>
            <button
              type="button"
              data-test-id="captcha-retry"
              onClick={retry}
              style={{
                'margin-top': '8px',
                background: 'transparent',
                border: '1px solid var(--border, rgba(255,255,255,0.18))',
                'border-radius': '8px',
                padding: '4px 10px',
                color: 'var(--text, #e6e8eb)',
                'font-size': '12px',
                cursor: 'pointer',
              }}
            >
              Retry verification
            </button>
          </div>
        </div>
      </Show>
    </Show>
  )
}
