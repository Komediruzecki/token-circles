/**
 * What the sign-in, password and support forms check, shared with the Worker routes behind them,
 * so a problem is said in the same words whether a form finds it before it sends or a route finds
 * it in a request that skipped the form.
 *
 * Every rule here is one the routes already had: the address format they test, the 8 characters a
 * new password needs, the length of a message to support. They change what a refusal says and the
 * field it names, never what a route accepts.
 *
 * Whether an address has an account is never a check here, and never a field's message. A wrong
 * address or password is one answer for the whole form, with the same status and words for an
 * address with an account and one without (worker/src/routes/auth.ts).
 */
import type { FieldErrors } from './refusal';

/** The address format every route that takes an address tests: something@something.something. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The shortest password registration and a reset link set. */
export const PASSWORD_MIN_LENGTH = 8;

/** A message to support, trimmed, is at least this long and at most the next. */
export const SUPPORT_MESSAGE_MIN_LENGTH = 5;
export const SUPPORT_MESSAGE_MAX_LENGTH = 5000;

/** The words for each problem. A form shows them under the field; a summary joins them. */
export const SIGN_IN_MESSAGES = {
  email: 'Enter your email address.',
  emailFormat: 'Enter an email address like name@example.com.',
  password: 'Enter your password.',
  newPassword: `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`,
  confirmPassword: 'Type the same password in both fields.',
  emailCode: 'Enter the 6-digit code from the email.',
  emailCodeRefused: "That code didn't work. Check the newest email, or send a new code.",
  appCode: 'Enter the 6-digit code from your authenticator app.',
  appCodeRefused: "That code didn't match. Check your authenticator app and try again.",
  recoveryCode: 'Enter one of your recovery codes.',
  secondFactor: 'Enter a code from your authenticator app, or a recovery code.',
  secondFactorRefused: "That code didn't match. Check it and try again.",
  supportMessage: `Tell us what you need, in at least ${SUPPORT_MESSAGE_MIN_LENGTH} characters.`,
  supportMessageLength: 'Keep the message to 5,000 characters or fewer.',
} as const;

/** The entries that name a problem: `{}` when every field passed. */
function problems(found: Record<string, string | undefined>): FieldErrors {
  const fields: FieldErrors = {};
  for (const [name, message] of Object.entries(found)) {
    if (message !== undefined) fields[name] = message;
  }
  return fields;
}

/** True when a check found nothing wrong. */
export function noProblems(fields: FieldErrors): boolean {
  return Object.keys(fields).length === 0;
}

/** An address's problem: missing, or not in the format every route tests. Trimmed first. */
export function emailProblem(email: string): string | undefined {
  const value = email.trim();
  if (value === '') return SIGN_IN_MESSAGES.email;
  return EMAIL_PATTERN.test(value) ? undefined : SIGN_IN_MESSAGES.emailFormat;
}

/** A new password's problem: shorter than 8 characters, spaces included, as the routes count. */
export function newPasswordProblem(password: string): string | undefined {
  return password.length < PASSWORD_MIN_LENGTH ? SIGN_IN_MESSAGES.newPassword : undefined;
}

/**
 * Signing in with a password: an address and a password, both there. The route tests no format
 * and no length here, so an account is never refused at the door for an address or a password
 * that a later rule would not have allowed.
 */
export function signInProblems(body: { email: string; password: string }): FieldErrors {
  return problems({
    email: body.email.trim() === '' ? SIGN_IN_MESSAGES.email : undefined,
    password: body.password === '' ? SIGN_IN_MESSAGES.password : undefined,
  });
}

/** Creating an account: an address in the format, and a password of at least 8 characters. */
export function registrationProblems(body: { email: string; password: string }): FieldErrors {
  return problems({
    email: emailProblem(body.email),
    password: newPasswordProblem(body.password),
  });
}

/** Asking for a reset link or a sign-in code: the address it goes to. */
export function addressProblems(body: { email: string }): FieldErrors {
  return problems({ email: emailProblem(body.email) });
}

/** Trading a sign-in code for a session: the address it went to, and the code. */
export function emailCodeProblems(body: { email: string; code: string }): FieldErrors {
  return problems({
    email: emailProblem(body.email),
    code: body.code.trim() === '' ? SIGN_IN_MESSAGES.emailCode : undefined,
  });
}

/** Setting a password from a reset link. */
export function resetPasswordProblems(body: { password: string }): FieldErrors {
  return problems({ password: newPasswordProblem(body.password) });
}

/** A message to support: the address to reply to, and the message, trimmed. */
export function supportProblems(body: { email: string; message: string }): FieldErrors {
  const message = body.message.trim();
  return problems({
    email: emailProblem(body.email),
    message:
      message.length < SUPPORT_MESSAGE_MIN_LENGTH
        ? SIGN_IN_MESSAGES.supportMessage
        : message.length > SUPPORT_MESSAGE_MAX_LENGTH
          ? SIGN_IN_MESSAGES.supportMessageLength
          : undefined,
  });
}
