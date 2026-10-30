/**
 * The seven circles for the active profile, in both storage modes: the region compared with, the
 * person's numbers (shared/guidance/facts.ts), where they place them (circles.ts), the ledger's
 * rows and status (ledger.ts) and Your next step (nextStep.ts).
 *
 * What it reads:
 *
 * - **The achievements snapshot** (achievementsStore.ts): the profile's entries, categories,
 *   accounts, loans, bills and import logs, from the last badge evaluation, which follows every
 *   data change in both modes.
 * - **The profile's settings** (`GET /api/settings`): the answers record (core/guidanceAnswers.ts)
 *   and the retirement plan's withdrawal rate. Read here, not from the snapshot: a settings write
 *   starts no evaluation (core/dataChangedEvent.ts), so a copy in the snapshot would stay as it was
 *   before every answer. Read again after each settings write (`entityVersion('settings')`).
 * - **The profile's holdings** (`GET /api/portfolio/holdings`), at what was paid for them, as both
 *   runtimes value them; read again after each portfolio write.
 * - **The base currency** (`getLocalCurrency`), for the region and the answers given in a currency.
 *
 * Working the circles out reads every entry, so it happens only for someone who can see it: while
 * Progress or Dashboard is the page on screen (`useGuidance`), after the page has painted, once per
 * set of inputs. Pages stay mounted, so without that a category saved on another page would work
 * the circles out for a page nobody is looking at. The two pages share one result.
 *
 * A result belongs to one profile, and `guidanceView` answers null once another is active, until
 * the new profile's evaluation and settings are in: never the old profile's circles under the new
 * name.
 */
import { createEffect, createRoot, createSignal } from 'solid-js'
import { factsAnswersOf } from '../../../shared/guidance/answers'
import { placeCircle } from '../../../shared/guidance/circles'
import { guidanceFacts } from '../../../shared/guidance/facts'
import { ledgerRows, ledgerStatus } from '../../../shared/guidance/ledger'
import { nextStepOf } from '../../../shared/guidance/nextStep'
import { chooseRegion } from '../../../shared/guidance/region'
import { orientationSteps } from '../../../shared/orientation'
import { normalizeSettings } from '../../../shared/retirementSettings'
import { snapshot } from './achievementsStore'
import { afterPaint } from './afterPaint'
import { api, apiGet, formatWholeCurrency, getLocalCurrency } from './api'
import { activeProfileId } from './apiProfileScope'
import { getPage, getProfileVersion } from './appStore'
import { entityVersion } from './dataVersions'
import { answersIn } from './guidanceAnswers'
import { benchmarksShown } from './guidanceGate'
import { orientationFactsOnce } from './orientationOnce'
import { refetchOnActive } from './pageVisibility'
import { getStorageMode } from './storage/storageFactory'
import type { Answers } from '../../../shared/guidance/answers'
import type { Placement } from '../../../shared/guidance/circles'
import type { GuidanceFacts, GuidanceInput } from '../../../shared/guidance/facts'
import type { LedgerRow, LedgerStatus, LedgerWords } from '../../../shared/guidance/ledger'
import type { NextStep } from '../../../shared/guidance/nextStep'
import type { RegionChoice } from '../../../shared/guidance/region'
import type { AchievementsSnapshot } from './achievementsStore'

/** The pages that show the circles. */
export type GuidancePage = 'progress' | 'dashboard'

/** What the circles read besides the snapshot, for one profile. */
export interface GuidanceInputs {
  profileId: number
  answers: Answers
  /** The retirement plan's safe withdrawal rate, in percent; its default when none is saved. */
  withdrawalRatePct: number
  /** The base currency when the settings were read. */
  currency: string
  /** The holdings at what was paid for them, added up; null when they could not be read. */
  holdings: number | null
}

