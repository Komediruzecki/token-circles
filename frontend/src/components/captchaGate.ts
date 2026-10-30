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
 *   once when the send that took it fails (`explain`), on a press, or when the person is back in
 *   the form (`wake`). A send that worked starts none: a reset link on its way needs no new check,
 *   and someone Cloudflare asks to click would otherwise get a box for nothing. An older send that
 *   fails late starts none either: the check is a newer send's by then.
 * - A hold with no token after 20 seconds says so and leaves a check that is still running alone,
 *   so the next press gets its token; only a check that has run for a minute is started over.
 * - A token that expires unused is dropped, and Cloudflare fetches the next one (Turnstile.tsx).
 *
 * A solved check covers the password sign-in tries after it for five minutes
 * (worker/src/login-check.ts). A wrong password after a token the Worker took says for how many
 * seconds (`checkValidFor` on its 401), and until ten seconds before then (this browser's clock and
 * the answer's travel time) a sign-in from this form goes at once with no token, no check starts,
 * not even when the person is back in the form, and so no box comes back. The form says which
 * sends are sign-ins (`signingIn`); creating an account, a reset link and the confirm link always
 * need a check. A 401 that says nothing about it ends the cover (the Worker covered its last try),
 * and so does a sign-in that went through (`signedIn`). When the Worker asks for the check again
 * for a try that went out on the cover alone (its 403), the cover ends, the check starts, and the
 * form sends that sign-in again with the next token (`checkAgain`): the box comes back for someone
 * Cloudflare asks to click, and the sign-in goes by itself for everyone else.
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

/** How long before the Worker's end of a solved check this form stops counting on it. */
const COVER_MARGIN_MS = 10000

export interface CaptchaGateOptions {
  /**
   * True while the form's next send is a password sign-in: the one send a check solved for a wrong
   * password covers afterwards. Left out by a form that never signs in.
   */
  signingIn?: () => boolean
}

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
   * The token for the next request: the one held, or the next one. '' for a sign-in a solved check
   * still covers, unless a token is in hand. Throws the refusal to show, or NOT_SENT when the send
   * should end without a word (Cloudflare asks for a tick, a newer send, a cancel, the widget gone).
   */
  next: () => Promise<string>
  /**
   * A send's failure as the form says it: a 403 is the captcha's, in its words. Call it in the
   * send's `catch` with the token that send took from `next()`, or `undefined` if it took none.
   * The send that took the last token starts the next check at once when it fails, unless the
   * Worker says the solved check covers the next sign-in; an older one that fails late leaves the
   * widget to the newer send that used it or holds for it.
   */
  explain: (error: unknown, token: string | undefined) => unknown
  /**
   * For a sign-in that went out on a solved check alone (`next()` gave ''), refused with the
   * Worker's 403: the check covers nothing now. Ends the cover, starts the check, and says true:
   * the form sends the sign-in again with the token `next()` gives it next.
   */
  checkAgain: (error: unknown, token: string | undefined) => boolean
  /** The sign-in went through: the solved check has done its work, here as on the Worker. */
  signedIn: () => void
}

export function createCaptchaGate(options: CaptchaGateOptions = {}): CaptchaGate {
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
  /** The token the latest send took: only that send's failure starts the next check. */
  let lastIssued: string | undefined
  /** Until when (this browser's clock) a solved check covers the next sign-in; 0 when it does not. */
  let coveredUntil = 0
  /** The latest send was a sign-in that went out on the solved check alone, with no token. */
  let lastCovered = false

  const asking = () => status() === 'interactive'

  /** The form's next send is a sign-in that a solved check still covers. */
  const covered = () => (options.signingIn?.() ?? false) && Date.now() < coveredUntil

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
      if (lastTokenSpent() && !covered()) rearm()
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
      // A wrong password a moment ago, and the check solved for it covers this try too: nothing to
      // wait for, and no new check. A token Cloudflare handed over meanwhile goes along.
      if (covered()) {
        const inHand = token()
        setToken('')
        lastIssued = inHand
        lastCovered = inHand === ''
        return inHand
      }
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
      lastIssued = issued
      lastCovered = false
      return issued
    },
    explain: (error, sent) => {
      // A send that stepped back sent nothing, so its token proves nothing. One that sent an older
      // token than the latest is not the widget's news: a newer send has used the check since, or
      // holds for the one it started, and a reset would bring Cloudflare's box up beside it.
      const last = sent !== undefined && sent === lastIssued
      if (error !== NOT_SENT && last) {
        const seconds = error instanceof ApiError ? error.checkValidFor : undefined
        // The Worker says how long the check solved for this sign-in covers the next one. A 401 or
        // 403 that does not say so means nothing covers it; any other failure leaves it as it was.
        if (seconds !== undefined) coveredUntil = Date.now() + seconds * 1000 - COVER_MARGIN_MS
        else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          coveredUntil = 0
        }
        if (lastTokenSpent() && !covered()) rearm()
      }
      return error instanceof ApiError && error.status === 403 ? refusal() : error
    },
    checkAgain: (error, sent) => {
      const onTheCoverAlone = sent === '' && sent === lastIssued && lastCovered
      if (!onTheCoverAlone || !(error instanceof ApiError) || error.status !== 403) return false
      coveredUntil = 0
      lastCovered = false
      if (lastTokenSpent()) rearm()
      return true
    },
    signedIn: () => {
      coveredUntil = 0
      lastCovered = false
    },
  }
}
