/**
 * The answer to a refused request, the same from the Worker and from the local-first router.
 *
 * A body that fails its checks answers 400 with `{ error, fields }`. `fields` maps a body field to
 * one sentence that says what is wrong with it and how to fix it, so a form can put each message
 * under the field it belongs to. `error` is for a client that cannot place them: an older
 * frontend, an API client, a form without that field. It is every message in order, so even that
 * client shows "Give the category a name." rather than "Validation failed".
 *
 * Plain TypeScript, like the other shared checks, because both runtimes import it and neither can
 * resolve the other's zod from here (docs/plans/2026-10-07-form-errors.md).
 */

/** Per body field: what is wrong with it and how to fix it, in words for people. */
export type FieldErrors = Record<string, string>;

/** The JSON body of a refusal. */
export interface Refusal {
  error: string;
  fields?: FieldErrors;
}

/** What a check returns: the value to store, or a message for each field that is wrong. */
export type Checked<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

/** The summary when a refusal names no field at all. */
export const CHECK_THE_DETAILS = 'Some details need another look. Check them and try again.';

/** One line for a client that cannot show the messages field by field: all of them, in order. */
export function summarizeFields(fields: FieldErrors): string {
  const messages = Object.values(fields).filter((message) => message.trim() !== '');
  return messages.length > 0 ? messages.join(' ') : CHECK_THE_DETAILS;
}

/** The body to answer for these field messages. `fields` is left out when there are none. */
export function refusalOf(fields: FieldErrors): Refusal {
  const error = summarizeFields(fields);
  return Object.keys(fields).length > 0 ? { error, fields } : { error };
}

/** A check's field messages, `{}` when it passed: what a form shows before it sends anything. */
export function fieldErrorsOf(checked: Checked<unknown>): FieldErrors {
  return checked.ok ? {} : checked.fields;
}
