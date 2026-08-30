/**
 * TwofaSettings — the Settings card: enroll (secret + confirm code -> recovery codes shown
 * exactly once), status display, and the disable flow that demands a code.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const requests: { url: string; body: unknown }[] = []
const toasts: { message: string; type: string }[] = []
let statusResponse: () => Promise<Response> = () =>
  Promise.resolve(json({ enabled: false, recoveryCodesLeft: 0 }))
let setupResponse: () => Promise<Response> = () =>
  Promise.resolve(json({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauthUri: 'otpauth://x' }))
let enableResponse: () => Promise<Response> = () => Promise.resolve(json({ recoveryCodes: CODES }))
let disableResponse: () => Promise<Response> = () => Promise.resolve(json({ ok: true }))

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBB${i}`)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url === '/api/auth/2fa/status') return statusResponse()
      if (url === '/api/auth/2fa/setup') return setupResponse()
      if (url === '/api/auth/2fa/enable') return enableResponse()
      if (url === '/api/auth/2fa/disable') return disableResponse()
      return Promise.resolve(json({ error: 'unexpected' }, 500))
    },
  }))
  const { default: TwofaSettings } = await import('../TwofaSettings')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <TwofaSettings />, host)
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

beforeEach(() => {
  requests.length = 0
  toasts.length = 0
  statusResponse = () => Promise.resolve(json({ enabled: false, recoveryCodesLeft: 0 }))
  setupResponse = () =>
    Promise.resolve(json({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauthUri: 'otpauth://x' }))
  enableResponse = () => Promise.resolve(json({ recoveryCodes: CODES }))
  disableResponse = () => Promise.resolve(json({ ok: true }))
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.resetModules()
})

describe('enrollment', () => {
  it('Enable fetches a secret and shows it with the otpauth link', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
    await flush()

    expect(requests.map((r) => r.url)).toContain('/api/auth/2fa/setup')
    expect(host.querySelector('[data-test-id="twofa-secret"]')!.textContent).toContain(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    )
    expect(
      host.querySelector<HTMLAnchorElement>('[data-test-id="twofa-otpauth"]')!.getAttribute('href')
    ).toBe('otpauth://x')
  })

  it('confirming a code stores it and shows the ten recovery codes once', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
    await flush()
    type('[data-test-id="twofa-enroll-code"]', '123456')
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enroll-confirm"]')!.click()
    await flush()

    const enable = requests.find((r) => r.url === '/api/auth/2fa/enable')
    expect(enable?.body).toEqual({ code: '123456' })
    const codesBox = host.querySelector('[data-test-id="twofa-recovery-codes"]')!
    for (const code of CODES) expect(codesBox.textContent).toContain(code)
  })

  it('a rejected code keeps the enroll step and shows the message', async () => {
    enableResponse = () => Promise.resolve(json({ error: 'That code did not match' }, 401))
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
    await flush()
    type('[data-test-id="twofa-enroll-code"]', '000000')
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enroll-confirm"]')!.click()
    await flush()

    expect(host.querySelector('[data-test-id="twofa-error"]')!.textContent).toContain(
      'That code did not match'
    )
    expect(host.querySelector('[data-test-id="twofa-enroll-code"]')).not.toBeNull()
  })
})

describe('enabled state and disable', () => {
  beforeEach(() => {
    statusResponse = () => Promise.resolve(json({ enabled: true, recoveryCodesLeft: 7 }))
  })

  it('shows the enabled badge and how many recovery codes remain', async () => {
    await mount()
    expect(host.querySelector('[data-test-id="twofa-enabled-badge"]')).not.toBeNull()
    expect(host.textContent).toContain('7')
  })

  it('disable demands a code, posts it, and returns to the disabled state', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()
    statusResponse = () => Promise.resolve(json({ enabled: false, recoveryCodesLeft: 0 }))
    type('[data-test-id="twofa-disable-code"]', '654321')
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-confirm"]')!.click()
    await flush()

    const disable = requests.find((r) => r.url === '/api/auth/2fa/disable')
    expect(disable?.body).toEqual({ code: '654321' })
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="twofa-enable-btn"]')).not.toBeNull()
    })
  })
})
