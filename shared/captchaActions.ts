/**
 * The form a Cloudflare Turnstile check was solved for, by the name both runtimes use.
 *
 * The frontend draws each widget with its form's name as Turnstile's `action` (Turnstile.tsx), and
 * Cloudflare's siteverify answer repeats it. Each Worker route behind the captcha names the actions
 * it takes, and counts a check only when the answer names one of them or none
 * (worker/src/turnstile.ts).
 *
 * One widget, one action. The sign-in screen and the Sign In window send several routes from one
 * widget, drawn once, so a solved check is not asked for again when the person switches between
 * signing in, creating an account, a reset link and the confirm link.
 *
 * Cloudflare takes up to 32 characters per action: letters, digits, `_` and `-`.
 */
export const CAPTCHA_ACTIONS = {
  /**
   * The sign-in screen and the Sign In window, in every mode: POST /api/auth/login, /register,
   * /forgot-password and /verify-email/resend.
   */
  signIn: 'sign-in',
  /** Check your inbox, sending the confirm link again: POST /api/auth/verify-email/resend. */
  confirmLink: 'confirm-link',
  /** Asking for a sign-in code: POST /api/auth/email-code/request. */
  emailCode: 'email-code',
  /** The support form: POST /api/support/contact. */
  support: 'support',
} as const;

export type CaptchaAction = (typeof CAPTCHA_ACTIONS)[keyof typeof CAPTCHA_ACTIONS];
