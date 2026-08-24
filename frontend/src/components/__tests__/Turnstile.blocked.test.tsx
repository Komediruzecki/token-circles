/**
 * Turnstile — what the user sees when the captcha never gets a chance to run.
 *
 * The failure this covers is not "the challenge was refused". It is the widget script never
 * arriving: an ad blocker, a privacy extension, a DNS filter, a corporate proxy. Before this,
 * that produced an empty box, the line "Complete the verification above to continue" pointing at
 * nothing, and a permanently disabled Sign in button — a login screen that is simply broken, with
 * no clue anywhere on it about what to do. These tests pin the three parts of the fix: the state
 * is distinguishable, the message names the domain to unblock, and Retry is a real second attempt.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SITE_KEY = 'test-site-key'
const CHALLENGE_HOST = 'challenges.cloudflare.com'

let host: HTMLDivElement
let dispose: (() => void) | undefined
let scripts: HTMLScriptElement[]
let appendSpy: ReturnType<typeof vi.spyOn>

/** Every <script> the component asked the document for, in order. */
function turnstileScripts() {
  return scripts.filter((s) => s.src.includes(CHALLENGE_HOST))
}

async function loadModule(siteKey = SITE_KEY) {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', siteKey)
  return import('../Turnstile')
}

/** Stand-in for the real `window.turnstile`, installed only when the script "loads". */
function installTurnstileApi() {
  const rendered: Record<string, unknown>[] = []
  window.turnstile = {
    render: (_el: HTMLElement, opts: Record<string, unknown>) => {
      rendered.push(opts)
      return `widget-${rendered.length}`
    },
    remove: () => {},
    reset: () => {},
  }
  return rendered
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  scripts = []
  // Intercept the injected <script> instead of letting jsdom try to fetch it: jsdom does not
  // run remote scripts, so onload/onerror would never fire on their own and every test would
  // sit in 'loading'.
  appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    return node
  }) as typeof document.head.appendChild)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  appendSpy.mockRestore()
  delete window.turnstile
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('captchaStatusMessage', () => {
  it('names the domain to unblock, because that is the only actionable fact', async () => {
    const { captchaStatusMessage } = await loadModule()
    const msg = captchaStatusMessage('unreachable')
    expect(msg).toContain(CHALLENGE_HOST)
    expect(msg.toLowerCase()).toContain('blocker')
  })

  it('says nothing when there is nothing to say', async () => {
    const { captchaStatusMessage } = await loadModule()
    expect(captchaStatusMessage('solved')).toBe('')
    expect(captchaStatusMessage('disabled')).toBe('')
  })

  it('keeps the ordinary not-yet-solved hint distinct from the blocked one', async () => {
    const { captchaStatusMessage } = await loadModule()
    expect(captchaStatusMessage('ready')).toBe('Complete the verification above to continue.')
    expect(captchaStatusMessage('ready')).not.toContain(CHALLENGE_HOST)
  })
})

describe('captchaIsStuck', () => {
  it('is true only for the states the user cannot clear by waiting or clicking', async () => {
    const { captchaIsStuck } = await loadModule()
    expect(captchaIsStuck('unreachable')).toBe(true)
    expect(captchaIsStuck('failed')).toBe(true)
    // 'expired' is NOT stuck: the widget re-arms itself and issues a fresh token.
    for (const s of ['disabled', 'loading', 'ready', 'solved', 'expired'] as const) {
      expect(captchaIsStuck(s)).toBe(false)
    }
  })
})

