/**
 * The phone's back gesture on the sign-in dialog. The dialog and its steps lived in memory only, so
 * in an installed app the gesture had no history entry to pop and closed the app under the dialog.
 * The open dialog now has one entry, and each of its steps one above it: the gesture takes a step
 * back to the dialog's form, and the dialog's form back to the app. Closing the dialog any other
 * way, or signing in from it, takes those entries with it.
 *
 * The real dialog and its steps, against jsdom's real history, with only the network answered.
 */
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { historySettled } from './historySettled'
import type * as TurnstileModule from '../Turnstile'

let host: HTMLDivElement
let dispose: (() => void) | undefined
let answers: Record<string, () => Response>
let closes: number
let passkeys: boolean
/** What the screen looked like when the page reloaded; undefined until it does. */
let atReload: { state: unknown; open: boolean } | undefined
/** Where the page went, and the history state it left from; undefined until it goes. */
let leftFor: { url: string; state: unknown; open: boolean } | undefined

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The dialog as App mounts it: open until its onClose. */
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
    markPasskeyNudgeAfterLogin: () => undefined,
    passkeysSupported: () => passkeys,
    signInWithPasskey: () => Promise.resolve({ ok: true }),
  }))
  const { default: LoginModal } = await import('../LoginModal')
  host = document.createElement('div')
  document.body.appendChild(host)
  const [open, setOpen] = createSignal(true)
  dispose = render(
    () => (
      <Show when={open()}>
        <LoginModal
          onClose={() => {
            closes += 1
            setOpen(false)
          }}
          onSuccess={() => undefined}
        />
      </Show>
    ),
    host
  )
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
/** The dialog's title, there whichever step it is on. */
const isOpen = () => host.querySelector('h3')
const onTheForm = () => host.querySelector('#login-modal-email') !== null
const BEFORE = { test: 'before the dialog' }

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
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

async function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await settle()
}

/** Waits for the page to reload, a few tasks at most. */
async function reloaded() {
  for (let i = 0; i < 20 && atReload === undefined; i += 1) await settle()
  return atReload
}

let length: number

beforeEach(() => {
  sessionStorage.clear()
  closes = 0
  passkeys = false
  atReload = undefined
  leftFor = undefined
  answers = {
    '/api/auth/email-code/request': () => json({ ok: true }),
    '/api/auth/email-code/verify': () => json({ id: 1 }),
    '/api/auth/login': () => json({ id: 1 }),
  }
  // A fresh entry to start from, with nothing ahead of it.
  history.pushState(BEFORE, '', '/')
  length = history.length
  // Only the reload is stubbed: nothing on these paths reads anything else from location.
  const real = window.location
  vi.stubGlobal('location', {
    get href() {
      return real.href
    },
    set href(url: string) {
      leftFor = { url, state: history.state, open: isOpen() !== null }
    },
    get search() {
      return real.search
    },
    reload: () => {
      atReload = { state: history.state, open: isOpen() !== null }
    },
  } as unknown as Location)
})

afterEach(async () => {
  dispose?.()
  dispose = undefined
  host?.remove()
  // A dialog unmounted on its entry takes it back: let that land before the next test's history.
  await historySettled()
  vi.unstubAllGlobals()
})

describe('the back gesture', () => {
  it('closes the dialog', async () => {
    await mount()
    expect(history.length).toBe(length + 1)

    await backGesture()

    expect(closes).toBe(1)
    expect(isOpen()).toBeNull()
    expect(history.state).toEqual(BEFORE)
  })

  it('takes a step back to the dialog form first, then closes the dialog', async () => {
    await mount()
    await openEmailCode()
    await sendCode()
    expect(byTestId('emailcode-code')).not.toBeNull()
    expect(history.length).toBe(length + 2)

    await backGesture()
    expect(onTheForm()).toBe(true)
    expect(closes).toBe(0)

    await backGesture()
    expect(closes).toBe(1)
    expect(history.state).toEqual(BEFORE)
  })
})

describe('closing the dialog by its own controls takes the entry with it', () => {
  it('Cancel, every time, so history does not grow', async () => {
    for (let round = 0; round < 3; round += 1) {
      await mount()
      expect(history.length).toBe(length + 1)
      const cancel = [...host.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Cancel'
      )!
      const popped = nextPop()
      cancel.click()
      expect(await popped).toBe(true)
      await settle()

      expect(closes).toBe(round + 1)
      expect(isOpen()).toBeNull()
      expect(history.state).toEqual(BEFORE)
      dispose?.()
      dispose = undefined
      host.remove()
    }
  })

  it('Escape from a step, with the step entry gone too', async () => {
    await mount()
    await openEmailCode()
    expect(history.length).toBe(length + 2)
    const popped = nextPop()
    await escape()
    expect(await popped).toBe(true)
    await settle()

    expect(closes).toBe(1)
    expect(history.state).toEqual(BEFORE)
  })

  it('a click outside', async () => {
    await mount()
    const popped = nextPop()
    host.querySelector<HTMLElement>('div')!.click()
    expect(await popped).toBe(true)
    await settle()

    expect(closes).toBe(1)
    expect(history.state).toEqual(BEFORE)
  })

  it('Escape twice closes once, and goes back to the entry before the dialog', async () => {
    await mount()
    expect(history.length).toBe(length + 1)
    const go = vi.spyOn(history, 'go')
    const popped = nextPop()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(await popped).toBe(true)
    await settle()

    expect(go.mock.calls).toEqual([[-1]])
    expect(closes).toBe(1)
    expect(history.state).toEqual(BEFORE)
    go.mockRestore()
  })

  it('a step left by its own Back leaves the dialog one entry, which the gesture still closes', async () => {
    await mount()
    await openEmailCode()
    const popped = nextPop()
    byTestId('emailcode-back')!.click()
    expect(await popped).toBe(true)
    await settle()
    expect(onTheForm()).toBe(true)
    expect(history.length).toBe(length + 2)

    await backGesture()

    expect(closes).toBe(1)
    expect(history.state).toEqual(BEFORE)
  })
})

describe('signing in from the dialog reloads with no entry of its own left', () => {
  it('with a password', async () => {
    await mount()
    expect(history.length).toBe(length + 1)
    type(host.querySelector<HTMLInputElement>('#login-modal-email')!, 'name@example.com')
    type(host.querySelector<HTMLInputElement>('#login-modal-password')!, 'a-password')
    host.querySelector('form')!.requestSubmit()

    expect(await reloaded()).toEqual({ state: BEFORE, open: true })
  })

  it('with the emailed code, from the step above the dialog', async () => {
    await mount()
    await openEmailCode()
    await sendCode()
    expect(history.length).toBe(length + 2)
    type(host.querySelector<HTMLInputElement>('[data-test-id="emailcode-code"]')!, '123456')
    byTestId('emailcode-verify')!.click()

    expect(await reloaded()).toEqual({ state: BEFORE, open: true })
  })

  it('with a passkey', async () => {
    passkeys = true
    await mount()
    expect(history.length).toBe(length + 1)
    byTestId('passkey-signin')!.click()

    expect(await reloaded()).toEqual({ state: BEFORE, open: true })
  })

  it('with Google, leaving for it from the entry before the dialog', async () => {
    await mount()
    expect(history.length).toBe(length + 1)
    const google = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Continue with Google'
    )!
    google.click()
    for (let i = 0; i < 20 && leftFor === undefined; i += 1) await settle()

    // Closed before leaving: a page the browser restores on the way back shows no dialog.
    expect(leftFor).toEqual({ url: '/api/auth/google/start', state: BEFORE, open: false })
    expect(closes).toBe(1)
  })
})
