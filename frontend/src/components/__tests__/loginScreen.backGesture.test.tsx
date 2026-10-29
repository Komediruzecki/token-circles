/**
 * The phone's back gesture on the sign-in screen. Each step after the form (a code by email, the
 * second factor, Check your inbox) lives in memory, so in an installed app the gesture had no
 * history entry to pop and closed the app. Entering a step now adds one entry; the gesture takes
 * it back to the form, and leaving through the step's own Back takes the entry with it.
 *
 * The real screen and its steps, against jsdom's real history, with only the network answered.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { historySettled } from './historySettled'
import type * as TurnstileModule from '../Turnstile'

let host: HTMLDivElement
let dispose: (() => void) | undefined
let answers: Record<string, () => Response>
/** Whether the browser offers passkeys, and whether autofill offers one that signs in. */
let passkeys = false
let conditional = false

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string) => {
      const answer = answers[url]
      if (!answer) throw new Error(`nothing answers ${url} here`)
      return Promise.resolve(answer())
    },
  }))
  vi.doMock('../Turnstile', async () => ({
    ...(await vi.importActual<typeof TurnstileModule>('../Turnstile')),
    default: () => null,
    turnstileEnabled: false,
  }))
  vi.doMock('../../core/webauthn', () => ({
    conditionalMediationAvailable: () => Promise.resolve(conditional),
    markPasskeyNudgeAfterLogin: () => undefined,
    passkeysSupported: () => passkeys,
    signInWithPasskey: () =>
      Promise.resolve(
        passkeys || conditional ? { ok: true } : { ok: false, error: 'x', aborted: true }
      ),
  }))
  vi.doMock('../../core/appVersion', () => ({ displayVersion: () => '9.9.9' }))
  vi.doMock('../../core/storage/storageFactory', () => ({
    getStorageMode: () => 'self-hosted',
    setStorageMode: () => undefined,
  }))
  vi.doMock('../SupportContact', () => ({ default: () => null }))
  const { default: LoginScreen } = await import('../LoginScreen')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <LoginScreen />, host)
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * The next popstate, or false when none comes. jsdom traverses history on a later task. The limit
 * only stops a missing pop from hanging the test: a pop that comes resolves at once, and on a loaded
 * runner a mount (fresh module imports) inside the wait can take longer than 300 ms on its own.
 */
function nextPop(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('popstate', popped)
      resolve(false)
    }, 2000)
    const popped = () => {
      clearTimeout(timer)
      resolve(true)
    }
    window.addEventListener('popstate', popped, { once: true })
  })
}

/** What the phone's back gesture does: one step back in history. */
async function backGesture() {
  const popped = nextPop()
  history.back()
  expect(await popped).toBe(true)
  await settle()
}

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const onTheForm = () => host.querySelector('#login-email') !== null
const BEFORE = { test: 'before the sign-in screen' }

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function openEmailCode() {
  byTestId('emailcode-open')!.click()
  await settle()
}

async function sendCode() {
  type(
    host.querySelector<HTMLInputElement>('[data-test-id="emailcode-email"]')!,
    'name@example.com'
  )
  byTestId('emailcode-send')!.click()
  await settle()
}

async function verifyCode() {
  type(host.querySelector<HTMLInputElement>('[data-test-id="emailcode-code"]')!, '123456')
  byTestId('emailcode-verify')!.click()
  await settle()
}

async function createAccount() {
  button('Create one').click()
  await settle()
  type(host.querySelector<HTMLInputElement>('#login-email')!, 'name@example.com')
  type(host.querySelector<HTMLInputElement>('#login-password')!, 'a-new-password')
  host.querySelector('form')!.requestSubmit()
  await settle()
}

let length: number

beforeEach(() => {
  sessionStorage.clear()
  answers = {
    '/api/auth/email-code/request': () => json({ ok: true }),
    '/api/auth/email-code/verify': () => json({ id: 1 }),
    '/api/auth/register': () => json({ ok: true }),
  }
  // A fresh entry to start from, with nothing ahead of it.
  history.pushState(BEFORE, '', '/')
  length = history.length
})

afterEach(async () => {
  dispose?.()
  dispose = undefined
  host?.remove()
  // A screen unmounted on a step takes its entry back: let that land before the next test.
  await historySettled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  passkeys = false
  conditional = false
})

