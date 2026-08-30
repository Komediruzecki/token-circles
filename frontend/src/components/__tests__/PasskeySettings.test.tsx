/**
 * PasskeySettings — list, add (real webauthn glue against a stubbed navigator.credentials),
 * and delete. Hidden entirely on browsers without WebAuthn.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const requests: { url: string; method: string; body: unknown }[] = []
const toasts: { message: string; type: string }[] = []
let listResponse: () => Promise<Response> = () => Promise.resolve(json({ passkeys: [] }))
const optionsResponse: () => Promise<Response> = () =>
  Promise.resolve(json({ challenge: 'Y2hhbGxlbmdl', rp: { id: 'localhost' }, user: { id: 'MQ' } }))
/** When set, register/options is answered by this, with the parsed request body. */
let optionsResponseOverride: ((body?: { reauth?: string }) => Promise<Response>) | null = null
const verifyResponse: () => Promise<Response> = () =>
  Promise.resolve(json({ ok: true, id: 'cred-1', name: 'This device' }))
let confirmAnswer = true

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const createdCalls: unknown[] = []

function stubWebauthn(present = true) {
  if (!present) return
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
  const fakeCredential = {
    rawId: new TextEncoder().encode('raw-credential-id').buffer,
    response: {
      clientDataJSON: new TextEncoder().encode('{"fake":1}').buffer,
      attestationObject: new TextEncoder().encode('attestation').buffer,
      getTransports: () => ['internal'],
    },
    type: 'public-key',
  }
  // Redefine only `credentials` on the real navigator: replacing the whole object would
  // strip its prototype, and the component never touches anything else on it.
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: {
      create: (opts: unknown) => {
        createdCalls.push(opts)
        return Promise.resolve(fakeCredential)
      },
      get: () => Promise.resolve(null),
    },
  })
}

async function mount(webauthnPresent = true) {
  vi.resetModules()
  stubWebauthn(webauthnPresent)
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined
      requests.push({ url, method, body })
      if (url === '/api/auth/passkeys' && method === 'GET') return listResponse()
      if (url === '/api/auth/passkeys/register/options') {
        return optionsResponseOverride
          ? optionsResponseOverride(body as { reauth?: string } | undefined)
          : optionsResponse()
      }
      if (url === '/api/auth/passkeys/register/verify') return verifyResponse()
      if (method === 'DELETE') return Promise.resolve(json({ ok: true }))
      return Promise.resolve(json({ error: 'unexpected' }, 500))
    },
  }))
  vi.doMock('../../core/confirmStore', () => ({
    showConfirm: () => Promise.resolve(confirmAnswer),
  }))
  const { default: PasskeySettings } = await import('../PasskeySettings')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <PasskeySettings />, host)
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  requests.length = 0
  toasts.length = 0
  createdCalls.length = 0
  confirmAnswer = true
  optionsResponseOverride = null
  listResponse = () => Promise.resolve(json({ passkeys: [] }))
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('support gate', () => {
  it('renders nothing when the browser has no WebAuthn', async () => {
    await mount(false)
    expect(host.textContent).toBe('')
  })
})

describe('listing', () => {
  it('shows registered passkeys with their names', async () => {
    listResponse = () =>
      Promise.resolve(
        json({
          passkeys: [
            { id: 'a', name: 'Laptop', backed_up: 1, created_at: '2026-08-01', last_used_at: null },
          ],
        })
      )
    await mount()
    expect(host.textContent).toContain('Laptop')
  })
})

describe('adding', () => {
  it('runs options -> navigator.credentials.create -> verify with converted fields', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="passkey-add"]')!.click()
    await flush()

    expect(requests.map((r) => r.url)).toContain('/api/auth/passkeys/register/options')
    expect(createdCalls).toHaveLength(1)
    const verify = requests.find((r) => r.url === '/api/auth/passkeys/register/verify')!
    const sent = verify.body as { response: { rawId: string; type: string } }
    // ArrayBuffers from the authenticator arrive base64url-encoded at the API.
    expect(sent.response.rawId).toBe('cmF3LWNyZWRlbnRpYWwtaWQ')
    expect(sent.response.type).toBe('public-key')
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.type === 'success')).toBe(true)
    })
  })
})

describe('re-authentication', () => {
  it('a stale session gets an inline confirm field, and the retry carries the proof', async () => {
    let optionsCalls = 0
    optionsResponseOverride = (body?: { reauth?: string }) => {
      optionsCalls += 1
      if (!body?.reauth) {
        return Promise.resolve(
          json(
            { error: 'Confirm your password (or a 2FA code) to add a passkey', reauth: true },
            401
          )
        )
      }
      return Promise.resolve(
        json({ challenge: 'Y2hhbGxlbmdl', rp: { id: 'localhost' }, user: { id: 'MQ' } })
      )
    }
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="passkey-add"]')!.click()
    await flush()

    // No browser ceremony yet — the server asked for proof first.
    expect(createdCalls).toHaveLength(0)
    const input = host.querySelector<HTMLInputElement>('[data-test-id="passkey-reauth-input"]')!
    expect(input).not.toBeNull()
    input.focus()
    input.value = 'hunter2-password'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector<HTMLButtonElement>('[data-test-id="passkey-reauth-confirm"]')!.click()
    await flush()

    expect(optionsCalls).toBe(2)
    const retry = requests.filter((r) => r.url === '/api/auth/passkeys/register/options').pop()!
    expect((retry.body as { reauth?: string }).reauth).toBe('hunter2-password')
    expect(createdCalls).toHaveLength(1)
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.type === 'success')).toBe(true)
    })
  })
})

describe('deleting', () => {
  it('confirms, then DELETEs the credential', async () => {
    listResponse = () =>
      Promise.resolve(
        json({
          passkeys: [
            {
              id: 'cred-a',
              name: 'Laptop',
              backed_up: 0,
              created_at: '2026-08-01',
              last_used_at: null,
            },
          ],
        })
      )
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="passkey-delete"]')!.click()
    await flush()

    const del = requests.find((r) => r.method === 'DELETE')
    expect(del?.url).toBe('/api/auth/passkeys/cred-a')
  })
})