/** The circles for one profile, and what they were worked out from. */
export interface GuidanceView {
  profileId: number
  snapshot: AchievementsSnapshot
  inputs: GuidanceInputs
  /** Whether the benchmarks gate was open (core/guidanceGate.ts). */
  gate: boolean
  region: RegionChoice
  facts: GuidanceFacts
  placement: Placement
  /** The ledger's seven rows, and the status over them. */
  rows: LedgerRow[]
  status: LedgerStatus
  /** Your next step: Getting started's first while less than a year is on file. */
  next: NextStep
  /** Money in whole units of the base currency, as the rows write it. */
  words: LedgerWords
}

const SETTINGS_KEY = 'retirement_settings'

const state = createRoot(() => {
  const [inputs, setInputs] = createSignal<GuidanceInputs | null>(null)
  const [view, setView] = createSignal<GuidanceView | null>(null)
  return { inputs, setInputs, view, setView }
})

/**
 * The retirement plan's withdrawal rate, as the plan reads it (shared/retirementSettings.ts
 * `normalizeSettings`): the Worker keeps the plan under the plain key, per profile; local-first
 * names the profile in the key, and a plan saved before that sits under the plain key until a
 * profile opens it.
 */
export function withdrawalRateIn(settings: Record<string, unknown>, profileId: number): number {
  const local = settings[`${SETTINGS_KEY}:${profileId}`]
  const raw =
    getStorageMode() === 'serverless' && local !== undefined ? local : settings[SETTINGS_KEY]
  let plan: unknown = raw
  if (typeof raw === 'string') {
    try {
      plan = JSON.parse(raw)
    } catch {
      plan = {}
    }
  }
  return normalizeSettings(plan ?? {}).safeWithdrawalRatePct
}

interface HoldingRow {
  profile_id?: unknown
  marketValue?: unknown
}

/** The profile's holdings at what was paid for them, added up. The list covers the household. */
export function holdingsOf(rows: unknown, profileId: number): number | null {
  if (!Array.isArray(rows)) return null
  let sum = 0
  for (const row of rows as HoldingRow[]) {
    const owner = row.profile_id
    if (owner !== undefined && owner !== null && Number(owner) !== profileId) continue
    const value = Number(row.marketValue)
    if (Number.isFinite(value)) sum += value
  }
  return sum
}

/** Bumped per load, so a slower earlier read never lands over a later one. */
let loads = 0

/** Read the profile's settings and holdings, and keep them if the profile is still the active one. */
async function loadInputs(profileId: number): Promise<void> {
  const load = ++loads
  const [settings, holdings] = await Promise.all([
    api.getSettings().catch(() => null),
    apiGet('/api/portfolio/holdings').then(
      (rows) => holdingsOf(rows, profileId),
      () => null
    ),
  ])
  if (load !== loads || activeProfileId() !== profileId) return
  const before = state.inputs()
  // Settings that did not load keep what was read for this profile before, and with nothing
  // before, read as no answers and the default withdrawal rate.
  const kept = before?.profileId === profileId ? before : null
  const next: GuidanceInputs = {
    profileId,
    answers: settings ? answersIn(settings, profileId) : (kept?.answers ?? {}),
    withdrawalRatePct: settings
      ? withdrawalRateIn(settings, profileId)
      : (kept?.withdrawalRatePct ?? normalizeSettings({}).safeWithdrawalRatePct),
    currency: getLocalCurrency(),
    holdings,
  }
  // Most settings writes are not the circles' (a badge, a tour): the same inputs work nothing out.
  if (kept !== null && JSON.stringify(kept) === JSON.stringify(next)) return
  state.setInputs(next)
}

/** Take answers just saved (core/guidanceAnswers.ts `saveAnswers`), without waiting for a read. */
export function takeAnswers(profileId: number, answers: Answers): void {
  const before = state.inputs()
  if (before?.profileId !== profileId || activeProfileId() !== profileId) return
  // A read already on the way started before this save: it is left to land, and its answers are
  // replaced by a read after the save (the save's write bumps the settings version).
  state.setInputs({ ...before, answers })
}

