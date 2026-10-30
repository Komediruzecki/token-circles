/**
 * The captcha gate on its own (captchaGate.ts): when a send gets its token, when it holds and when
 * it steps back, and when the widget is asked for the next token. The forms' side of the same
 * rules is in captchaForms.test.tsx; this file covers what no screen shows, such as the 20 seconds
 * with no token at all, or two presses holding at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function makeGate(options?: { signingIn?: () => boolean }) {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
  const gateModule = await import('../captchaGate')
  const { NOT_SENT } = await import('../form')
  const { captchaStatusMessage } = await import('../Turnstile')
  const { ApiError } = await import('../../core/apiError')
  const gate = gateModule.createCaptchaGate(options)
  let resets = 0
  /** What Turnstile.tsx tells the gate, as Cloudflare's frame drives it. */
  const widget = {
    drawn: () => {
      gate.onWidget(() => {
        resets += 1
        gate.onStatus('ready')
      })
      gate.onStatus('ready')
    },
    pass: (token: string) => {
      gate.onToken(token)
      gate.onStatus('solved')
    },
    ask: () => {
      gate.onStatus('interactive')
    },
    gone: () => {
      gate.onWidget(undefined)
      gate.onToken('')
    },
  }
  widget.drawn()
  /** The Worker's answer to a sign-in: `status`, saying the check covers `seconds` more of them. */
  const answer = (status: number, seconds?: number) => {
    const error = new ApiError(status, 'Invalid email or password')
    if (seconds !== undefined) error.checkValidFor = seconds
    return error
  }
  return {
    gate,
    widget,
    NOT_SENT,
    CAPTCHA_REFUSED: gateModule.CAPTCHA_REFUSED,
    CHECKING: gateModule.CHECKING_YOU_ARE_HUMAN,
    captchaStatusMessage,
    resets: () => resets,
    answer,
  }
}

/** The outcome of a promise, without letting a rejection go unhandled. */
const outcome = (p: Promise<string>) =>
  p.then(
    (token) => ({ token, error: undefined as unknown }),
    (error: unknown) => ({ token: undefined, error })
  )

