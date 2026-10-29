/**
 * The captcha as a kit form uses it: the token a request carries, held for on submit, and what the
 * form says while the captcha has the next move. One per form, since each form draws its own
 * widget (`<CaptchaCheck gate={captcha} />`).
 *
 * Cloudflare's siteverify takes each token once, so every request needs a fresh one:
 * - A send takes the token in hand, or holds until the widget hands one over. While it holds, the
 *   button says CHECKING_YOU_ARE_HUMAN, never "Signing in…": nothing has gone out yet.
 * - While Cloudflare shows its box and waits for a tick, the form waits for the person too. The
 *   button keeps its words and is inactive (`blocked`), and the line under the box says to tick
 *   it. A send that was holding steps back without a word (NOT_SENT), so the button is never busy
 *   while the box waits, and the next press sends what the fields say then.
 * - After a send that failed, the widget starts the next check at once: the token is usually back
 *   before the password is retyped, and a box Cloudflare wants ticked is there before the press.
 *   After one that worked, it waits until the person is back in the form (`wake`, or a press). A
 *   reset link on its way needs no new check, and someone Cloudflare asks to click would
 *   otherwise get a box for nothing.
 * - A token that expires unused is dropped, and Cloudflare fetches the next one (Turnstile.tsx).
 *
 * The captcha's refusals mark no field. They are said in the form's notice:
 * - a widget that cannot run (blocked, failed) says what to fix, before anything is sent;
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
  /** For the widget's `onWidget`: how to start this form's check over. */
  onWidget: (reset: (() => void) | undefined) => void
  /** The person is back in the form: a check put off after a send that worked starts now. */
  wake: () => void
  /**
   * The token for the next request: the one held, or the next one. Throws the refusal to show, or
   * NOT_SENT when Cloudflare asks for a tick first.
   */
  next: () => Promise<string>
  /** After each send, in `finally`: a token went out, so get the widget ready for the next one. */
  spent: () => void
  /**
   * A send's failure as the form says it: a 403 is the captcha's, in its words. Call it in the
   * send's `catch`: it is also how the gate knows the send failed and the next check starts now.
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
  /** Ends a send's hold before its token comes: Cloudflare wants a tick, or cannot run. */
  let interrupt: ((reason: unknown) => void) | undefined
  /** A token went out with the send in progress. */
  let sent = false
  /** That send failed. */
  let failed = false
  /** The last token went out with a send that worked, and the next check waits for the person. */
  let putOff = false

  const asking = () => status() === 'interactive'

  const refusal = () =>
    new ApiError(403, captchaIsStuck(status()) ? captchaStatusMessage(status()) : CAPTCHA_REFUSED)

  /** Starts the widget's check over, for the next request's token. */
  const rearm = () => {
    putOff = false
    setToken('')
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
      if (next === 'interactive') interrupt?.(NOT_SENT)
      else if (captchaIsStuck(next)) interrupt?.(refusal())
    },
    onWidget: (reset) => {
      resetWidget = reset
      // A widget drawn anew runs its own check: nothing is put off any more.
      putOff = false
    },
    wake: () => {
      if (putOff) rearm()
    },
    next: async () => {
      if (!turnstileEnabled) return ''
      // The button is inactive while the box waits; this covers a send started some other way.
      if (asking()) throw NOT_SENT
      if (captchaIsStuck(status())) throw refusal()
      if (putOff) rearm()
      let issued = token()
      if (!issued) {
        const stop = new AbortController()
        setHolding(true)
        try {
          issued = await Promise.race([
            waitForTurnstileToken(token, TOKEN_WAIT_MS, stop.signal),
            new Promise<never>((_, reject) => {
              interrupt = reject
            }),
          ])
        } catch (error) {
          if (error === NOT_SENT || error instanceof ApiError) throw error
          // No token, and no word from Cloudflare why: start the check over for the next press.
          rearm()
          throw refusal()
        } finally {
          interrupt = undefined
          stop.abort()
          setHolding(false)
        }
      }
      // A token is good for one request: this one is going, so the form holds none until the next.
      setToken('')
      sent = true
      failed = false
      return issued
    },
    spent: () => {
      if (!sent) return
      sent = false
      if (failed) rearm()
      else putOff = true
    },
    explain: (error) => {
      failed = true
      return error instanceof ApiError && error.status === 403 ? refusal() : error
    },
  }
}
