/**
 * The one error both client surfaces throw for a request that did not succeed.
 *
 * The typed `api.*` client (`request()` in core/api.ts) and the raw `apiGet/apiPost/apiPut/
 * apiDelete` helpers (`parseJsonResponse()`) both build it with `apiErrorFrom`, and `apiFetch`,
 * which both pass through, makes one of a network failure. So a form gets the same thing whichever
 * surface it uses and whichever storage mode it runs in (docs/plans/2026-10-07-form-errors.md).
 *
 * It extends Error, so code that reads `.message` keeps working, and `.message` is always a
 * sentence a person can act on: the answer's own `error`, or one written here for its status.
 */
import type { FieldErrors } from '../../../shared/refusal'

export class ApiError extends Error {
  /** The HTTP status; 0 when no answer arrived at all. */
  readonly status: number
  /** Per body field, what is wrong with it. `{}` when the answer named none (or is older). */
  readonly fields: Readonly<FieldErrors>
  /** Logged or deliberately not logged already, so `request()` does not log it again. */
  __handled?: boolean

  constructor(status: number, message: string, fields: FieldErrors = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

/** What to say for an answer that brought no words of its own. */
export function statusMessage(status: number): string {
  if (status === 401) return 'Your session has ended. Sign in again to carry on.'
  if (status === 403) return "You don't have access to that."
  if (status === 404) return "That isn't there any more. It may have been deleted."
  if (status === 409)
    return 'That changed somewhere else. Reload to see the latest, then try again.'
  if (status === 413) return "That's too large to send."
  if (status === 429) return "That's a lot of requests in a row. Wait a moment and try again."
  if (status === 502 || status === 503 || status === 504) {
    return "Token Circles isn't answering right now. Try again in a moment."
  }
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.'
  return "That didn't work. Try again."
}

export const OFFLINE = "You're offline. Reconnect and try again."
export const UNREACHABLE = "Couldn't reach Token Circles. Check your connection and try again."

/** Only the entries that are sentences: an answer is data from the network, not a promise. */
function readFields(raw: unknown): FieldErrors {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const fields: FieldErrors = {}
  for (const [key, message] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof message === 'string' && message.trim() !== '') fields[key] = message
  }
  return fields
}

/** The ApiError for an answer that is not a success. Reads the body, so call it once. */
export async function apiErrorFrom(response: Response): Promise<ApiError> {
  let body: unknown = null
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    body = await response.json().catch(() => null)
  }
  const data = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const said = [data.error, data.message].find(
    (value): value is string => typeof value === 'string' && value.trim() !== ''
  )
  return new ApiError(
    response.status,
    said ?? statusMessage(response.status),
    readFields(data.fields)
  )
}

/** The ApiError for a request that got no answer: the network, not the server. */
export function networkError(cause?: unknown): ApiError {
  const offline = typeof window !== 'undefined' && !window.navigator.onLine
  return new ApiError(0, offline ? OFFLINE : UNREACHABLE, {}, cause)
}

/**
 * The words to show for a failure where no form can: an ApiError's own sentence, or `fallback`
 * for anything else. A TypeError from a bug says nothing a person can act on, so it never reaches
 * a toast. Every failure toast goes through here (src/__tests__/toastErrorMessages.test.ts).
 */
export function plainMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}