describe('Turnstile widget', () => {
  it('renders nothing at all without a site key', async () => {
    const mod = await loadModule('')
    const seen: string[] = []
    dispose = render(() => <mod.default onToken={() => {}} onStatus={(s) => seen.push(s)} />, host)
    expect(mod.turnstileEnabled).toBe(false)
    expect(host.textContent).toBe('')
    expect(turnstileScripts()).toHaveLength(0)
    expect(seen).toHaveLength(0)
  })

  it('explains itself when the script is blocked, and offers a way out', async () => {
    const mod = await loadModule()
    const seen: string[] = []
    const tokens: string[] = []
    dispose = render(
      () => <mod.default onToken={(t) => tokens.push(t)} onStatus={(s) => seen.push(s)} />,
      host
    )
    const script = turnstileScripts()[0]
    expect(script).toBeTruthy()
    script.onerror?.(new Event('error'))

    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeTruthy()
    })
    expect(seen.at(-1)).toBe('unreachable')
    // The token is cleared, so the form's submit button stays disabled — the panel is the
    // explanation for that, not a way around it.
    expect(tokens.at(-1)).toBe('')
    expect(host.querySelector('[data-test-id="captcha-blocked"]')?.textContent).toContain(
      CHALLENGE_HOST
    )
    expect(host.querySelector('[data-test-id="captcha-retry"]')).toBeTruthy()
  })

  it('gives up on a host that never answers instead of loading forever', async () => {
    vi.useFakeTimers()
    const mod = await loadModule()
    const seen: string[] = []
    dispose = render(() => <mod.default onToken={() => {}} onStatus={(s) => seen.push(s)} />, host)
    expect(turnstileScripts()).toHaveLength(1)
    // No onload, no onerror — the shape a null-routed or silently-dropped host takes.
    expect(seen.at(-1)).toBe('loading')
    await vi.advanceTimersByTimeAsync(13000)
    await vi.waitFor(() => {
      expect(seen.at(-1)).toBe('unreachable')
    })
    expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeTruthy()
  })

  it('Retry is a real second attempt, not a replay of the first failure', async () => {
    const mod = await loadModule()
    dispose = render(() => <mod.default onToken={() => {}} />, host)
    turnstileScripts()[0].onerror?.(new Event('error'))
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="captcha-retry"]')).toBeTruthy()
    })

    // The user turns their blocker off for this site; from here the load succeeds.
    const rendered = installTurnstileApi()
    ;(host.querySelector('[data-test-id="captcha-retry"]') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(turnstileScripts()).toHaveLength(2)
    })
    turnstileScripts()[1].onload?.(new Event('load'))
    await vi.waitFor(() => {
      expect(rendered).toHaveLength(1)
    })
    expect(rendered[0].sitekey).toBe(SITE_KEY)
    expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeNull()
  })

  it('a freshly mounted widget tries again after an earlier one was blocked', async () => {
    // LoginScreen unmounts the form's widget and mounts a new one for the register -> sign-in
    // handoff. A cached rejection would make that second instance fail instantly without ever
    // asking for the script, so a user whose first load was blocked could never recover
    // without a full page reload.
    const mod = await loadModule()
    const first = render(() => <mod.default onToken={() => {}} />, host)
    turnstileScripts()[0].onerror?.(new Event('error'))
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeTruthy()
    })
    first()

    dispose = render(() => <mod.default onToken={() => {}} />, host)
    await vi.waitFor(() => {
      expect(turnstileScripts()).toHaveLength(2)
    })
  })

  it('reports ready then solved on the happy path, and shows no panel', async () => {
    const mod = await loadModule()
    const seen: string[] = []
    const tokens: string[] = []
    dispose = render(
      () => <mod.default onToken={(t) => tokens.push(t)} onStatus={(s) => seen.push(s)} />,
      host
    )
    const rendered = installTurnstileApi()
    turnstileScripts()[0].onload?.(new Event('load'))

    await vi.waitFor(() => {
      expect(seen).toContain('ready')
    })
    expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeNull()
    ;(rendered[0].callback as (t: string) => void)('token-abc')
    expect(tokens.at(-1)).toBe('token-abc')
    expect(seen.at(-1)).toBe('solved')
  })

  it('shows the panel when the widget itself errors after loading', async () => {
    const mod = await loadModule()
    const seen: string[] = []
    dispose = render(() => <mod.default onToken={() => {}} onStatus={(s) => seen.push(s)} />, host)
    const rendered = installTurnstileApi()
    turnstileScripts()[0].onload?.(new Event('load'))
    await vi.waitFor(() => {
      expect(rendered).toHaveLength(1)
    })
    ;(rendered[0]['error-callback'] as (c?: string) => void)('110200')

    await vi.waitFor(() => {
      expect(seen.at(-1)).toBe('failed')
    })
    expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeTruthy()
  })

  it('an expired token is not treated as blocked', async () => {
    const mod = await loadModule()
    const seen: string[] = []
    dispose = render(() => <mod.default onToken={() => {}} onStatus={(s) => seen.push(s)} />, host)
    const rendered = installTurnstileApi()
    turnstileScripts()[0].onload?.(new Event('load'))
    await vi.waitFor(() => {
      expect(rendered).toHaveLength(1)
    })
    ;(rendered[0]['expired-callback'] as () => void)()

    await vi.waitFor(() => {
      expect(seen.at(-1)).toBe('expired')
    })
    expect(host.querySelector('[data-test-id="captcha-blocked"]')).toBeNull()
  })
})
