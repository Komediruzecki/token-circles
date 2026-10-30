/**
 * Onboarding store — the first-run setup wizard's state and trigger logic.
 *
 * Signed in, the wizard belongs to the account. Its record is on the Worker (accountState.ts,
 * `onboarding` in user_state): the furthest step reached, and how and when it finished. The wizard
 * opens for an account whose record is not finished, at the step it reached, on whichever device
 * signs in. Every account in use before the record existed was marked finished by migration 0035.
 * A decision kept from before, in this browser's flag or the profile's settings, goes to the
 * account once and the wizard stays closed. When the record cannot be read (the request failed, or
 * another build wrote it in a shape this one cannot read), nothing opens and nothing is sent.
 *
 * The wizard opens on its space step. Its first screen used to be a welcome that asked nothing, and a
 * record that stopped there (step `welcome`) reopens on the space step too (openingStep).
 *
 * Local-first, the wizard opens once for a pristine workspace (no accounts, no transactions, no
 * bills). Finishing or skipping stamps the local account's localStorage flag (onboardingFlag.ts)
 * and mirrors it into the profile's settings.
 *
 * It can always be relaunched from Settings → About or the tour-selection modal.
 */
import { createRoot, createSignal } from 'solid-js'
import { furthestStep, onboardingFinished, UNREADABLE } from '../../../shared/accountState'
import { ONBOARDING_STEPS } from '../../../shared/accountStateKeys'
import {
  accountState,
  isServerAccount,
  readAccountState,
  setAccountStateOwner,
  writeAccountState,
} from './accountState'
import { apiGet, apiPut } from './api'
import { beginGettingStarted } from './gettingStarted'
import {
  accountOnboardingOwner,
  BROWSER_WIDE_ONBOARDING_KEY,
  LOCAL_ONBOARDING_OWNER,
  onboardingFlagKey,
} from './onboardingFlag'
import type { OnboardingDecision, OnboardingStep } from '../../../shared/accountStateKeys'

// The step names are stored on the account and counted by the first-week measurement, so they
// live with the record's other names in shared/.
export { ONBOARDING_STEPS }
export type { OnboardingStep }

/**
 * The steps the wizard shows, in order: every stored step but `welcome`, which no build writes any
 * more. Back and Continue walk these. The wizard itself goes past `subscriptions` when nothing
 * was imported, so a record can go from `import` straight to `done`.
 */
export const SHOWN_ONBOARDING_STEPS: readonly OnboardingStep[] = ONBOARDING_STEPS.filter(
  (step) => step !== 'welcome'
)

/** The step the wizard opens on for a stored or asked-for step: `welcome` and none open on `space`. */
export function openingStep(step: OnboardingStep | null | undefined): OnboardingStep {
  return step === null || step === undefined || step === 'welcome' ? 'space' : step
}

export type OnboardingStatus = OnboardingDecision | null

/** Whose flag is read and written: an account (`account-<id>`), `local`, or nobody yet. */
let owner: string | null = null

/** The furthest wizard step this tab has sent for the owner, so each is sent once, answered or not. */
let furthestSent: OnboardingStep | null = null

const keyOf = onboardingFlagKey

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
  if (!serverMode) return LOCAL_ONBOARDING_OWNER
  return typeof accountId === 'number' ? accountOnboardingOwner(accountId) : null
}

/**
 * Read and write the decision of `next` from now on, and keep its account state
 * (accountState.ts). The browser-wide flag goes to the local account only, unless it has a
 * decision of its own, and is then removed. No server account takes it: the account's own record
 * decides there, as on a new device.
 */
