/**
 * What to say when some subscriptions of a batch were not added: which ones, and the reason each
 * was refused for, in the words of the refusal (shared/billSchema.ts for a 400). The Subscriptions
 * scan and catalog both said "Some subscriptions could not be added", whatever the reason, and
 * named none.
 *
 * Entries refused for the same reason share one message, so being offline is said once.
 */
import { ApiError, statusMessage } from '../core/apiError'

/** A subscription that was not added, and what its request threw. */
export interface RefusedSubscription {
  name: string
  error: unknown
}

/** `"A"`, `"A" or "B"`, `"A", "B" or "C"`. */
function namesOf(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`)
  return quoted.length < 2
    ? (quoted[0] ?? '')
    : `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

/** One message for each reason: `Couldn't add "Netflix". Enter an amount more than zero.` */
export function refusedMessages(refused: readonly RefusedSubscription[]): string[] {
  const byReason = new Map<string, string[]>()
  for (const { name, error } of refused) {
    const reason = error instanceof ApiError ? error.message : statusMessage(0)
    byReason.set(reason, [...(byReason.get(reason) ?? []), name])
  }
  return [...byReason].map(([reason, names]) => `Couldn't add ${namesOf(names)}. ${reason}`)
}
