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
 * and mirrors it into the profile's settings. A signed-in account that chose "Keep my data in this
 * browser only" leaves a one-shot marker (LOCAL_SETUP_PENDING_KEY): the local workspace it reloads
 * into opens the wizard on its space step when it holds no profile of the person's own, only the
 * demo's example profiles, though they are far from pristine. The marker goes once the space is
 * saved or setup is left, and at once when the workspace has a profile of the person's own. It
 * also goes when the demo is asked for (Continue with no account, a `?demo=` link) and when a
 * signed-in account boots: a path back to the account that never passed setup leaves nothing that
 * would later open setup over the demo.
 *
 * It can always be relaunched from Settings → About or the tour-selection modal.
 *
 * A file setup cannot read goes to the Import page, and setup waits there (pauseOnboarding): closed
 * with nothing decided, at the step it reached, while the person matches the file's columns. The
 * Import page offers Back to setup (resumeOnboarding), which opens it again at the subscriptions in
 * what was imported, or at the statement when nothing was. Nothing else in the tab opens it over the
 * columns: maybeOfferOnboarding runs at the app's start and at a sign-in only. Finished or left in the
 * meantime, on this device or another, it stays closed. Never taken, the way back is the one any
 * setup left part way has: the next start, here or on another device, opens it at the step reached,
 * which an import on the way made the subscriptions.
 */
import { createRoot, createSignal } from 'solid-js'
import { furthestStep, onboardingFinished, UNREADABLE } from '../../../shared/accountState'
import { ONBOARDING_STEPS } from '../../../shared/accountStateKeys'
import {
  accountState,
  isServerAccount,
  readAccountState,
  rereadAccountState,
  setAccountStateOwner,
  writeAccountState,
} from './accountState'
import { apiGet, apiPut } from './api'
import { isExampleProfileName } from './demoMode'
import { beginGettingStarted } from './gettingStarted'
import {
  accountOnboardingOwner,
  BROWSER_WIDE_ONBOARDING_KEY,
  clearLocalSetupPending,
  clearLocalSetupWaiting,
  LOCAL_ONBOARDING_OWNER,
  localSetupPending,
  localSetupStep,
  localSetupWaitingOver,
  markLocalSetupPending,
  noteLocalSetupWaiting,
  onboardingFlagKey,
} from './onboardingFlag'
import { forgetTypedBalances } from './setupTypedBalances'
import type { OnboardingDecision, OnboardingStep } from '../../../shared/accountStateKeys'
import type { BankId } from './bankImport'

// The step names are stored on the account and counted by the first-week measurement, so they
// live with the record's other names in shared/.
export { ONBOARDING_STEPS }
export type { OnboardingStep }

// The local-only switch's marker lives with the flag's keys, so the demo's entry points
// (demoMode.ts, LoginScreen) can drop it without importing this store.
export {
  clearLocalSetupPending,
  LOCAL_SETUP_PENDING_KEY,
  localSetupPending,
  markLocalSetupPending,
} from './onboardingFlag'

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
  if (next !== owner) {
    furthestSent = null
    // Setup waits for the owner that left it: another sign-in finds nothing waiting.
    waiting[1](null)
    soFar[1](null)
  }
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
  if (of === LOCAL_ONBOARDING_OWNER) {
    keepLocalStep(step)
    return
  }
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

/** A step as kept in the local marker, or null for none this build knows. */
function knownStep(kept: string | null): OnboardingStep | null {
  return ONBOARDING_STEPS.find((step) => step === kept) ?? null
}

/**
 * Local-first: keep the furthest step the first setup reached in the marker, until it is finished
 * or left (review M7). Setup run again after a decision keeps nothing, as signed in; one the
 * local-only switch asked for keeps its steps over a decision the demo left behind.
 */
function keepLocalStep(step: OnboardingStep): void {
  if (getOnboardingStatus(LOCAL_ONBOARDING_OWNER) !== null && !localSetupPending()) return
  markLocalSetupPending(furthestStep(knownStep(localSetupStep()), step) ?? step)
}

/**
 * Whether the wizard is on a signed-in account's first setup: its record is read and not finished.
 * Run again over a finished record ("Run setup again"), or with the record unknown, it is not.
 */
