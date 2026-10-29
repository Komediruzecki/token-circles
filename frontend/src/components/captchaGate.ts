/**
 * The captcha as a kit form uses it: the token a request carries, held for on submit, and what the
 * form says while the captcha has the next move. One per form, since each form draws its own
 * widget (`<CaptchaCheck gate={captcha} />`).
 *
 * Cloudflare's siteverify takes each token once, so every request needs a fresh one:
 * - A send takes the token in hand, or holds until the widget hands one over. While it holds, the
 *   button says CHECKING_YOU_ARE_HUMAN, never "Signing in…": nothing has gone out yet.
 * - One send holds at a time. A newer one ends the older one without a word (NOT_SENT), and so do
 *   `cancel()` (the form switched to another mode, its widget still up) and the widget going away
 *   (a step or a dialog left behind): a hold that outlived its form would send what the person
 *   left behind, with the next form's token.
 * - While Cloudflare shows its box and waits for a tick, the form waits for the person too. The
 *   button keeps its words and the form takes no submit (`blocked`), and the line under the box
 *   says to tick it. A send that was holding steps back without a word, so the button is never
 *   busy while the box waits, and the next press sends what the fields say then.
 * - The next check starts when the last token has gone out and something needs the next one: at
 *   once when a send fails (`explain`), on a press, or when the person is back in the form
 *   (`wake`). A send that worked starts none: a reset link on its way needs no new check, and
 *   someone Cloudflare asks to click would otherwise get a box for nothing.
 * - A hold with no token after 20 seconds says so and leaves a check that is still running alone,
 *   so the next press gets its token; only a check that has run for a minute is started over.
 * - A token that expires unused is dropped, and Cloudflare fetches the next one (Turnstile.tsx).
 *
 * The captcha's refusals mark no field. They are said in the form's notice:
 * - a widget that cannot run (blocked, failed, an unsupported browser) says what to fix, before
 *   anything is sent;
 * - no token within 20 seconds, or a token the Worker refused (its 403), says to try again and to
 *   complete the check if one appears.
 */
import { createSignal, createUniqueId } from 'solid-js'
import { ApiError } from '../core/apiError'
import { NOT_SENT } from './form'
import {
  captchaIsStuck,
  captchaStatusMessage,
  turnstileEnabled,
  waitForTurnstileToken,
} from './Turnstile'
import type { TurnstileStatus } from './Turnstile'

/** A request the captcha stopped, while the widget itself can run. */
export const CAPTCHA_REFUSED =
  "Verification didn't go through. Try again, and complete the check if one appears."

/** What the submit button says while a send holds for its token. */
export const CHECKING_YOU_ARE_HUMAN = "Checking you're human…"

/** How long a send waits for a token before it says so. */
const TOKEN_WAIT_MS = 20000

/** How long a check may run without an answer before a hold that times out starts it over. */
const STALE_CHECK_MS = 60000

export interface CaptchaGate {
  /** The token held now, '' when there is none. */
  token: () => string
  status: () => TurnstileStatus
  /** True while Cloudflare shows its box and waits for a tick. */
  asking: () => boolean
  /** True while a send holds for a token that is on its way. */
  holding: () => boolean
  /** The id of the line that says to tick the box: the submit button's `aria-describedby`. */
  hintId: string
  /** The submit button's busy words: the captcha's while a send holds, `sending` after. */
  busyLabel: (sending: string) => string
  /** For the widget's `onToken`. */
  onToken: (token: string) => void
  /** For the widget's `onStatus`. */
  onStatus: (status: TurnstileStatus) => void
  /** For the widget's `onWidget`: how to start this form's check over, `undefined` once it is gone. */
  onWidget: (reset: (() => void) | undefined) => void
  /** The person is back in the form: if the last token has gone out, the next check starts now. */
  wake: () => void
  /** Ends a send that holds for its token without a word: the form switched to another mode. */
  cancel: () => void
  /**
   * The token for the next request: the one held, or the next one. Throws the refusal to show, or
   * NOT_SENT when the send should end without a word (Cloudflare asks for a tick, a newer send, a
   * cancel, the widget gone).
   */
  next: () => Promise<string>
  /**
   * A send's failure as the form says it: a 403 is the captcha's, in its words. Call it in the
   * send's `catch`: a send that failed after its token went out starts the next check at once.
   */
  explain: (error: unknown) => unknown
}

