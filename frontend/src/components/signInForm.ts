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
  window.location.reload()
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
    send: async (values) => {
      const mode = options.mode()
      const email = values.email.trim()
      try {
        if (mode === 'forgot') {
          await api.forgotPassword(email, await options.captcha.next())
          return { kind: 'reset-link-sent' }
        }
        if (mode === 'confirm') {
          await api.resendConfirmLink(email, await options.captcha.next())
          return { kind: 'check-inbox', email }
        }
        if (mode === 'register') {
          await api.register(email, values.password, await options.captcha.next())
          return { kind: 'check-inbox', email }
        }
        const login = await api.loginWithPassword(
          email,
          values.password,
          await options.captcha.next()
        )
        if (login?.emailConfirmed) noteAddressConfirmed()
        // The password was right; the session waits behind the second factor.
        if (login?.twofaRequired) return { kind: 'second-factor' }
        return await reloadIntoTheApp()
      } catch (error) {
        throw forTheWholeForm(options.captcha.explain(error))
      } finally {
        options.captcha.spent()
      }
    },
    saved: options.saved,
    failure: SIGN_IN_FAILED,
  })
}