export function firstSetupOfTheAccount(): boolean {
  if (!isServerAccount(owner)) return false
  const state = accountState()
  if (state === null || state.onboarding === UNREADABLE) return false
  return !onboardingFinished(state.onboarding)
}

const store = createRoot(() => {
  const [onboardingOpen, setOnboardingOpen] = createSignal(false)
  const [onboardingStep, setOnboardingStep] = createSignal<OnboardingStep>('space')
  return { onboardingOpen, setOnboardingOpen, onboardingStep, setOnboardingStep }
})

/** A statement setup imported: its bank, its currency, and the account it went into. */
export interface SetupStatement {
  bankId: BankId
  currency: string
  account: string
}

/** An import that counts as setup's: the wizard's own, or the Import page's while setup waits. */
export interface SetupImport {
  imported: number
  createdAccounts: readonly string[]
  /** The bank statements in it, for where the next ones go (statementTargets.ts). */
  statements: readonly SetupStatement[]
  /** The accounts its transactions went into, when known. */
  into?: readonly string[]
}

/**
 * What this run of setup has done so far, kept here because the wizard closes, and opens anew,
 * while setup waits on the Import page (review of 19 Nov, finding 12): its own copy began at
 * nothing again, so the statement step, the step after it and Done's count left out what came in.
 *
 * - `main`: the account its account step made.
 * - `imported`, `createdAccounts`: what its imports brought in and made, the wizard's and the
 *   Import page's while setup waited.
 * - `statements`: each bank statement imported, in order.
 * - `into`: the accounts the transactions went into; null once an import's are not known.
 */
export interface SetupSoFar {
  main: string | null
  imported: number
  createdAccounts: readonly string[]
  statements: readonly SetupStatement[]
  into: readonly string[] | null
}

const NOTHING_YET: SetupSoFar = {
  main: null,
  imported: 0,
  createdAccounts: [],
  statements: [],
  into: [],
}

const soFar = createRoot(() => createSignal<(SetupSoFar & { owner: string }) | null>(null))

/** What the current owner's setup has done so far; nothing for no setup under way. */
export function setupSoFar(): SetupSoFar {
  const kept = soFar[0]()
  return kept !== null && kept.owner === owner ? kept : NOTHING_YET
}

function keepSoFar(change: (now: SetupSoFar) => SetupSoFar): void {
  if (owner === null) return
  soFar[1]({ ...change(setupSoFar()), owner })
}

/** The account setup's account step made, where the statements of the first bank go. */
export function noteSetupAccount(name: string): void {
  keepSoFar((now) => ({ ...now, main: name }))
}

/** Count an import as setup's. */
export function noteSetupImport(done: SetupImport): void {
  if (done.imported <= 0 && done.statements.length === 0) return
  keepSoFar((now) => ({
    ...now,
    imported: now.imported + Math.max(0, done.imported),
    createdAccounts: [...new Set([...now.createdAccounts, ...done.createdAccounts])],
    statements: [...now.statements, ...done.statements],
    into:
      now.into === null || done.into === undefined
        ? null
        : [...new Set([...now.into, ...done.into])],
  }))
}

/**
 * Setup waiting on the Import page (pauseOnboarding), or null.
 *
 * - `id`: which wait it is. A new one each time setup is left for the page; an import on the page
 *   replaces the object and keeps the id, so the way back tells "still this wait" by the id. By
 *   the object, an import that ended while the account was read again read as another tap having
 *   taken the wait, and the way back said setup was finished (review of 19 Nov, P4).
 * - `owner`: whose setup it is.
 * - `rerun`: setup had been finished or left before this run of it (Settings, the tour menu). Such
 *   a record never changes again, so the way back has nothing to ask the account.
 * - `here`: what the Import page brought in, which its strip counts: setup's own were in before
 *   the file it handed over. All of it is setup's (setupSoFar).
 */
interface SetupWait {
  id: number
  owner: string
  rerun: boolean
  /** The decision this browser held as setup began to wait: local-first tells a new one by it. */
  decidedBefore: OnboardingStatus
  here: number
}

