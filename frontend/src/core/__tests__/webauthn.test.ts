/**
 * webauthn.ts glue — the conditional-mediation path: the browser call must carry
 * mediation: 'conditional' and the caller's AbortSignal, and an abort must come back as
 * a quiet { aborted: true }, never a red error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getCalls: { mediation?: string; signal?: AbortSignal }[] = []
let getResult: () => Promise<unknown> = () => Promise.resolve(null)

beforeEach(() => {
  getCalls.length = 0
  getResult = () => Promise.resolve(null)
  vi.resetModules()
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: {
      get: (opts: { mediation?: string; signal?: AbortSignal }) => {
        getCalls.push({ mediation: opts.mediation, signal: opts.signal })
        return getResult()
      },
      create: () => Promise.resolve(null),
    },
  })
  vi.doMock('../apiFetch', () => ({
    apiFetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ challenge: 'Y2hhbGxlbmdl' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('signInWithPasskey', () => {
  it('passes conditional mediation and the abort signal through to the browser', async () => {
    const { signInWithPasskey } = await import('../webauthn')
    const controller = new AbortController()
    getResult = () => Promise.resolve(null)
    await signInWithPasskey({ conditional: true, signal: controller.signal })

    expect(getCalls).toHaveLength(1)
    expect(getCalls[0].mediation).toBe('conditional')
    expect(getCalls[0].signal).toBe(controller.signal)
  })

  it('an aborted conditional request resolves quietly, not as an error', async () => {
    const { signInWithPasskey } = await import('../webauthn')
    getResult = () => Promise.reject(new DOMException('aborted', 'AbortError'))
    const result = await signInWithPasskey({ conditional: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.aborted).toBe(true)
  })
})