/** The circles from `snap` and `inputs`. Pure apart from the clock the facts already hold. */
export function workOut(
  snap: AchievementsSnapshot,
  inputs: GuidanceInputs,
  gate: boolean
): GuidanceView {
  const region = chooseRegion({
    answer: inputs.answers.region,
    imports: snap.importLogs as GuidanceRegionImports,
    currency: inputs.currency,
  })
  const facts = guidanceFacts({
    today: snap.today,
    region: region.region,
    transactions: snap.transactions as GuidanceInput['transactions'],
    categories: snap.categories as GuidanceInput['categories'],
    accounts: snap.accounts as GuidanceInput['accounts'],
    loans: snap.loans,
    holdings: inputs.holdings,
    withdrawalRatePct: inputs.withdrawalRatePct,
    answers: factsAnswersOf(inputs.answers, { region: region.region, currency: inputs.currency }),
    bills: snap.bills,
  })
  const placement = placeCircle(facts, { freeMoney: gate })
  const words: LedgerWords = {
    money: (amount: number) => formatWholeCurrency(amount, inputs.currency),
  }
  // Getting started's steps scan the entries for subscriptions: read only while they are the step,
  // and from the facts Dashboard's Getting started card works out for the same evaluation.
  const orientation = facts.firm ? null : orientationSteps(orientationFactsOnce(snap))
  return {
    profileId: snap.profileId,
    snapshot: snap,
    inputs,
    gate,
    region,
    facts,
    placement,
    rows: ledgerRows(placement, facts, words),
    status: ledgerStatus(placement, facts, words),
    next: nextStepOf({ placement, facts, orientation, words }),
    words,
  }
}

type GuidanceRegionImports = Parameters<typeof chooseRegion>[0]['imports']

/** Forget every profile's inputs and circles. Tests only. */
export function __resetGuidanceForTest(): void {
  loads++
  state.setInputs(null)
  state.setView(null)
}

/** The circles for the active profile; null until they are worked out for it. */
export function guidanceView(): GuidanceView | null {
  void getProfileVersion()
  const view = state.view()
  return view !== null && view.profileId === activeProfileId() ? view : null
}

const guidanceOnScreen = (): boolean => getPage() === 'progress' || getPage() === 'dashboard'

/** Whether the view on hand was worked out from these inputs. */
const current = (
  view: GuidanceView | null,
  snap: AchievementsSnapshot,
  inputs: GuidanceInputs,
  gate: boolean
): boolean =>
  view !== null && view.snapshot === snap && view.inputs === inputs && view.gate === gate

/**
 * Keep the circles worked out while `page` is the page on screen, and answer them. Called once by
 * each page that shows them, in its component.
 */
export function useGuidance(page: GuidancePage): () => GuidanceView | null {
  refetchOnActive(
    page,
    () => [getProfileVersion(), entityVersion('settings'), entityVersion('portfolio')],
    () => {
      void loadInputs(activeProfileId())
    }
  )
  let waiting = false
  const work = () => {
    waiting = false
    // Read again: the evaluation, the settings or the page may have changed while this waited.
    const snap = snapshot()
    const inputs = state.inputs()
    const gate = benchmarksShown()
    if (!guidanceOnScreen() || snap === null || inputs === null) return
    if (snap.profileId !== inputs.profileId || snap.profileId !== activeProfileId()) return
    if (current(state.view(), snap, inputs, gate)) return
    state.setView(workOut(snap, inputs, gate))
  }
  createEffect(() => {
    const snap = snapshot()
    const inputs = state.inputs()
    void getProfileVersion()
    if (getPage() !== page || snap === null || inputs === null || waiting) return
    if (snap.profileId !== inputs.profileId) return
    if (current(state.view(), snap, inputs, benchmarksShown())) return
    waiting = true
    afterPaint(work)
  })
  return guidanceView
}
