/**
 * Onboarding store — the first-run setup wizard's state and trigger logic.
 *
 * The wizard auto-opens exactly once per account, for a pristine profile: no
 * accounts, no transactions, no bills (a fresh email/Google signup in server
 * mode, or a truly empty serverless workspace). Finishing or skipping stamps a
 * localStorage flag kept under the account it belongs to (setOnboardingOwner),
 * so each account signed in on one browser has its own, AND mirrors it into the
 * profile's settings KV, so in server mode, logging in from a new device
 * respects a decision made elsewhere. It can always be relaunched from
 * Settings → About or the tour-selection modal.
 */
import { createRoot, createSignal } from 'solid-js'
import { apiGet, apiPut } from './api'

export type OnboardingStep = 'welcome' | 'space' | 'account' | 'import' | 'subscriptions' | 'done'

export const ONBOARDING_STEPS: OnboardingStep[] = [
  'welcome',
  'space',
  'account',
  'import',
  'subscriptions',
  'done',
]

/**
 * The browser-wide flag, from before the flag was kept per account. setOnboardingOwner moves it to
 * the first account it is given.
 */
const BROWSER_WIDE_KEY = 'finance_onboarding'

export type OnboardingStatus = 'completed' | 'skipped' | null

/** Whose flag is read and written: an account (`account-<id>`), `local`, or nobody yet. */
let owner: string | null = null

const keyOf = (of: string) => `${BROWSER_WIDE_KEY}:${of}`

const isDecision = (raw: string | null): raw is Exclude<OnboardingStatus, null> =>
  raw === 'completed' || raw === 'skipped'

/**
 * The owner of the flag: in local-first, the browser's one local account; signed in to the
 * server, that account by id; otherwise nobody, and nothing is offered.
 */
export function onboardingOwnerFor(
  serverMode: boolean,
  accountId: number | null | undefined
): string | null {
  if (!serverMode) return 'local'
  return typeof accountId === 'number' ? `account-${accountId}` : null
}

/**
 * Read and write the flag of `next` from now on. A browser-wide flag still here goes to the first
 * owner given, unless that owner has a decision of its own, and is then removed.
 */
export function setOnboardingOwner(next: string | null): void {
  owner = next
  if (next === null) return
  try {
    const browserWide = localStorage.getItem(BROWSER_WIDE_KEY)
    if (browserWide === null) return
    if (isDecision(browserWide) && localStorage.getItem(keyOf(next)) === null) {
      localStorage.setItem(keyOf(next), browserWide)
    }
    localStorage.removeItem(BROWSER_WIDE_KEY)
  } catch {
    // Non-fatal: the move is tried again at the next start.
  }
}

/** Remove `of`'s flag, so its next pristine workspace is offered the wizard again. */
export function forgetOnboardingStatus(of: string): void {
  try {
    localStorage.removeItem(keyOf(of))
  } catch {
    // Non-fatal: a pristine workspace may go without the offer.
  }
}

export function getOnboardingStatus(): OnboardingStatus {
  if (owner === null) return null
  try {
    const raw = localStorage.getItem(keyOf(owner))
    return isDecision(raw) ? raw : null
  } catch {
    return null
  }
}

function setOnboardingStatus(status: Exclude<OnboardingStatus, null>) {
  if (owner === null) return
  try {
    localStorage.setItem(keyOf(owner), status)
  } catch {
    // Non-fatal: the wizard may auto-open again next visit.
  }
}

/**
 * Best-effort mirror of the decision into the settings KV (`/api/settings`,
 * per-profile). In server mode this is what makes a fresh device respect a
 * completion/skip made elsewhere; in serverless it lands in IndexedDB, which
 * is device-local anyway. Failures are swallowed — the localStorage flag
 * already protects this device.
 */
let mirrorInFlight: Promise<unknown> = Promise.resolve()

function persistRemoteStatus(status: Exclude<OnboardingStatus, null>) {
  mirrorInFlight = apiPut('/api/settings', { onboarding: status }).catch(() => {})
}

