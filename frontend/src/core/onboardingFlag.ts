/**
 * Where the setup wizard's completed-or-skipped flag lives in localStorage: one key per owner,
 * `finance_onboarding:account-<id>` for a signed-in account and `finance_onboarding:local` for
 * local-first's one local account (onboardingStore.ts). No imports, so the E2E helpers that mark
 * onboarding as decided (tests/onboarding-decided.ts) build the same keys.
 *
 * The local-only switch's one-shot marker (LOCAL_SETUP_PENDING_KEY) is here too, so the demo's
 * entry points (demoMode.ts, LoginScreen's Continue with no account) can drop it without loading
 * the onboarding store.
 */

/** The browser-wide flag, from before the flag was kept per owner. Only `local` takes it over. */
export const BROWSER_WIDE_ONBOARDING_KEY = 'finance_onboarding'

/** The owner of local-first's flag. */
export const LOCAL_ONBOARDING_OWNER = 'local'

/** The owner of a signed-in account's flag. */
export const accountOnboardingOwner = (accountId: number) => `account-${accountId}`

/** The localStorage key of `owner`'s flag. */
export const onboardingFlagKey = (owner: string) => `${BROWSER_WIDE_ONBOARDING_KEY}:${owner}`

/**
 * Set by the wizard's "Keep my data in this browser only" just before it reloads into the local
 * workspace, so that workspace offers setup for a space of the person's own (whereToOfferOnboarding).
 */
export const LOCAL_SETUP_PENDING_KEY = 'finance_local_setup_pending'

/** Ask the local workspace the next load opens to offer setup (chooseLocalOnly). */
export function markLocalSetupPending(): void {
  try {
    localStorage.setItem(LOCAL_SETUP_PENDING_KEY, '1')
  } catch {
    // Non-fatal: the workspace opens as it would have before.
  }
}

/**
 * The marker has done its job, or no longer applies: the space is saved, setup was left, the demo
 * was asked for, or a signed-in account booted (onboardingStore.ts, whereToOfferOnboarding).
 */
export function clearLocalSetupPending(): void {
  try {
    localStorage.removeItem(LOCAL_SETUP_PENDING_KEY)
  } catch {
    // Non-fatal: the next load finds the space saved, or a decision kept, and asks again at most.
  }
}

/** Whether a switch to local-only is still waiting for its space. */
export function localSetupPending(): boolean {
  try {
    return localStorage.getItem(LOCAL_SETUP_PENDING_KEY) !== null
  } catch {
    return false
  }
}