describe('the back gesture returns to the form', () => {
  it('from asking for a code by email', async () => {
    await mount()
    await openEmailCode()
    expect(history.length).toBe(length + 1)

    await backGesture()

    expect(onTheForm()).toBe(true)
    expect(history.state).toEqual(BEFORE)
  })

  it('from entering the emailed code', async () => {
    await mount()
    await openEmailCode()
    await sendCode()
    expect(byTestId('emailcode-code')).not.toBeNull()

    await backGesture()

    expect(onTheForm()).toBe(true)
    expect(history.state).toEqual(BEFORE)
  })

  it('from the second factor, reached from the emailed code, with one entry for both', async () => {
    answers['/api/auth/email-code/verify'] = () => json({ twofaRequired: true })
    await mount()
    await openEmailCode()
    await sendCode()
    await verifyCode()
    expect(byTestId('twofa-code')).not.toBeNull()
    expect(history.length).toBe(length + 1)

    await backGesture()

    expect(onTheForm()).toBe(true)
    expect(history.state).toEqual(BEFORE)
  })

  it('from the second factor the Google callback lands on, leaving no ?twofa=1 to reopen it', async () => {
    history.replaceState(BEFORE, '', '/?twofa=1')
    await mount()
    expect(byTestId('twofa-code')).not.toBeNull()
    // A reload while on the step keeps it.
    expect(window.location.search).toBe('?twofa=1')

    await backGesture()

    expect(onTheForm()).toBe(true)
    expect(window.location.search).toBe('')
    expect(history.state).toEqual(BEFORE)
  })

  it('from Check your inbox, on the sign-in form with the address kept', async () => {
    await mount()
    await createAccount()
    expect(byTestId('check-inbox-lead')).not.toBeNull()

    await backGesture()

    expect(onTheForm()).toBe(true)
    expect(host.querySelector<HTMLInputElement>('#login-email')!.value).toBe('name@example.com')
    expect(host.querySelector('#login-password')).not.toBeNull()
    expect(history.state).toEqual(BEFORE)
  })
})

describe('leaving a step through its own Back', () => {
  it('takes the entry with it, every time, so history does not grow', async () => {
    await mount()
    for (let round = 0; round < 3; round += 1) {
      await openEmailCode()
      expect(history.length).toBe(length + 1)
      const popped = nextPop()
      byTestId('emailcode-back')!.click()
      expect(await popped).toBe(true)
      await settle()

      expect(onTheForm()).toBe(true)
      expect(history.state).toEqual(BEFORE)
    }
    expect(history.length).toBe(length + 1)
  })

  it('from the code step too', async () => {
    await mount()
    await openEmailCode()
    await sendCode()
    const popped = nextPop()
    byTestId('emailcode-verify-back')!.click()
    expect(await popped).toBe(true)
    await settle()

    expect(onTheForm()).toBe(true)
    expect(history.state).toEqual(BEFORE)
  })

  it('from the second factor the Google callback lands on, with ?twofa=1 gone', async () => {
    history.replaceState(BEFORE, '', '/?twofa=1')
    await mount()
    const popped = nextPop()
    byTestId('twofa-back')!.click()
    expect(await popped).toBe(true)
    await settle()

    expect(onTheForm()).toBe(true)
    expect(window.location.search).toBe('')
    expect(history.state).toEqual(BEFORE)
  })

  it('from Check your inbox', async () => {
    await mount()
    await createAccount()
    const popped = nextPop()
    byTestId('check-inbox-back')!.click()
    expect(await popped).toBe(true)
    await settle()

    expect(onTheForm()).toBe(true)
    expect(history.state).toEqual(BEFORE)
  })
})

describe('signing in from a step', () => {
  it('takes the entry back before the reload, so the back gesture in the app is not swallowed', async () => {
    let atReload: { state: unknown; onTheCodeStep: boolean } | undefined
    await mount()
    await openEmailCode()
    await sendCode()
    expect(history.length).toBe(length + 1)
    // Only the reload is stubbed: the screen reads nothing else from location on this path.
    const real = window.location
    vi.stubGlobal('location', {
      get search() {
        return real.search
      },
      get href() {
        return real.href
      },
      reload: () => {
        atReload = {
          state: history.state,
          onTheCodeStep: byTestId('emailcode-code') !== null,
        }
      },
    } as unknown as Location)

    await verifyCode()
    for (let i = 0; i < 20 && atReload === undefined; i += 1) await settle()

    // Back on the entry from before the step, and the step stayed on screen while it got there:
    // no flash of the form before the app loads.
    expect(atReload).toEqual({ state: BEFORE, onTheCodeStep: true })
  })
})

