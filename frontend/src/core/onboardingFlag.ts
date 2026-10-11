/**
 * Where the setup wizard's completed-or-skipped flag lives in localStorage: one key per owner,
 * `finance_onboarding:account-<id>` for a signed-in account and `finance_onboarding:local` for
 * local-first's one local account (onboardingStore.ts). No imports, so the E2E helpers that mark
 * onboarding as decided (tests/onboarding-decided.ts) build the same keys.
 */

/** The browser-wide flag, from before the flag was kept per owner. Only `local` takes it over. */
export const BROWSER_WIDE_ONBOARDING_KEY = 'finance_onboarding'

/** The owner of local-first's flag. */
export const LOCAL_ONBOARDING_OWNER = 'local'

/** The owner of a signed-in account's flag. */
export const accountOnboardingOwner = (accountId: number) => `account-${accountId}`

/** The localStorage key of `owner`'s flag. */
export const onboardingFlagKey = (owner: string) => `${BROWSER_WIDE_ONBOARDING_KEY}:${owner}`
