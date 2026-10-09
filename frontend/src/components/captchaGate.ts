/**
 * The captcha as a kit form uses it: the token a request carries, waited for on submit, and what
 * the form says when the captcha stops a request. One per form, since each form renders its own
 * widget (`<Turnstile onToken={gate.onToken} onStatus={gate.onStatus} />`).
 *
 * The submit button is never disabled while there is no token. A kit button cannot be (it keeps
 * focus while it is busy), and an invisible widget would leave nothing on screen to say why. The
 * send waits for the token instead: normally it is there long before anyone has finished typing.
 *
 * The captcha's refusals mark no field. They are said in the form's notice:
 * - a widget that cannot run (blocked, failed) says what to fix, before anything is sent;
 * - no token within 20 seconds, or a token the Worker refused (its 403), says to try again and to
 *   complete the check if one appears.
 */
import { createSignal } from 'solid-js'
import { ApiError } from '../core/apiError'
import {
  captchaIsStuck,
  captchaStatusMessage,
  resetTurnstile,
  turnstileEnabled,
  waitForTurnstileToken,
} from './Turnstile'
import type { TurnstileStatus } from './Turnstile'

/** A request the captcha stopped, while the widget itself can run. */
export const CAPTCHA_REFUSED =
  "Verification didn't go through. Try again, and complete the check if one appears."

/** How long a send waits for a token before it says so. */
const TOKEN_WAIT_MS = 20000

export interface CaptchaGate {
  /** The token held now, '' when there is none. */
  token: () => string
  status: () => TurnstileStatus
  /** For the widget's `onToken`. */
  onToken: (token: string) => void
  /** For the widget's `onStatus`. */
  onStatus: (status: TurnstileStatus) => void
  /** The token for the next request: the one held, or the next one. Throws the refusal to show. */
  next: () => Promise<string>
  /** A token is good for one request: after each, get the widget ready for the next. */
  spent: () => void
  /** A send's failure as the form says it: a 403 is the captcha's, in its words. */
  explain: (error: unknown) => unknown
}

export function createCaptchaGate(): CaptchaGate {
  const [token, setToken] = createSignal('')
  const [status, setStatus] = createSignal<TurnstileStatus>(
    turnstileEnabled ? 'loading' : 'disabled'
  )

  const refusal = () =>
    new ApiError(403, captchaIsStuck(status()) ? captchaStatusMessage(status()) : CAPTCHA_REFUSED)

  return {
    token,
    status,
    onToken: setToken,
    onStatus: setStatus,
    next: async () => {
      if (!turnstileEnabled) return ''
      if (token()) return token()
      if (captchaIsStuck(status())) throw refusal()
      try {
        return await waitForTurnstileToken(token, TOKEN_WAIT_MS)
      } catch {
        throw refusal()
      }
    },
    spent: () => {
      resetTurnstile()
      setToken('')
      // Left at 'solved' with no token, the form would explain nothing while it waits for the
      // next one. A widget that is stuck stays stuck: a reset does not load a blocked script.
      setStatus((s) => (captchaIsStuck(s) ? s : 'ready'))
    },
    explain: (error) => (error instanceof ApiError && error.status === 403 ? refusal() : error),
  }
}
