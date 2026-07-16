/**
 * Onboarding store — the first-run setup wizard's state and trigger logic.
 *
 * The wizard auto-opens exactly once, for a pristine profile: no accounts, no
 * transactions, no bills (a fresh email/Google signup in server mode, or a
 * truly empty serverless workspace). Finishing or skipping stamps a
 * localStorage flag (mirroring the spotlight-tour completion pattern) AND
 * mirrors it into the profile's settings KV — so in server mode, logging in
 * from a new device respects a decision made elsewhere. It can always be
 * relaunched from Settings → About or the tour-selection modal.
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

const STORAGE_KEY = 'finance_onboarding'

export type OnboardingStatus = 'completed' | 'skipped' | null

export function getOnboardingStatus(): OnboardingStatus {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'completed' || raw === 'skipped' ? raw : null
  } catch {
    return null
  }
}

function setOnboardingStatus(status: Exclude<OnboardingStatus, null>) {
  try {
    localStorage.setItem(STORAGE_KEY, status)
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
 * Whether the wizard should auto-open: never seen it before (on this device
 * OR, per the settings KV, anywhere) AND the current profile is pristine —
 * zero accounts, zero transactions, zero bills. Any fetch error counts as
 * "no" — a broken bootstrap must not trap the user in a wizard.
 */
export async function shouldOfferOnboarding(): Promise<boolean> {
  if (getOnboardingStatus() !== null) return false
  try {
    const [accounts, transactions, bills, settings] = await Promise.all([
      apiGet<unknown[]>('/api/accounts'),
      apiGet<unknown[]>('/api/transactions'),
      apiGet<unknown[]>('/api/bills'),
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
      Array.isArray(accounts) &&
      accounts.length === 0 &&
      Array.isArray(transactions) &&
      transactions.length === 0 &&
      Array.isArray(bills) &&
      bills.length === 0
    )
  } catch {
    return false
  }
}

/** Check-and-open, used from the app bootstrap and post-login hooks. */
export async function maybeOfferOnboarding(): Promise<void> {
  if (await shouldOfferOnboarding()) startOnboarding()
}
