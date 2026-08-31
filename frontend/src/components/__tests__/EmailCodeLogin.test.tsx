/**
 * EmailCodeLogin — passwordless sign-in: request a mailed 6-digit code, verify it. Success
 * reloads like every login path; a 2FA account hands off to the challenge step instead.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const requests: { url: string; body: unknown }[] = []
let requestResponse: () => Promise<Response> = () => Promise.resolve(json({ ok: true }))
let verifyResponse: () => Promise<Response> = () => Promise.resolve(json({ id: 1 }))
let reloads = 0
let twofaHandoffs = 0

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function mount(email = 'user@example.com') {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      return url === '/api/auth/email-code/request' ? requestResponse() : verifyResponse()
    },
  }))
  vi.doMock('../Turnstile', () => ({
    default: () => null,
    turnstileEnabled: false,
    resetTurnstile: () => undefined,
  }))
  const { default: EmailCodeLogin } = await import('../EmailCodeLogin')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <EmailCodeLogin
        email={email}
        onBack={() => undefined}
        onTwofa={() => {
          twofaHandoffs += 1
        }}
      />
    ),
    host
  )
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function requestCode() {
  host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-send"]')!.click()
  await flush()
}

beforeEach(() => {
  requests.length = 0
  reloads = 0
  twofaHandoffs = 0
  requestResponse = () => Promise.resolve(json({ ok: true }))
  verifyResponse = () => Promise.resolve(json({ id: 1 }))
  vi.stubGlobal('location', {
    reload: () => (reloads += 1),
    href: 'https://app.example.com/',
  } as unknown as Location)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('requesting', () => {
  it('prefills the email, posts the request, and advances to the code step', async () => {
    await mount('prefilled@example.com')
    expect(host.querySelector<HTMLInputElement>('[data-test-id="emailcode-email"]')!.value).toBe(
      'prefilled@example.com'
    )

    await requestCode()
    expect(requests[0]).toEqual({
      url: '/api/auth/email-code/request',
      body: { email: 'prefilled@example.com', turnstileToken: '' },
    })
    expect(host.querySelector('[data-test-id="emailcode-code"]')).not.toBeNull()
  })
})

describe('requesting with the captcha enabled', () => {
  it('explains the disabled button with the captcha hint', async () => {
    vi.resetModules()
    vi.doMock('../../core/apiFetch', () => ({
      apiFetch: () => requestResponse(),
    }))
    vi.doMock('../Turnstile', () => ({
      default: (props: { onStatus?: (s: string) => void }) => {
        props.onStatus?.('ready')
        return null
      },
      turnstileEnabled: true,
      resetTurnstile: () => undefined,
      captchaIsStuck: () => false,
      captchaStatusMessage: () => 'Complete the check below to continue.',
    }))
    const { default: EmailCodeLogin } = await import('../EmailCodeLogin')
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => <EmailCodeLogin onBack={() => undefined} onTwofa={() => undefined} />,
      host
    )
    await flush()

    // Same rule as the password form: a submit button disabled by an unsolved captcha must
    // say why, or the user stares at a dead button.
    const send = host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-send"]')!
    expect(send.disabled).toBe(true)
    expect(host.querySelector('[data-test-id="captcha-hint"]')).not.toBeNull()
  })
})

describe('verifying', () => {
  it('focuses the code field as soon as the send succeeds', async () => {
    await mount()
    await requestCode()
    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>('[data-test-id="emailcode-code"]')
    )
  })

  it('posts email + code and reloads on success', async () => {
    await mount()
    await requestCode()
    type('[data-test-id="emailcode-code"]', '123456')
    host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-verify"]')!.click()
    await flush()

    expect(requests[1]).toEqual({
      url: '/api/auth/email-code/verify',
      body: { email: 'user@example.com', code: '123456' },
    })
    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
  })

  it('hands off to the 2FA step instead of reloading when the account has 2FA', async () => {
    verifyResponse = () => Promise.resolve(json({ twofaRequired: true }))
    await mount()
    await requestCode()
    type('[data-test-id="emailcode-code"]', '123456')
    host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-verify"]')!.click()
    await flush()

    expect(twofaHandoffs).toBe(1)
    expect(reloads).toBe(0)
  })

  it('shows the server message on a wrong code and stays on the step', async () => {
    verifyResponse = () => Promise.resolve(json({ error: 'Invalid or expired code' }, 401))
    await mount()
    await requestCode()
    type('[data-test-id="emailcode-code"]', '000000')
    host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-verify"]')!.click()
    await flush()

    expect(host.querySelector('[data-test-id="emailcode-error"]')!.textContent).toContain(
      'Invalid or expired code'
    )
    expect(reloads).toBe(0)
    expect(host.querySelector('[data-test-id="emailcode-code"]')).not.toBeNull()
  })
})
