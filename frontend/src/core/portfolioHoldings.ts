/**
 * The holdings of the profiles a household read covers, `GET /api/portfolio/holdings`, read once
 * per portfolio write for everyone on the page who needs them: the Dashboard's portfolio list
 * (components/Dashboard/OverviewDeck.tsx) and the circles (core/guidance.ts) both do, and each
 * asking for itself sent the request twice (`sharedRead` in core/dataVersions.ts).
 *
 * Household scope, so the list covers every selected profile; a reader that wants one profile's
 * rows picks them by `profile_id`.
 */
import { untrack } from 'solid-js'
import { apiHouseholdGet } from './api'
import { profileReadScope } from './apiProfileScope'
import { getProfileVersion } from './appStore'
import { sharedRead } from './dataVersions'
import { getStorageMode } from './storage/storageFactory'

export const HOLDINGS_PATH = '/api/portfolio/holdings'

export function householdHoldings<T = unknown>(): Promise<T> {
  // A profile switch asks again even when it asks for the same profiles: the switch is the
  // moment a person expects to see that profile's data as it is now.
  const scope = untrack(() =>
    JSON.stringify([getStorageMode(), profileReadScope(), getProfileVersion()])
  )
  return sharedRead(HOLDINGS_PATH, scope, ['portfolio'], () => apiHouseholdGet<T>(HOLDINGS_PATH))
}
