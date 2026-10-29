/**
 * The captcha gate on its own (captchaGate.ts): when a send gets its token, when it holds and when
 * it steps back, and when the widget is asked for the next token. The forms' side of the same
 * rules is in captchaForms.test.tsx; this file covers what no screen shows, such as the 20 seconds
 * with no token at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function makeGate() {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
  const gateModule = await import('../captchaGate')
  const { NOT_SENT } = await import('../form')
  const { captchaStatusMessage } = await import('../Turnstile')
  const gate = gateModule.createCaptchaGate()
  let resets = 0
  // What Turnstile hands over once it has drawn the widget: a reset starts the check over.
  gate.onWidget(() => {
    resets += 1
    gate.onStatus('ready')
  })
  gate.onStatus('ready')
  return {
    gate,
    NOT_SENT,
    CAPTCHA_REFUSED: gateModule.CAPTCHA_REFUSED,
    CHECKING: gateModule.CHECKING_YOU_ARE_HUMAN,
    captchaStatusMessage,
    resets: () => resets,
  }
}

/** The outcome of a promise, without letting a rejection go unhandled. */
const outcome = (p: Promise<string>) =>
  p.then(
    (token) => ({ token, error: undefined as unknown }),
    (error: unknown) => ({ token: undefined, error })
  )

describe('a send', () => {
  it('takes the token in hand, once', async () => {
    const { gate } = await makeGate()
    gate.onToken('token-1')

    expect(await gate.next()).toBe('token-1')
    expect(gate.token()).toBe('')
  })

  it('holds for the next token, and the button says it is checking', async () => {
    const { gate, CHECKING } = await makeGate()
    const sent = outcome(gate.next())
    expect(gate.holding()).toBe(true)
    expect(gate.busyLabel('Signing in…')).toBe(CHECKING)

    gate.onToken('token-1')
    expect(await sent).toEqual({ token: 'token-1', error: undefined })
    expect(gate.holding()).toBe(false)
    expect(gate.busyLabel('Signing in…')).toBe('Signing in…')
  })

  it('steps back without a word when the box comes up during the hold', async () => {
    const { gate, NOT_SENT, resets } = await makeGate()
    const sent = outcome(gate.next())

    gate.onStatus('interactive')
    expect((await sent).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(false)
    expect(gate.asking()).toBe(true)
    // Resetting a box that waits for a tick would only draw it again.
    gate.explain(NOT_SENT)
    gate.spent()
    expect(resets()).toBe(0)
  })

  it('steps back at once while the box waits, whatever started it', async () => {
    const { gate, NOT_SENT } = await makeGate()
    gate.onStatus('interactive')

    expect((await outcome(gate.next())).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(false)
  })

  it('says what to fix when the widget fails during the hold', async () => {
    const { gate, captchaStatusMessage } = await makeGate()
    const sent = outcome(gate.next())

    gate.onStatus('failed')
    const { error } = await sent
    expect(error).toMatchObject({ status: 403, message: captchaStatusMessage('failed') })
  })

  it('says so after 20 seconds with no token, and starts the check over', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const { gate, CAPTCHA_REFUSED, resets } = await makeGate()
    const sent = outcome(gate.next())

    await vi.advanceTimersByTimeAsync(19000)
    expect(gate.holding()).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)

    expect((await sent).error).toMatchObject({ status: 403, message: CAPTCHA_REFUSED })
    expect(gate.holding()).toBe(false)
    expect(resets()).toBe(1)
  })
})

describe('the next check', () => {
  it('starts at once after a send that failed', async () => {
    const { gate, resets } = await makeGate()
    gate.onToken('token-1')
    await gate.next()

    gate.explain(new Error('401'))
    gate.spent()
    expect(resets()).toBe(1)
  })

  it('waits for the person after a send that worked: back in the form, or the next press', async () => {
    const { gate, resets } = await makeGate()
    gate.onToken('token-1')
    await gate.next()
    gate.spent()
    expect(resets()).toBe(0)

    gate.wake()
    expect(resets()).toBe(1)
    gate.wake()
    expect(resets()).toBe(1)

    gate.onToken('token-2')
    await gate.next()
    gate.spent()
    const sent = outcome(gate.next())
    expect(resets()).toBe(2)
    expect(gate.holding()).toBe(true)
    gate.onToken('token-3')
    expect((await sent).token).toBe('token-3')
  })

  it('is not asked for when no token went out', async () => {
    const { gate, resets } = await makeGate()
    gate.onStatus('unreachable')
    await outcome(gate.next())
    gate.explain(new Error('blocked'))
    gate.spent()

    expect(resets()).toBe(0)
  })

  it('is left to a widget drawn anew, which runs its own', async () => {
    const { gate, resets } = await makeGate()
    gate.onToken('token-1')
    await gate.next()
    gate.spent()

    // The sign-in screen's other steps unmount the widget; coming back draws a new one.
    let newResets = 0
    gate.onWidget(undefined)
    gate.onWidget(() => {
      newResets += 1
    })
    gate.wake()
    expect(resets()).toBe(0)
    expect(newResets).toBe(0)
  })
})
