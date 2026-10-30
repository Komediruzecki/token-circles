/**
 * The password form of the sign-in screen (LoginScreen) and the sign-in dialog (LoginModal), on
 * the form kit: signing in, creating an account, asking for a reset link, and sending the confirm
 * link again.
 *
 * - Each mode checks what the route behind it checks (shared/signInSchema.ts), so a field is
 *   marked before anything is sent, and a refusal the route sends anyway marks the same field in
 *   the same words. Signing in also asks for an address in the format, which the route does
 *   not: registration and a change of address test the same format, and a Google sign-in brings
 *   the address Google holds, so no account's address fails it.
 * - A wrong address or password is one message for the whole form, never a mark on either field,
 *   whatever the answer carries. The Worker's status and words are the same for an address with
 *   an account and one without, and a mark on one field would say which of the two was wrong.
 *   They are the same for an account whose address is not confirmed yet, so the message
 *   (SIGN_IN_REFUSED) says that too, and the screen offers to send the confirm link again.
 * - Creating an account never signs in: the screen says to check the inbox (CheckInbox), the same
 *   for an address that had an account already.
 * - A limit reached (429) is said in the route's words, which say when to try again. A request
 *   the captcha stopped is said in the captcha's (captchaGate.ts). Neither marks a field.
 * - After a wrong password, the check solved for it covers the next sign-in tries for a while
 *   (captchaGate.ts): they go with no token. One the Worker then asks a check for goes again by
 *   itself once Cloudflare's check has a token, so the cover never costs a right password its try.
 * - Signing in reloads into the app, and the button stays busy until the page goes.
 */
import {
  addressProblems,
  emailProblem,
  registrationProblems,
  SIGN_IN_MESSAGES,
} from '../../../shared/signInSchema'
import { api } from '../core/api'
import { ApiError } from '../core/apiError'
import { noteAddressConfirmed } from '../core/emailVerification'
import { afterHistoryStep } from '../core/historyStep'
import { markPasskeyNudgeAfterLogin } from '../core/webauthn'
import { createForm } from './form'
import type { FieldErrors } from '../../../shared/refusal'
import type { CaptchaGate } from './captchaGate'
import type { Form } from './form'

/** `confirm` sends the confirm link again, for someone signed out. */
export type SignInMode = 'login' | 'register' | 'forgot' | 'confirm'

export interface SignInValues {
  email: string
  password: string
}

/** What a send led to, for the screen to act on while the form is still the one that sent. */
export type SignInOutcome =
  { kind: 'second-factor' } | { kind: 'check-inbox'; email: string } | { kind: 'reset-link-sent' }

/** Said for every reset request the route takes, whether or not the address has an account. */
export const RESET_LINK_SENT =
  'If an account exists for that email, a reset link is on its way. Check your inbox.'

/** The notice for a send that failed with no words for a person (a bug, not an answer). */
export const SIGN_IN_FAILED = "That didn't work. Try again."

/**
 * A password sign-in the Worker refused (401): a wrong address or password, or an account whose
 * address is not confirmed yet. The Worker answers both the same, so this says both. A sign-in
 * confirms the address only in the browser that opened the link, so it says where.
 */
export const SIGN_IN_REFUSED =
  "That email and password don't match, or the email isn't confirmed yet. Just signed up? Open the link we emailed you in this browser, then sign in. Opened it in another browser or on another device? Sign in there first."

/** What each mode asks of the fields before it sends. */
export function signInChecks(mode: SignInMode, values: SignInValues): FieldErrors {
  if (mode === 'forgot' || mode === 'confirm') return addressProblems(values)
  if (mode === 'register') return registrationProblems(values)
  const fields: FieldErrors = {}
  const email = emailProblem(values.email)
  if (email) fields.email = email
  if (values.password === '') fields.password = SIGN_IN_MESSAGES.password
  return fields
}

/** The page reloads into the signed-in app. The form waits on it, so its button stays busy. */
export function reloadIntoTheApp(): Promise<never> {
  markPasskeyNudgeAfterLogin()
  // From a step after the form, its history entry goes first: a reload keeps the current entry.
  afterHistoryStep(() => {
    window.location.reload()
  })
  return new Promise<never>(() => {})
}

/** A refused sign-in names neither field: one message for the whole form, SIGN_IN_REFUSED. */
export function forTheWholeForm(error: unknown): unknown {
  return error instanceof ApiError && error.status === 401
    ? new ApiError(401, SIGN_IN_REFUSED)
    : error
}

export function createSignInForm(options: {
  mode: () => SignInMode
  captcha: CaptchaGate
  saved: (outcome: SignInOutcome) => void
}): Form<SignInValues> {
  return createForm<SignInValues, SignInOutcome>({
    initial: { email: '', password: '' },
    check: (values) => signInChecks(options.mode(), values),
    // Cloudflare's box waits for a tick: a submit changes nothing until it is ticked.
    blocked: options.captcha.asking,
    send: async (values) => {
      const mode = options.mode()
      const email = values.email.trim()
      // The token this send takes: the captcha tells its failure from an older send's by it.
      let token: string | undefined
      try {
        token = await options.captcha.next()
        if (mode === 'forgot') {
          await api.forgotPassword(email, token)
          return { kind: 'reset-link-sent' }
        }
        if (mode === 'confirm') {
          await api.resendConfirmLink(email, token)
          return { kind: 'check-inbox', email }
        }
        if (mode === 'register') {
          await api.register(email, values.password, token)
          return { kind: 'check-inbox', email }
        }
        let login: Awaited<ReturnType<typeof api.loginWithPassword>>
        try {
          login = await api.loginWithPassword(email, values.password, token)
        } catch (error) {
          // It went out on the check solved for a wrong password, and that covers nothing now (it
          // ran out, another tab used it up, the network address changed): Cloudflare's check runs
          // again, and this sign-in goes with its token, or steps back while the box waits.
          if (!options.captcha.checkAgain(error, token)) throw error
          token = await options.captcha.next()
          login = await api.loginWithPassword(email, values.password, token)
        }
        options.captcha.signedIn()
        if (login?.emailConfirmed) noteAddressConfirmed()
        // The password was right; the session waits behind the second factor.
        if (login?.twofaRequired) return { kind: 'second-factor' }
        return await reloadIntoTheApp()
      } catch (error) {
        throw forTheWholeForm(options.captcha.explain(error, token))
      }
    },
    saved: options.saved,
    failure: SIGN_IN_FAILED,
  })
}