export function createCaptchaGate(): CaptchaGate {
  const [token, setToken] = createSignal('')
  const [status, setStatus] = createSignal<TurnstileStatus>(
    turnstileEnabled ? 'loading' : 'disabled'
  )
  const [holding, setHolding] = createSignal(false)
  let resetWidget: (() => void) | undefined
  /** The send holding for its token now, and how to end it before the token comes. */
  let hold: { end: (reason: unknown) => void } | undefined
  /** When the widget's current check started: drawn, reset, ticked, or fetching after expiry. */
  let checkStartedAt = Date.now()

  const asking = () => status() === 'interactive'

  /** The widget handed over a token and it went out with a send: a new check is due. */
  const lastTokenSpent = () => token() === '' && status() === 'solved'

  const refusal = () =>
    new ApiError(403, captchaIsStuck(status()) ? captchaStatusMessage(status()) : CAPTCHA_REFUSED)

  /** Starts the widget's check over, for the next request's token. */
  const rearm = () => {
    setToken('')
    checkStartedAt = Date.now()
    if (resetWidget) resetWidget()
    // No widget to reset (it is not drawn yet, or gone): the next one brings its own token.
    else setStatus((s) => (captchaIsStuck(s) ? s : 'ready'))
  }

  return {
    token,
    status,
    asking,
    holding,
    hintId: createUniqueId(),
    busyLabel: (sending) => (holding() ? CHECKING_YOU_ARE_HUMAN : sending),
    onToken: setToken,
    onStatus: (next) => {
      setStatus(next)
      if (next === 'loading' || next === 'ready' || next === 'expired') checkStartedAt = Date.now()
      if (next === 'interactive') hold?.end(NOT_SENT)
      else if (captchaIsStuck(next)) hold?.end(refusal())
    },
    onWidget: (reset) => {
      resetWidget = reset
      if (reset) checkStartedAt = Date.now()
      // The widget is gone, and with it the form the hold was for: the next widget's token must
      // not send what was left behind.
      else hold?.end(NOT_SENT)
    },
    wake: () => {
      if (lastTokenSpent()) rearm()
    },
    cancel: () => {
      hold?.end(NOT_SENT)
    },
    next: async () => {
      if (!turnstileEnabled) return ''
      // One hold at a time: the person pressed again, so the earlier press is over.
      hold?.end(NOT_SENT)
      // The form takes no submit while the box waits; this covers a send started some other way.
      if (asking()) throw NOT_SENT
      if (captchaIsStuck(status())) throw refusal()
      if (lastTokenSpent()) rearm()
      let issued = token()
      if (!issued) {
        const stop = new AbortController()
        let end: (reason: unknown) => void = () => undefined
        const ended = new Promise<never>((_, reject) => {
          end = reject
        })
        const mine = { end }
        hold = mine
        setHolding(true)
        try {
          issued = await Promise.race([
            waitForTurnstileToken(token, TOKEN_WAIT_MS, stop.signal),
            ended,
          ])
        } catch (error) {
          if (error === NOT_SENT || error instanceof ApiError) throw error
          // No token, and no word from Cloudflare why. A check that is only slow is left to
          // finish, so the next press gets its token; one that has run for a minute is stuck.
          if (Date.now() - checkStartedAt > STALE_CHECK_MS) rearm()
          throw refusal()
        } finally {
          stop.abort()
          // A newer send may hold by now: what is left to clear is its, not this one's.
          if (hold === mine) {
            hold = undefined
            setHolding(false)
          }
        }
      }
      // A token is good for one request: this one is going, so the form holds none until the next.
      setToken('')
      return issued
    },
    explain: (error) => {
      if (error !== NOT_SENT && lastTokenSpent()) rearm()
      return error instanceof ApiError && error.status === 403 ? refusal() : error
    },
  }
}