describe('once the screen is gone', () => {
  it('stops listening for the back gesture', async () => {
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    await mount()
    const listening = added.mock.calls
      .filter(([type]) => (type as string) === 'popstate')
      .map(([, fn]) => fn)
    expect(listening.length).toBeGreaterThan(0)

    dispose?.()
    dispose = undefined

    const stopped = removed.mock.calls
      .filter(([type]) => (type as string) === 'popstate')
      .map(([, fn]) => fn)
    expect(stopped).toEqual(expect.arrayContaining(listening))
    added.mockRestore()
    removed.mockRestore()
  })
})

describe('a page reloaded while on a step', () => {
  it('lands on the form and takes the entry it reloaded on back, so the gesture is not swallowed', async () => {
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    const popped = nextPop()
    await mount()
    expect(await popped).toBe(true)
    await settle()

    expect(onTheForm()).toBe(true)
    expect(history.state).toEqual(BEFORE)
  })

  it('on the second factor the Google callback landed on, stays on it and keeps its one entry', async () => {
    history.replaceState(BEFORE, '', '/')
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '', '/?twofa=1')
    const reloadedAt = history.length
    await mount()
    expect(byTestId('twofa-code')).not.toBeNull()
    expect(history.length).toBe(reloadedAt)
    expect(window.location.search).toBe('?twofa=1')

    await backGesture()

    expect(onTheForm()).toBe(true)
    expect(window.location.search).toBe('')
    expect(history.state).toEqual(BEFORE)
  })
})

describe('leaving the screen while a step entry is still on its way back', () => {
  /**
   * Mounted on an entry a reload left behind, with the traversal that takes it back held until the
   * test lets it go: whatever leaves the screen meanwhile must wait for it.
   */
  async function mountWhileUnwinding(): Promise<() => Promise<void>> {
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    let held: number | undefined
    const go = vi.spyOn(history, 'go').mockImplementation((delta?: number) => {
      held = delta
    })
    await mount()
    expect(held).toBe(-1)
    return async () => {
      go.mockRestore()
      const popped = nextPop()
      history.go(held)
      expect(await popped).toBe(true)
      for (let i = 0; i < 4; i += 1) await settle()
    }
  }

  let gone: { how: string; state: unknown }[]
  beforeEach(() => {
    gone = []
    const real = window.location
    vi.stubGlobal('location', {
      get href() {
        return real.href
      },
      set href(url: string) {
        gone.push({ how: url, state: history.state })
      },
      get search() {
        return real.search
      },
      // The screen reads the fragment as it mounts: #forgot-password opens it on the reset form.
      get hash() {
        return real.hash
      },
      reload: () => {
        gone.push({ how: 'reload', state: history.state })
      },
    } as unknown as Location)
  })

  it('Continue with no account', async () => {
    const release = await mountWhileUnwinding()
    byTestId('try-no-account')!.click()
    expect(gone).toEqual([])

    await release()
    expect(gone).toEqual([{ how: 'reload', state: BEFORE }])
  })

  it('Continue with Google', async () => {
    const release = await mountWhileUnwinding()
    button('Continue with Google').click()
    expect(gone).toEqual([])

    await release()
    expect(gone).toEqual([{ how: '/api/auth/google/start', state: BEFORE }])
  })

  it('Sign in with a passkey', async () => {
    passkeys = true
    const release = await mountWhileUnwinding()
    byTestId('passkey-signin')!.click()
    await settle()
    expect(gone).toEqual([])

    await release()
    expect(gone).toEqual([{ how: 'reload', state: BEFORE }])
  })

  it('a passkey picked from autofill', async () => {
    conditional = true
    const release = await mountWhileUnwinding()
    await settle()
    expect(gone).toEqual([])

    await release()
    expect(gone).toEqual([{ how: 'reload', state: BEFORE }])
  })
})
