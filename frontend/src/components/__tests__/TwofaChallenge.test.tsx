/**
 * TwofaChallenge — the second login step: one code swaps the challenge cookie for a session.
 * Success reloads (the app re-checks /auth/me); a wrong code keeps the form with the server's
 * message; the recovery toggle switches what the field accepts and posts the same endpoint.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const requests: { url: string; body: unknown }[] = []
let verifyResponse: () => Promise<Response> = () => Promise.resolve(json({ id: 1 }))
let reloads = 0

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      return verifyResponse()
    },
  }))
  const { default: TwofaChallenge } = await import('../TwofaChallenge')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <TwofaChallenge />, host)
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const codeInput = () => host.querySelector<HTMLInputElement>('[data-test-id="twofa-code"]')!
const submit = () => host.querySelector<HTMLButtonElement>('[data-test-id="twofa-submit"]')!

async function enterAndSubmit(code: string) {
  const input = codeInput()
  input.focus()
  input.value = code
  input.dispatchEvent(new Event('input', { bubbles: true }))
  submit().click()
  await flush()
}

beforeEach(() => {
  requests.length = 0
  reloads = 0
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

describe('verifying', () => {
  it('posts the code to /api/auth/2fa/verify and reloads on success', async () => {
    await mount()
    await enterAndSubmit('123456')

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('/api/auth/2fa/verify')
    expect(requests[0]!.body).toEqual({ code: '123456' })
    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
  })

  it('keeps the form and shows the server message on a wrong code', async () => {
    verifyResponse = () => Promise.resolve(json({ error: 'That code did not match' }, 401))
    await mount()
    await enterAndSubmit('000000')

    expect(reloads).toBe(0)
    expect(host.querySelector('[data-test-id="twofa-error"]')!.textContent).toContain(
      'That code did not match'
    )
    expect(codeInput()).not.toBeNull()
  })

  it('refuses to submit an empty code without a network call', async () => {
    await mount()
    submit().click()
    await flush()
    expect(requests).toHaveLength(0)
  })
})

describe('recovery fallback', () => {
  it('switches the field to recovery format and posts the recovery code', async () => {
    await mount()
    host.querySelector<HTMLElement>('[data-test-id="twofa-use-recovery"]')!.click()
    await flush()
    await enterAndSubmit('ABCDE-FGHIJ')

    expect(requests[0]!.body).toEqual({ code: 'ABCDE-FGHIJ' })
    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
  })
})