const waiting = createRoot(() => createSignal<SetupWait | null>(null))
let waits = 0

/** Whether setup is waiting on the Import page for the person to come back. */
export function setupWaiting(): boolean {
  return waiting[0]() !== null
}

/** The transactions the Import page brought in while setup waited, or 0. */
export function importedWhileSetupWaits(): number {
  return waiting[0]()?.here ?? 0
}

export const onboardingOpen = store.onboardingOpen
export const onboardingStep = store.onboardingStep

/** Show `step`, and record it on the account when it is the furthest reached. */
function showStep(step: OnboardingStep): void {
  store.setOnboardingStep(step)
  recordStep(step)
}

export function startOnboarding(step: OnboardingStep = 'space') {
  const at = openingStep(step)
  // Open again, by Back to setup or from Settings: it waits on the Import page no more.
  waiting[1](null)
  clearLocalSetupWaiting()
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
  waiting[1](null)
  soFar[1](null)
  // Left or finished: a local-only switch's setup never opens again by itself.
  clearLocalSetupPending()
  // Its "Balance today" figures say nothing about an import after it (review M2).
  forgetTypedBalances()
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

/**
 * A profile the person made counts as the decision setup asks for. In local-first, a workspace
 * with no decision yet keeps "skipped", as leaving setup would, and Getting started begins as it
 * does then, so setup never opens over that profile, empty as it starts. Signed in, the account's
 * record decides, and nothing changes here.
 *
 * Called by the profile menu's Create Profile (ProfileModal) for the current owner, and by the
 * local-only switch for `local` over a workspace with profiles of the person's own, which its
 * confirm says they carry on with. Setup's own space step does not call it: setup decides itself.
 */
export function countProfileMadeAsDecided(of: string | null = owner): void {
  if (of !== LOCAL_ONBOARDING_OWNER || getOnboardingStatus(of) !== null) return
  // Setup waiting on the Import page is setup under way: a profile made meanwhile, from the
  // profile menu, decides nothing, and Back to setup opens it at the step it reached.
  if (waiting[0]()?.owner === of) return
  setOnboardingStatus('skipped', of)
  // The decision ends any setup the marker kept the step of, as leaving it would.
  clearLocalSetupPending()
  // The mirror goes to the settings of the workspace open now, which is this one only when it is
  // local-first's; the switch calls this from the account.
  if (owner === of) persistRemoteStatus('skipped')
  beginGettingStarted(of)
}

/** Finish the wizard. */
export function completeOnboarding() {
  decide('completed')
}

/**
 * Leave setup waiting on the Import page, for a file it cannot read (OnboardingWizard, Open in
 * Import): closed, with nothing decided, at the step it reached. With anything setup brought in
 * before it handed the file over (setupSoFar), the step reached is the subscriptions. The balances
 * typed in setup stay too, for the statements still to come (setupTypedBalances.ts).
 */
export function pauseOnboarding(): void {
  const of = owner
  store.setOnboardingOpen(false)
  if (of === null) return
  const rerun = isServerAccount(of)
    ? !firstSetupOfTheAccount()
    : getOnboardingStatus(of) !== null && !localSetupPending()
  const decidedBefore = getOnboardingStatus(of)
  waiting[1]({ id: ++waits, owner: of, rerun, decidedBefore, here: 0 })
  // The next start reads it beside the marker: decided since, it opens nothing.
  if (of === LOCAL_ONBOARDING_OWNER && localSetupPending()) noteLocalSetupWaiting(decidedBefore)
  if (setupSoFar().imported > 0) recordStep('subscriptions')
}

/**
 * The Import page imported `done` while setup waited: it counts as setup's own (setupSoFar), the
 * way back opens setup at the subscriptions in it, and so does the next start if the person never
 * takes it. A bare count is an import whose accounts are not known.
 */
export function noteImportWhileSetupWaits(done: SetupImport | number): void {
  const wait = waiting[0]()
  const counted: SetupImport =
    typeof done === 'number' ? { imported: done, createdAccounts: [], statements: [] } : done
  if (wait === null || wait.owner !== owner || counted.imported <= 0) return
  waiting[1]({ ...wait, here: wait.here + counted.imported })
  noteSetupImport(counted)
  recordStep('subscriptions')
}

/**
 * Whether setup was finished or left since it began to wait, on this device or another: the
 * account's record is read again for it. Null when that cannot be told.
 */
async function decidedSince(wait: SetupWait): Promise<boolean | null> {
  const of = wait.owner
  // Local-first, a decision made since it began to wait (another tab). One held before it stands
  // beside a setup the local-only switch asked for, over a demo decided earlier (review M7): by
  // presence alone, the way back said that setup was finished.
  if (!isServerAccount(of)) return getOnboardingStatus(of) !== wait.decidedBefore
  // A decision this browser keeps (another tab), sent to the account or not yet.
  if (getOnboardingStatus(of) !== null) return true
  const state = await rereadAccountState()
  if (state === null || owner !== of) return null
  return state.onboarding === UNREADABLE || onboardingFinished(state.onboarding)
}

/**
 * Back to setup, from the Import page: open setup again at the subscriptions in what was imported
 * on the way, or at the statement when nothing was. Resolves `opened`; `finished` when setup was
 * finished or left meanwhile, here or on another device, so it stays closed and waits no more; or
 * `unknown` when the account could not be read, so it keeps waiting to be tried again.
 */
export async function resumeOnboarding(): Promise<'opened' | 'finished' | 'unknown'> {
  const wait = waiting[0]()
  if (wait === null || wait.owner !== owner) {
    waiting[1](null)
    return onboardingOpen() ? 'opened' : 'finished'
  }
  if (!wait.rerun) {
    const decided = await decidedSince(wait)
    // Taken already, by another tap while the account was read, or another owner signed in. An
    // import that landed meanwhile keeps the wait's id.
    if (waiting[0]()?.id !== wait.id) return onboardingOpen() ? 'opened' : 'finished'
    if (decided === null) return 'unknown'
    if (decided) {
      waiting[1](null)
      clearLocalSetupWaiting()
      return 'finished'
    }
  }
  // As it is now: an import may have landed while the account was read.
  startOnboarding(setupSoFar().imported > 0 ? 'subscriptions' : 'import')
  return 'opened'
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
  if (isServerAccount(asking)) {
    // Back on the account by a path that never passed setup (a `?plan=` or confirm link, Sign in,
    // Settings): the local workspace has no setup waiting, and a later demo opens as the demo.
    clearLocalSetupPending()
    return whereToOfferOnTheAccount(asking)
  }
  if (localSetupPending() && localSetupDecidedWhileWaiting()) {
    // Setup was left waiting on the Import page and decided since: the marker it kept is stale,
    // and setup stays closed (review of 19 Nov, P3).
    clearLocalSetupPending()
  }
  if (localSetupPending()) {
    const own = await holdsOwnProfile()
    if (owner !== asking || own === null) return null
    // Only the examples, or nothing: setup opens on the space, however much the examples hold.
    if (!own) return 'space'
    // Setup under way in this workspace: on again at the furthest step it reached (review M7).
    const reached = knownStep(localSetupStep())
    if (reached !== null) return openingStep(reached)
    // The switch's ask, over a workspace of the person's own: carried on with as before.
    clearLocalSetupPending()
  }
  return (await shouldOfferLocally(asking)) ? 'space' : null
}

/** Whether local setup began to wait on the Import page and a decision was made since. */
function localSetupDecidedWhileWaiting(): boolean {
  const over = localSetupWaitingOver()
  if (over === null) return false
  return (getOnboardingStatus(LOCAL_ONBOARDING_OWNER) ?? 'none') !== over
}

/**
 * Whether the local workspace holds a profile of the person's own: one that is not an example
 * profile. Null when the profiles could not be read.
 */
async function holdsOwnProfile(): Promise<boolean | null> {
  try {
    const profiles = await apiGet<Array<{ name?: unknown }>>('/api/profiles')
    if (!Array.isArray(profiles)) return null
    return profiles.some((p) => typeof p.name === 'string' && !isExampleProfileName(p.name))
  } catch {
    return null
  }
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