export function setOnboardingOwner(next: string | null): void {
  if (next !== owner) furthestSent = null
  owner = next
  setAccountStateOwner(next)
  if (next !== LOCAL_ONBOARDING_OWNER) return
  try {
    const browserWide = localStorage.getItem(BROWSER_WIDE_ONBOARDING_KEY)
    if (browserWide === null) return
    if (isDecision(browserWide) && localStorage.getItem(keyOf(next)) === null) {
      localStorage.setItem(keyOf(next), browserWide)
    }
    localStorage.removeItem(BROWSER_WIDE_ONBOARDING_KEY)
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

/** The decision `of` made, or the current owner's. */
export function getOnboardingStatus(of: string | null = owner): OnboardingStatus {
  if (of === null) return null
  try {
    const raw = localStorage.getItem(keyOf(of))
    return isDecision(raw) ? raw : null
  } catch {
    return null
  }
}

/** Keep `status` as the decision of `of`, the current owner unless named. */
function setOnboardingStatus(
  status: Exclude<OnboardingStatus, null>,
  of: string | null = owner
): void {
  if (of === null) return
  try {
    localStorage.setItem(keyOf(of), status)
  } catch {
    // Non-fatal: the wizard may auto-open again next visit.
  }
}

/**
 * Local-first: best-effort mirror of the decision into the profile's settings (`/api/settings`),
 * which local-first keeps in IndexedDB. Failures are swallowed: the localStorage flag already
 * keeps the decision. Signed in, the account's record replaces the mirror (recordDecision).
 */
let mirrorInFlight: Promise<unknown> = Promise.resolve()

function persistRemoteStatus(status: Exclude<OnboardingStatus, null>) {
  mirrorInFlight = apiPut('/api/settings', { onboarding: status }).catch(() => {})
}

/** Resolves once the most recent decision write, mirror or record, has settled (tests await this). */
export function onboardingMirrorSettled(): Promise<unknown> {
  return mirrorInFlight
}

/**
 * Signed in: send `outcome` to the account's record, with the step it was decided on when there
 * is one. Until the Worker has it, this browser's flag keeps it: a write that fails, or a tab
 * closed before the answer, leaves the flag, and the next start sends it again (whereToOffer).
 * Once the record says finished, the flag goes.
 */
function recordDecision(
  of: string,
  outcome: OnboardingDecision,
  step: OnboardingStep | null
): Promise<void> {
  setOnboardingStatus(outcome, of)
  const sent = writeAccountState('onboarding', step === null ? { outcome } : { step, outcome })
    .then((record) => {
      if (onboardingFinished(record)) forgetOnboardingStatus(of)
    })
    .catch(() => {
      // Kept in this browser's flag; the next start sends it again.
    })
  mirrorInFlight = sent
  return sent
}

/**
 * Signed in: record `step` on the account when it is further than any step the record holds or
 * this tab has sent. Nothing is sent while the record is unknown (its read failed, or it cannot be
 * read) or finished: a relaunched wizard walks its steps without touching the record the first
 * week counts.
 */
function recordStep(step: OnboardingStep): void {
  const of = owner
  if (!isServerAccount(of)) return
  const state = accountState()
  if (state === null || state.onboarding === UNREADABLE || onboardingFinished(state.onboarding)) {
    return
  }
  const reached = furthestStep(state.onboarding?.step ?? null, furthestSent)
  if (reached !== null && furthestStep(reached, step) === reached) return
  furthestSent = step
  void writeAccountState('onboarding', { step }).catch(() => {
    // Not kept: the next step sends the furthest one again.
    if (owner === of) furthestSent = null
  })
}

const store = createRoot(() => {
  const [onboardingOpen, setOnboardingOpen] = createSignal(false)
  const [onboardingStep, setOnboardingStep] = createSignal<OnboardingStep>('space')
  return { onboardingOpen, setOnboardingOpen, onboardingStep, setOnboardingStep }
})

export const onboardingOpen = store.onboardingOpen
export const onboardingStep = store.onboardingStep

/** Show `step`, and record it on the account when it is the furthest reached. */
function showStep(step: OnboardingStep): void {
  store.setOnboardingStep(step)
  recordStep(step)
}

export function startOnboarding(step: OnboardingStep = 'space') {
  const at = openingStep(step)
  // The step first: the wizard seeds the step it opens on, not the one it last showed.
  store.setOnboardingStep(at)
  store.setOnboardingOpen(true)
  recordStep(at)
}

export function goToOnboardingStep(step: OnboardingStep) {
  showStep(openingStep(step))
}

export function nextOnboardingStep() {
  const order = SHOWN_ONBOARDING_STEPS
  const idx = order.indexOf(openingStep(store.onboardingStep()))
  if (idx >= 0 && idx < order.length - 1) showStep(order[idx + 1])
}

export function prevOnboardingStep() {
  const order = SHOWN_ONBOARDING_STEPS
  const idx = order.indexOf(openingStep(store.onboardingStep()))
  if (idx > 0) showStep(order[idx - 1])
}

/**
 * Keep the decision and close: on the account's record signed in, else the flag and settings. The
 * first decision also gives the account its Getting started card (gettingStarted.ts); a wizard
 * relaunched after that changes neither.
 */
function decide(outcome: OnboardingDecision): void {
  const of = owner
  store.setOnboardingOpen(false)
  if (isServerAccount(of)) {
    // Relaunched over a finished record: the first decision stands, so there is nothing to send.
    // Over one this build cannot read, the decision may stand there too, so the same.
    const record = accountState()?.onboarding ?? null
    if (record === UNREADABLE || onboardingFinished(record)) return
    void recordDecision(of, outcome, store.onboardingStep())
    beginGettingStarted(of)
    return
  }
  const first = getOnboardingStatus(of) === null
  setOnboardingStatus(outcome, of)
  persistRemoteStatus(outcome)
  if (first) beginGettingStarted(of)
}

/** Finish the wizard. */
export function completeOnboarding() {
  decide('completed')
}

/** Leave the wizard early. */
export function skipOnboarding() {
  decide('skipped')
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
 * The step the wizard should auto-open at, or null to leave it closed. Any failed read counts as
 * "no": a broken bootstrap must not trap the user in a wizard.
 */
export async function whereToOfferOnboarding(): Promise<OnboardingStep | null> {
  // The owner as the check starts: a decision found on the way is kept for the account that
  // asked, even if another signs in before the answer.
  const asking = owner
  if (asking === null) return null
  if (isServerAccount(asking)) return whereToOfferOnTheAccount(asking)
  return (await shouldOfferLocally(asking)) ? 'space' : null
}

/**
 * Signed in: the step the account's record reached (openingStep), unless the record is finished. A decision
 * kept from before the record existed, in this browser's flag or the profile's settings (the app
 * before this one wrote both), goes to the record instead, and the wizard stays closed. A record
 * this build cannot read may be finished: nothing opens, and this browser's flag stays unsent.
 */
async function whereToOfferOnTheAccount(asking: string): Promise<OnboardingStep | null> {
  const state = await readAccountState()
  if (owner !== asking || state === null) return null
  const record = state.onboarding
  if (record === UNREADABLE) return null
  if (onboardingFinished(record)) {
    forgetOnboardingStatus(asking)
    return null
  }
  let kept = getOnboardingStatus(asking)
  if (kept === null) {
    const settings = await apiGet<Record<string, unknown>>('/api/settings').catch(() => null)
    // Unknown is not "none": with the settings unread, the wizard stays closed this time.
    if (settings === null || owner !== asking) return null
    const remote = settings.onboarding
    kept = remote === 'completed' || remote === 'skipped' ? remote : null
  }
  if (kept !== null) {
    await recordDecision(asking, kept, null)
    return null
  }
  return openingStep(record?.step)
}

/** Whether the wizard should auto-open, at whichever step (whereToOfferOnboarding). */
export async function shouldOfferOnboarding(): Promise<boolean> {
  return (await whereToOfferOnboarding()) !== null
}

/**
 * Local-first's check: the workspace has never seen the wizard (no decision on this device or in
 * its settings) AND the current profile is pristine: zero accounts, zero transactions, zero bills.
 */
async function shouldOfferLocally(asking: string): Promise<boolean> {
  if (getOnboardingStatus(asking) !== null) return false
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
      setOnboardingStatus(remote, asking)
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
  const step = await whereToOfferOnboarding()
  if (step !== null) startOnboarding(step)
}
