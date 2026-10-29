import { createSignal, onCleanup, onMount, Show } from 'solid-js'

// Cloudflare Turnstile (CAPTCHA) widget for the public auth forms. Renders ONLY when
// VITE_TURNSTILE_SITE_KEY is set; otherwise it's a no-op and the forms work unchanged — matching
// the worker gate, which is disabled until TURNSTILE_SECRET is set. Set BOTH to enable the captcha.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const CHALLENGE_HOST = 'challenges.cloudflare.com'
const SCRIPT_SRC = `https://${CHALLENGE_HOST}/turnstile/v0/api.js?render=explicit`
// A refused connection fires onerror in milliseconds; a null-routed or silently-dropped host
// (the shape most DNS filters and corporate proxies take) fires nothing at all. Without this the
// widget sits in 'loading' forever and every send holds for a token that never comes, with
// nothing to say why: from the person's side, an app that is simply broken.
const SCRIPT_TIMEOUT_MS = 12000

export const turnstileEnabled = !!SITE_KEY

/**
 * What the captcha is doing right now. The distinction that matters is `unreachable` vs `ready`:
 * both leave us without a token, but only one of them clears up on its own. A stuck widget
 * (`captchaIsStuck`) gets a panel that says what to fix, and a send refuses at once in the same
 * words instead of holding for a token.
 */
export type TurnstileStatus =
  | 'disabled' // no site key in this build — the gate is off, forms submit unguarded
  | 'loading' // fetching the widget script
  | 'ready' // the check is running: just drawn, reset, ticked, or started over after a timeout
  | 'interactive' // Cloudflare drew a box and waits for the person to tick it
  | 'solved' // the widget handed over a token (the gate may have sent it since)
  | 'unreachable' // the script never loaded: blocked, filtered, or offline
  | 'failed' // the widget loaded and then errored
  | 'unsupported' // Cloudflare cannot run its check in this browser
  | 'expired' // the token aged out unused, and Cloudflare is fetching the next one

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

/**
 * Wait for the widget to hand over a token: the one held now, or the next one. Resolves ''
 * immediately when the captcha is disabled; rejects when no token arrives within the timeout, or
 * when the signal stops the wait.
 */
export function waitForTurnstileToken(
  getToken: () => string,
  timeoutMs = 8000,
  signal?: AbortSignal
): Promise<string> {
  if (!turnstileEnabled) return Promise.resolve('')
  const existing = getToken()
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const stop = () => {
      clearInterval(poll)
      signal?.removeEventListener('abort', aborted)
    }
    const aborted = () => {
      stop()
      reject(new Error('Verification wait stopped'))
    }
    const poll = setInterval(() => {
      const t = getToken()
      if (t) {
        stop()
        resolve(t)
      } else if (Date.now() - started > timeoutMs) {
        stop()
        reject(new Error('Verification timed out'))
      }
    }, 150)
    signal?.addEventListener('abort', aborted, { once: true })
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
    case 'unsupported':
      return "This browser can't run Cloudflare's verification. Update it, or try another browser."
    case 'interactive':
      return 'Tick the box above first.'
    // The rest have nothing to say: the check is on its way, and a send that holds for it says
    // so on its button (captchaGate.ts).
    default:
      return ''
  }
}

/** Is this a state the user cannot clear by waiting, or by clicking the widget? */
export function captchaIsStuck(status: TurnstileStatus): boolean {
  return status === 'unreachable' || status === 'failed' || status === 'unsupported'
}