/** Resolves once the most recent KV mirror write has settled (tests await this). */
export function onboardingMirrorSettled(): Promise<unknown> {
  return mirrorInFlight
}

const store = createRoot(() => {
  const [onboardingOpen, setOnboardingOpen] = createSignal(false)
  const [onboardingStep, setOnboardingStep] = createSignal<OnboardingStep>('welcome')
  return { onboardingOpen, setOnboardingOpen, onboardingStep, setOnboardingStep }
})

export const onboardingOpen = store.onboardingOpen
export const onboardingStep = store.onboardingStep

export function startOnboarding(step: OnboardingStep = 'welcome') {
  store.setOnboardingStep(step)
  store.setOnboardingOpen(true)
}

export function goToOnboardingStep(step: OnboardingStep) {
  store.setOnboardingStep(step)
}

export function nextOnboardingStep() {
  const order = ONBOARDING_STEPS
  const idx = order.indexOf(store.onboardingStep())
  if (idx >= 0 && idx < order.length - 1) store.setOnboardingStep(order[idx + 1])
}

export function prevOnboardingStep() {
  const order = ONBOARDING_STEPS
  const idx = order.indexOf(store.onboardingStep())
  if (idx > 0) store.setOnboardingStep(order[idx - 1])
}

/** Finish the wizard: stamp the flag (local + settings KV) and close. */
export function completeOnboarding() {
  setOnboardingStatus('completed')
  persistRemoteStatus('completed')
  store.setOnboardingOpen(false)
}

/** Leave the wizard early: stamp the flag (local + settings KV) and close. */
export function skipOnboarding() {
  setOnboardingStatus('skipped')
  persistRemoteStatus('skipped')
  store.setOnboardingOpen(false)
}

/**
 * True when a list endpoint's response represents zero items, across the
 * shapes the two storage modes return: a bare array (serverless
 * /api/accounts, /api/bills, /api/transactions) OR a paginated envelope
 * (the server's /api/transactions is `{ rows, total, limit, offset }`, NOT a
 * bare array). An unrecognized shape returns false — "can't confirm empty" so
 * we never trap a user with data in the wizard.
 */
export function collectionIsEmpty(res: unknown): boolean {
  if (Array.isArray(res)) return res.length === 0
  if (res && typeof res === 'object') {
    const obj = res as { rows?: unknown; total?: unknown }
    if (Array.isArray(obj.rows)) return obj.rows.length === 0
    if (typeof obj.total === 'number') return obj.total === 0
  }
  return false
}

/**
 * Whether the wizard should auto-open: the account is known, has never seen it
 * before (on this device OR, per the settings KV, anywhere) AND the current
 * profile is pristine — zero accounts, zero transactions, zero bills. Any fetch
 * error counts as "no" — a broken bootstrap must not trap the user in a wizard.
 */
export async function shouldOfferOnboarding(): Promise<boolean> {
  if (owner === null || getOnboardingStatus() !== null) return false
  try {
    const [accounts, transactions, bills, settings] = await Promise.all([
      apiGet('/api/accounts'),
      apiGet('/api/transactions'),
      apiGet('/api/bills'),
      // Settings are decorative here — a failure must not veto the pristine check.
      apiGet<Record<string, unknown>>('/api/settings').catch(() => null),
    ])
    const remote = settings?.onboarding
    if (remote === 'completed' || remote === 'skipped') {
      // Done/skipped on another device: cache locally and stay quiet.
      setOnboardingStatus(remote)
      return false
    }
    return (
      collectionIsEmpty(accounts) && collectionIsEmpty(transactions) && collectionIsEmpty(bills)
    )
  } catch {
    return false
  }
}

/** Check-and-open, used from the app bootstrap and post-login hooks. */
export async function maybeOfferOnboarding(): Promise<void> {
  if (await shouldOfferOnboarding()) startOnboarding()
}