/** Whether a promise has settled once the work already queued has run. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(() => {
    done = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return done
}

describe('a send', () => {
  it('takes the token in hand, once', async () => {
    const { gate, widget } = await makeGate()
    widget.pass('token-1')

    expect(await gate.next()).toBe('token-1')
    expect(gate.token()).toBe('')
  })

  it('holds for the next token, and the button says it is checking', async () => {
    const { gate, widget, CHECKING } = await makeGate()
    const sent = outcome(gate.next())
    expect(gate.holding()).toBe(true)
    expect(gate.busyLabel('Signing in…')).toBe(CHECKING)

    widget.pass('token-1')
    expect(await sent).toEqual({ token: 'token-1', error: undefined })
    expect(gate.holding()).toBe(false)
    expect(gate.busyLabel('Signing in…')).toBe('Signing in…')
  })

  it('steps back without a word when the box comes up during the hold', async () => {
    const { gate, widget, NOT_SENT, resets } = await makeGate()
    const sent = outcome(gate.next())

    widget.ask()
    expect((await sent).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(false)
    expect(gate.asking()).toBe(true)
    // Resetting a box that waits for a tick would only draw it again.
    gate.explain(NOT_SENT, undefined)
    expect(resets()).toBe(0)
  })

  it('steps back at once while the box waits, whatever started it', async () => {
    const { gate, widget, NOT_SENT } = await makeGate()
    widget.ask()

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

  it('says what to fix when Cloudflare cannot run in this browser', async () => {
    const { gate, captchaStatusMessage } = await makeGate()
    const sent = outcome(gate.next())

    gate.onStatus('unsupported')
    expect((await sent).error).toMatchObject({
      status: 403,
      message: captchaStatusMessage('unsupported'),
    })
    expect((await outcome(gate.next())).error).toMatchObject({ status: 403 })
  })
})

describe('one send holds at a time', () => {
  it('ends the earlier hold when a newer send starts, and gives the token to the newer one', async () => {
    const { gate, widget, NOT_SENT } = await makeGate()
    const first = outcome(gate.next())
    const second = outcome(gate.next())

    // The earlier press is over the moment the newer one holds: it can never send.
    expect(await settled(first)).toBe(true)
    expect((await first).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(true)

    widget.pass('token-1')
    expect((await second).token).toBe('token-1')
    expect(gate.holding()).toBe(false)
  })

  it('still steps the newer hold back when the box comes up after the earlier one ended', async () => {
    const { gate, widget, NOT_SENT } = await makeGate()
    const first = outcome(gate.next())
    const second = outcome(gate.next())
    // The earlier send has wound up completely, its `finally` included: what it left must still
    // be the newer send's hold.
    expect((await first).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(true)
    expect(gate.busyLabel('Signing in…')).not.toBe('Signing in…')

    widget.ask()
    expect((await second).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(false)
  })

  it('ends on cancel, as when the form switches to another mode', async () => {
    const { gate, widget, NOT_SENT } = await makeGate()
    const sent = outcome(gate.next())

    gate.cancel()
    expect((await sent).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(false)
    // The token that comes next is for the next press, not the cancelled one.
    widget.pass('token-1')
    expect(gate.token()).toBe('token-1')
  })

  it('ends when the widget goes, so the next widget cannot send what was left behind', async () => {
    const { gate, widget, NOT_SENT } = await makeGate()
    const sent = outcome(gate.next())

    widget.gone()
    expect((await sent).error).toBe(NOT_SENT)
    expect(gate.holding()).toBe(false)

    widget.drawn()
    widget.pass('token-from-the-new-widget')
    expect(gate.token()).toBe('token-from-the-new-widget')
  })
})

describe('a hold with no token', () => {
  it('says so after 20 seconds, and leaves a check that is only slow to finish', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] })
    const { gate, widget, CAPTCHA_REFUSED, resets } = await makeGate()
    // Cloudflare's check takes 25 seconds from the moment the widget is drawn.
    const answer = setTimeout(() => {
      widget.pass('token-1')
    }, 25000)

    const first = outcome(gate.next())
    await vi.advanceTimersByTimeAsync(20500)
    expect((await first).error).toMatchObject({ status: 403, message: CAPTCHA_REFUSED })
    expect(gate.holding()).toBe(false)
    expect(resets()).toBe(0)

    // Pressed again a few seconds later: the same check answers, and that press sends.
    await vi.advanceTimersByTimeAsync(3000)
    const second = outcome(gate.next())
    await vi.advanceTimersByTimeAsync(2000)
    expect((await second).token).toBe('token-1')
    expect(resets()).toBe(0)
    clearTimeout(answer)
  })

  it('starts over a check that has run for a minute with no answer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] })
    const { gate, resets } = await makeGate()

    for (const press of [1, 2]) {
      const held = outcome(gate.next())
      await vi.advanceTimersByTimeAsync(20500)
      expect((await held).error, `press ${press}`).toMatchObject({ status: 403 })
      expect(resets(), `press ${press}`).toBe(0)
      await vi.advanceTimersByTimeAsync(3000)
    }
    // The third press times out 68 seconds into the same check: it is stuck, not slow.
    const third = outcome(gate.next())
    await vi.advanceTimersByTimeAsync(20500)
    expect((await third).error).toMatchObject({ status: 403 })
    expect(resets()).toBe(1)
  })

  it('leaves the check Cloudflare starts after a token expires, as a check of its own', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] })
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    await vi.advanceTimersByTimeAsync(300000)
    // Five minutes on the token expires unused, and Cloudflare starts fetching the next one, slowly.
    gate.onToken('')
    gate.onStatus('expired')

    const held = outcome(gate.next())
    await vi.advanceTimersByTimeAsync(20500)
    expect((await held).error).toMatchObject({ status: 403 })
    // Twenty seconds into Cloudflare's own check, not five minutes: it is left to finish.
    expect(resets()).toBe(0)
  })
})

describe('the next check', () => {
  it('starts at once after a send that failed', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    const sent = await gate.next()

    gate.explain(new Error('401'), sent)
    expect(resets()).toBe(1)
  })

  it('is not started by a send that stepped back, even with its token in hand', async () => {
    const { gate, widget, NOT_SENT, resets } = await makeGate()
    widget.pass('token-1')
    const taken = await gate.next()

    // The form took the token and then sent nothing: nothing is news to Cloudflare's widget.
    gate.explain(NOT_SENT, taken)
    expect(resets()).toBe(0)
  })

  it('waits for the person after a send that worked: back in the form, or the next press', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    await gate.next()
    expect(resets()).toBe(0)

    gate.wake()
    expect(resets()).toBe(1)
    gate.wake()
    expect(resets()).toBe(1)

    widget.pass('token-2')
    await gate.next()
    const sent = outcome(gate.next())
    expect(resets()).toBe(2)
    expect(gate.holding()).toBe(true)
    widget.pass('token-3')
    expect((await sent).token).toBe('token-3')
  })

  it('starts at once for a press made while an earlier send is still out', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    await gate.next()

    // The reset link is still on its way when the person signs in instead.
    const sent = outcome(gate.next())
    expect(resets()).toBe(1)
    expect(gate.holding()).toBe(true)
    widget.pass('token-2')
    expect((await sent).token).toBe('token-2')
  })

  it('is not started over by a late failure while the next check is running', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    const first = await gate.next()
    const sent = outcome(gate.next())
    expect(resets()).toBe(1)

    // The earlier send fails while the press after it holds: its check is the one it waits on.
    gate.explain(new Error('503'), first)
    expect(resets()).toBe(1)
    widget.pass('token-2')
    expect((await sent).token).toBe('token-2')
  })

  it('is not started over by a late failure once a newer send has taken its token', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    const first = await gate.next()
    const second = outcome(gate.next())
    widget.pass('token-2')
    expect((await second).token).toBe('token-2')
    expect(resets()).toBe(1)

    // The reset link fails while the sign-in after it is out: a reset now would bring Cloudflare's
    // box up beside "Signing in…".
    gate.explain(new Error('429'), first)
    expect(resets()).toBe(1)
    // The newer send's own failure is the widget's news.
    gate.explain(new Error('401'), 'token-2')
    expect(resets()).toBe(2)
  })

  it('is not asked for when no token went out', async () => {
    const { gate, resets } = await makeGate()
    gate.onStatus('unreachable')
    await outcome(gate.next())
    gate.explain(new Error('blocked'), undefined)

    expect(resets()).toBe(0)
  })

  it('is not asked for when a token came by itself, as after an expired one', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    await gate.next()

    gate.onStatus('expired')
    widget.pass('token-2')
    gate.wake()
    expect(await gate.next()).toBe('token-2')
    expect(resets()).toBe(0)
  })

  it('is left to a widget drawn anew, which runs its own', async () => {
    const { gate, widget, resets } = await makeGate()
    widget.pass('token-1')
    await gate.next()

    // The sign-in screen's other steps unmount the widget; coming back draws a new one.
    widget.gone()
    let newResets = 0
    gate.onWidget(() => {
      newResets += 1
    })
    gate.onStatus('loading')
    gate.wake()
    expect(resets()).toBe(0)
    expect(newResets).toBe(0)
  })
})

describe('a solved check after a wrong password', () => {
  /** A gate on the password sign-in whose first send took token-1 and was refused. */
  async function refusedOnce(seconds?: number, signingIn: () => boolean = () => true) {
    const made = await makeGate({ signingIn })
    made.widget.pass('token-1')
    const sent = await made.gate.next()
    expect(sent).toBe('token-1')
    made.gate.explain(made.answer(401, seconds), sent)
    return made
  }

  it('covers the next sign-in: it goes at once with no token, and no check starts', async () => {
    const { gate, resets } = await refusedOnce(300)
    expect(resets()).toBe(0)

    const next = gate.next()
    expect(gate.holding()).toBe(false)
    expect(await next).toBe('')
    expect(resets()).toBe(0)
  })

  it('starts no check when the person is back in the form', async () => {
    const { gate, resets } = await refusedOnce(300)

    gate.wake()
    gate.wake()
    expect(resets()).toBe(0)
  })

  it('covers each try the Worker says it does, and the check starts after the last', async () => {
    const { gate, resets, answer } = await refusedOnce(300)
    for (let i = 0; i < 3; i += 1) {
      const sent = await gate.next()
      expect(sent).toBe('')
      gate.explain(answer(401, 250), sent)
    }
    expect(resets()).toBe(0)

    // The Worker covered this one and says nothing about the next.
    const last = await gate.next()
    gate.explain(answer(401), last)
    expect(resets()).toBe(1)
    void outcome(gate.next())
    expect(gate.holding()).toBe(true)
  })

  it('covers no other send: creating an account, a reset link and the confirm link need a check', async () => {
    let signingIn = true
    const { gate, widget, resets } = await refusedOnce(300, () => signingIn)
    signingIn = false

    gate.wake()
    expect(resets()).toBe(1)
    const sent = outcome(gate.next())
    expect(gate.holding()).toBe(true)
    widget.pass('token-2')
    expect((await sent).token).toBe('token-2')
  })

  it("runs out on this browser's clock ten seconds before the Worker's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.parse('2026-10-30T09:00:00Z')
    vi.setSystemTime(start)
    const { gate, resets } = await refusedOnce(300)

    vi.setSystemTime(start + 289_000)
    gate.wake()
    expect(resets()).toBe(0)

    vi.setSystemTime(start + 291_000)
    gate.wake()
    expect(resets()).toBe(1)
  })

  it('is no cover when only a few seconds are left', async () => {
    const { gate, resets } = await refusedOnce(8)

    expect(resets()).toBe(1)
    void outcome(gate.next())
    expect(gate.holding()).toBe(true)
  })

  it('ends when the Worker asks for the check again, and the send goes again with a token', async () => {
    const { gate, widget, resets, answer } = await refusedOnce(300)
    const sent = await gate.next()
    expect(sent).toBe('')

    expect(gate.checkAgain(answer(403), sent)).toBe(true)
    expect(resets()).toBe(1)
    const again = outcome(gate.next())
    expect(gate.holding()).toBe(true)
    widget.pass('token-2')
    expect((await again).token).toBe('token-2')
  })

  it('sends nothing again for a refused send that carried a token', async () => {
    const { gate, widget, answer } = await makeGate({ signingIn: () => true })
    widget.pass('token-1')
    const sent = await gate.next()

    expect(gate.checkAgain(answer(403), sent)).toBe(false)
  })

  it("sends nothing again for an answer that is not the check's", async () => {
    const { gate, resets, answer } = await refusedOnce(300)
    const sent = await gate.next()

    expect(gate.checkAgain(answer(401, 100), sent)).toBe(false)
    expect(gate.checkAgain(answer(429), sent)).toBe(false)
    expect(gate.checkAgain(answer(503), sent)).toBe(false)
    expect(gate.checkAgain(new Error('offline'), sent)).toBe(false)
    expect(resets()).toBe(0)
  })

  it('keeps the cover through an answer that says nothing about it, such as a limit reached', async () => {
    const { gate, resets, answer } = await refusedOnce(300)
    const sent = await gate.next()

    gate.explain(answer(429), sent)
    expect(resets()).toBe(0)
    expect(await gate.next()).toBe('')
  })

  it('sends a token Cloudflare handed over meanwhile along with a covered try', async () => {
    const { gate, widget, resets } = await refusedOnce(300)
    // Cloudflare fetched the next token by itself, as after the old one expired.
    gate.onStatus('expired')
    widget.pass('token-2')

    expect(await gate.next()).toBe('token-2')
    expect(resets()).toBe(0)
  })

  it('ends once the sign-in goes through', async () => {
    const { gate, resets } = await refusedOnce(300)

    gate.signedIn()
    gate.wake()
    expect(resets()).toBe(1)
  })
})