export default function Turnstile(props: {
  onToken: (token: string) => void
  onStatus?: (status: TurnstileStatus) => void
  /**
   * Hands over a way to start this widget's check over, for the next token, and `undefined` once
   * the widget is gone. It resets by the widget's id, as Cloudflare documents `reset(widgetId)`: a
   * bare `turnstile.reset()` resets one widget, not every widget on the page, and while the support
   * form's widget is open over the sign-in form's that one need not be this one.
   */
  onWidget?: (reset: (() => void) | undefined) => void
  /**
   * `interaction-only` renders nothing while the challenge passes silently — which is almost
   * always — and shows the widget only when Cloudflare actually wants a click. Use it wherever the
   * captcha guards a form the user came to fill in; a permanent checkbox above a sign-in button
   * asks people to prove themselves before they have done anything.
   *
   * Callers that use it must not gate their submit button on the token, since there may be no
   * visible widget to explain the wait. The kit forms go through CaptchaCheck and captchaGate.ts.
   *
   * A reset runs the check again, and Cloudflare decides again whether it needs a click: with the
   * test key that forces one, the box came back after each reset (measured 2026-10-29). `retry()`
   * below removes and re-renders, for a script that never loaded.
   */
  appearance?: 'always' | 'interaction-only'
}) {
  let el: HTMLDivElement | undefined
  let widgetId: string | undefined
  /** Unmounted: a script that loads after this draws nothing and reports nothing. */
  let disposed = false
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
        // The form left before the script came: the widget the next form draws is its own.
        if (disposed) return
        if (!window.turnstile || !el) {
          report('unreachable')
          return
        }
        const id = window.turnstile.render(el, {
          sitekey: SITE_KEY,
          appearance: props.appearance ?? 'always',
          // An unused token expires after 300 seconds. Cloudflare then fetches the next one by
          // itself; the expired-callback below only drops the old one, so it is never sent.
          'refresh-expired': 'auto',
          // A box left unticked times out (after 120 s with the test key that forces one). With
          // 'auto' Cloudflare starts the check over by itself and asks again within a moment; with
          // 'manual' it waited for a click on its own refresh link (both measured 2026-10-29).
          // 'auto' is Cloudflare's default, set here so the timeout-callback below can rely on it.
          'refresh-timeout': 'auto',
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
          // Cloudflare wants a click. In interaction-only mode this is when the widget appears.
          'before-interactive-callback': () => {
            report('interactive')
          },
          // Ticked: the check carries on, and a token (or an error) follows. Cloudflare does not
          // say which of this and the token comes first: a token already here stays 'solved', or
          // the gate could never tell that it went out (captchaGate.ts, lastTokenSpent).
          'after-interactive-callback': () => {
            if (status() !== 'solved') report('ready')
          },
          // The box waited too long for a tick. Cloudflare starts the check over by itself and
          // asks again if it still wants a click, so the form waits for the box no longer.
          'timeout-callback': () => {
            props.onToken('')
            report('ready')
          },
          'unsupported-callback': () => {
            props.onToken('')
            report('unsupported')
          },
        })
        widgetId = id
        // The callbacks above come later, from Cloudflare's frame, so this is the first word.
        if (status() === 'loading') report('ready')
        props.onWidget?.(() => {
          if (widgetId !== id || !window.turnstile) return
          try {
            window.turnstile.reset(id)
          } catch {
            /* the widget may already be gone */
          }
          report('ready')
        })
      })
      .catch((err: unknown) => {
        if (disposed) return
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
    disposed = true
    // The form can outlive its widget (the sign-in screen's other steps): a token from a widget
    // that is gone, and a way to reset it, are no use to it. The next widget brings its own. This
    // comes before the remove, so a hold ends even when Cloudflare cannot remove its widget.
    props.onWidget?.(undefined)
    props.onToken('')
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.remove(widgetId)
      } catch {
        /* the widget may already be gone */
      }
    }
    widgetId = undefined
  })

  return (
    <Show when={SITE_KEY}>
      {/* No margin in interaction-only mode: the widget is usually absent, and a fixed margin on
          an empty box leaves a permanent gap where nothing ever appears. The parent's own gap
          spaces it on the rare occasion Cloudflare does ask for a click. */}
      <div
        ref={el}
        style={{
          display: 'flex',
          'justify-content': 'center',
          margin: props.appearance === 'interaction-only' ? '0' : '4px 0 12px',
        }}
      />
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
            {/* Loading the script again cannot help a browser Cloudflare does not support. */}
            <Show when={status() !== 'unsupported'}>
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
            </Show>
          </div>
        </div>
      </Show>
    </Show>
  )
}
