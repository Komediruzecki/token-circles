/**
 * `#forgot-password`: the Reset password button of the "already has an account" mail links here,
 * and the sign-in screen opens on the form that sends a reset link (LoginScreen).
 *
 * Only account mode has a sign-in screen, and a browser that never chose a mode starts
 * local-first in production (VITE_DEFAULT_STORAGE=dexie). So, read before render (index.tsx), the
 * fragment moves the device to account mode, always, as a confirm link that needs a sign-in does
 * (consumeEmailVerifyRedirect). The switch is the one Sign In makes from local-first mode: data
 * kept on the device is not touched, and choosing local-first again brings it back.
 *
 * The fragment stays in the address bar: the sign-in screen reads it, and Back to sign in clears
 * it. The hash router leaves it alone (hashRoute's non-page routes), and a signed-in app stays
 * on its page.
 */
import { toAccountMode } from './emailVerification'
import { FORGOT_PASSWORD, hashRouteName } from './hashRoute'

export function consumeForgotPasswordLink(): void {
  if (hashRouteName(window.location.hash) !== FORGOT_PASSWORD) return
  toAccountMode()
}
