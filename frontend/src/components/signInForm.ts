/**
 * The password form of the sign-in screen (LoginScreen) and the sign-in dialog (LoginModal), on
 * the form kit: signing in, creating an account, and asking for a reset link.
 *
 * - Each mode checks what the route behind it checks (shared/signInSchema.ts), so a field is
 *   marked before anything is sent, and a refusal the route sends anyway marks the same field in
 *   the same words. Signing in also asks for an address in the format, as the form always has:
 *   every way an address reaches an account (registration, a change of address, Google) uses the
 *   same format.
 * - A wrong address or password is one message for the whole form, never a mark on either field,
 *   whatever the answer carries. The answer is the same for an address with an account and one
 *   without, and a mark on one field would say which of the two was wrong.
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
import { markPasskeyNudgeAfterLogin } from '../core/webauthn'
import { createForm } from './form'
import type { FieldErrors } from '../../../shared/refusal'
import type { CaptchaGate } from './captchaGate'
import type { Form } from './form'

export type SignInMode = 'login' | 'register' | 'forgot'

export interface SignInValues {
  email: string
  password: string
}

/** What a send led to, for the screen to act on while the form is still the one that sent. */
export type SignInOutcome =
  | { kind: 'second-factor' }
  | { kind: 'registered'; email: string; password: string }
  | { kind: 'reset-link-sent' }

/** Said for every reset request the route takes, whether or not the address has an account. */
export const RESET_LINK_SENT =
  'If an account exists for that email, a reset link is on its way. Check your inbox.'

/** The notice for a send that failed with no words for a person (a bug, not an answer). */
export const SIGN_IN_FAILED = "That didn't work. Try again."

/** What each mode asks of the fields before it sends. */
export function signInChecks(mode: SignInMode, values: SignInValues): FieldErrors {
  if (mode === 'forgot') return addressProblems(values)
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

/** A wrong address or password names neither field: one message for the whole form. */
export function forTheWholeForm(error: unknown): unknown {
  return error instanceof ApiError && error.status === 401
    ? new ApiError(401, error.message)
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
        if (mode === 'register') {
          await api.register(email, values.password, await options.captcha.next())
          return { kind: 'registered', email, password: values.password }
        }
        const login = await api.loginWithPassword(
          email,
          values.password,
          await options.captcha.next()
        )
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
