import { summarizeFields } from '../../shared/refusal';
import type { Checked, FieldErrors } from '../../shared/refusal';

/**
 * Error carrying an HTTP status, mapped to a JSON response by the app.onError handler.
 *
 * A refused body also carries `fields`: per body field, what is wrong and how to fix it. The
 * handler sends them as `{ error, fields }`, the answer shared/refusal.ts describes, so a form can
 * mark the fields themselves. Make one with `refuse()` rather than by hand.
 */
export class HttpError extends Error {
  statusCode: number;
  fields?: FieldErrors;
  constructor(statusCode: number, message: string, fields?: FieldErrors) {
    super(message);
    this.statusCode = statusCode;
    if (fields && Object.keys(fields).length > 0) this.fields = fields;
  }
}

/** The 400 for a body that fails its checks: the field messages, and their summary. */
export function refuse(fields: FieldErrors): HttpError {
  return new HttpError(400, summarizeFields(fields), fields);
}

/** A check's value, or the 400 that names what is wrong with the body. */
export function accept<T>(checked: Checked<T>): T {
  if (!checked.ok) throw refuse(checked.fields);
  return checked.value;
}
