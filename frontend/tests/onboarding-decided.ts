/**
 * Mark the setup wizard as decided, so it does not open over the page under test.
 *
 * The decision is kept per owner (src/core/onboardingFlag.ts): `local` for local-first, and each
 * signed-in account by its id. A spec names every owner it boots as. The entries are plain data, so
 * an init script can take them as its argument; unit tests write them straight to localStorage.
 *
 * Imports by explicit `.ts` path, with no dependencies, so scripts/gen-marketing-shots.mjs can run
 * it under plain Node too.
 */
import {
  accountOnboardingOwner,
  LOCAL_ONBOARDING_OWNER,
  onboardingFlagKey,
} from '../src/core/onboardingFlag.ts'

/** The local account, or a signed-in account by its id. */
export type OnboardingOwner = 'local' | number

/** The localStorage entries, `[key, value]`, that record `status` for each of `owners`. */
export function onboardingDecided(
  owners: readonly OnboardingOwner[],
  status: 'completed' | 'skipped' = 'skipped'
): Array<[string, string]> {
  return owners.map((owner) => [
    onboardingFlagKey(owner === 'local' ? LOCAL_ONBOARDING_OWNER : accountOnboardingOwner(owner)),
    status,
  ])
}
