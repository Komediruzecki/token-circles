/**
 * What the sign-in, password and support forms check, shared with the Worker routes behind them,
 * so a problem is said in the same words whether a form finds it before it sends or a route finds
 * it in a request that skipped the form.
 *
 * The rules are the ones the routes already had (the address format they test, the 8 characters a
 * new password needs, the length of a message to support) and one they added: an address the app
 * keeps and mails holds no control characters, format characters or angle brackets
 * (STORED_EMAIL_PATTERN). Lookups keep the older format, so no account is shut out by it.
 *
 * Whether an address has an account is never a check here, and never a field's message. A wrong
 * address or password is one answer for the whole form, with the same status and words for an
 * address with an account and one without (worker/src/routes/auth.ts).
 */
import type { FieldErrors } from './refusal';

/**
 * The address format a route that looks an address up tests: something@something.something.
 * Sign-in, a reset link, a confirm link and a sign-in code keep it, so an account created before
 * STORED_EMAIL_PATTERN can still sign in and reset its password.
 */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The format an address the app keeps and mails must have: EMAIL_PATTERN, without control
 * characters (C0, DEL, C1: `\p{Cc}`), format characters (bidi overrides and isolates, zero-width
 * characters, the soft hyphen: `\p{Cf}`) or angle brackets. Plus addressing, dots, hyphens,
 * apostrophes, digits, subdomains and letters in any script still pass. Registration, an email
 * change (worker/src/email-change.ts) and the reply address for support test this one.
 */
export const STORED_EMAIL_PATTERN =
  /^[^@\s<>\p{Cc}\p{Cf}]+@[^@\s<>\p{Cc}\p{Cf}]+\.[^@\s<>\p{Cc}\p{Cf}]+$/u;

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

/** An address's problem against `pattern`: missing, or not in that format. Trimmed first. */
function addressProblem(email: string, pattern: RegExp): string | undefined {
  const value = email.trim();
  if (value === '') return SIGN_IN_MESSAGES.email;
  return pattern.test(value) ? undefined : SIGN_IN_MESSAGES.emailFormat;
}

/** An address to look up: missing, or not in EMAIL_PATTERN. */
export function emailProblem(email: string): string | undefined {
  return addressProblem(email, EMAIL_PATTERN);
}

/**
 * An address to keep and mail: missing, or not in STORED_EMAIL_PATTERN. Said in the same words as
 * any other address that is not one.
 */
export function storedEmailProblem(email: string): string | undefined {
  return addressProblem(email, STORED_EMAIL_PATTERN);
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

/** Creating an account: an address it can keep, and a password of at least 8 characters. */
export function registrationProblems(body: { email: string; password: string }): FieldErrors {
  return problems({
    email: storedEmailProblem(body.email),
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

/**
 * A message to support: the address to reply to, and the message, trimmed. The address goes into
 * the relay's Reply-To and gets the acknowledgement, so it is checked as an address the app keeps.
 */
export function supportProblems(body: { email: string; message: string }): FieldErrors {
  const message = body.message.trim();
  return problems({
    email: storedEmailProblem(body.email),
    message:
      message.length < SUPPORT_MESSAGE_MIN_LENGTH
        ? SIGN_IN_MESSAGES.supportMessage
        : message.length > SUPPORT_MESSAGE_MAX_LENGTH
          ? SIGN_IN_MESSAGES.supportMessageLength
          : undefined,
  });
}
