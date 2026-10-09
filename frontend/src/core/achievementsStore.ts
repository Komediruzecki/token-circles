/**
 * Runs the evaluator for the current profile and keeps the unlock records in sync with the
 * profile's settings. Refresh happens on profile change and, debounced, after any mutating
 * request (apiFetch dispatches DATA_CHANGED_EVENT for both client surfaces — see
 * core/dataChangedEvent.ts). Nothing here is server-side.
 *
 * Badges are per profile: they are earned from the active profile's own rows and stored where
 * only that profile reads them. They used to be judged on the household view, so ticking another
 * profile into it in Settings earned the active profile that profile's badges, permanently.
 */
import { createRoot, createSignal } from 'solid-js'
import { localToday } from '../utils/period'
import { achievementById } from './achievements/definitions'
import { evaluateAchievements } from './achievements/evaluate'
import {
  diffUnlocks,
  parseDismissed,
  parseRecords,
  serializeRecords,
  SETTINGS_KEY,
} from './achievements/records'
import { api } from './api'
import { activeProfileId } from './apiProfileScope'
import { setPage } from './appStore'
import { getStorageMode } from './storage/storageFactory'
import { addToast } from './toastStore'
import type { EvaluateInput, Evaluation } from './achievements/evaluate'
import type { UnlockRecord } from './achievements/records'

/**
 * Re-exported so existing importers keep their import path. The constant itself lives in a leaf
 * module because `apiFetch` dispatches it and this store imports the API client — importing it
 * from here would close a cycle.
 */
export { DATA_CHANGED_EVENT } from './dataChangedEvent'

const OUR_HOSTS = /(^|\.)tokencircles\.com$/i

/** Server mode against an API origin that is not ours: the user runs the stack. */
export function isSelfHosted(): boolean {
  if (getStorageMode() !== 'self-hosted') return false
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.href
    return !OUR_HOSTS.test(new URL(base || '/', origin).hostname)
  } catch {
    return false
  }
}

/**
 * Everything the last evaluation ran on. The Progress page builds its advice and its year in
 * review from this instead of fetching the same five arrays a second time.
 */
export interface AchievementsSnapshot {
  transactions: EvaluateInput['transactions']
  budgets: EvaluateInput['budgets']
  goals: EvaluateInput['goals']
  importLogs: EvaluateInput['importLogs']
  loans: EvaluateInput['loans']
  categories: Array<{ id: number; name: string }>
  bills: Array<{ category_id?: number | null; amount?: number; name?: string }>
  evaluation: Evaluation
  /** YYYY-MM-DD the evaluation used, so the page and the badges agree on "today". */
  today: string
}

const state = createRoot(() => {
  const [unlocks, setUnlocks] = createSignal<UnlockRecord[]>([])
  const [streak, setStreak] = createSignal(0)
  const [snapshot, setSnapshot] = createSignal<AchievementsSnapshot | null>(null)
  const [dismissedAdvice, setDismissedAdvice] = createSignal<string[]>([])
  return {
    unlocks,
    setUnlocks,
    streak,
    setStreak,
    snapshot,
    setSnapshot,
    dismissedAdvice,
    setDismissedAdvice,
  }
})

export const unlocks = state.unlocks
export const streak = state.streak
export const snapshot = state.snapshot
export const dismissedAdvice = state.dismissedAdvice

/**
 * Where a profile's badge record is stored.
 *
 * The Worker's settings table is keyed by (key, profile_id), so there the plain key is already per
 * profile. The browser store keeps one row per key for the whole device, so local-first mode puts
 * the profile in the key — the convention the retirement settings set
 * (storage/handlers/calculators.ts).
 */
export function recordKey(profileId: number): string {
  return getStorageMode() === 'serverless' ? `${SETTINGS_KEY}:${profileId}` : SETTINGS_KEY
}

/**
 * The profile whose badges `state` holds, once an evaluation has finished. Until the evaluation a
 * profile switch schedules has run, the unlocks on screen are still the previous profile's.
 */
let loadedFor: number | null = null

/**
 * Save the advice cards beside the unlocks. Skipped while the unlocks held are another profile's:
 * written now, they would be filed as the active profile's badges (in cloud mode the write goes to
 * whichever profile is active when it is sent).
 */
async function saveAdvice(dismissed: string[]): Promise<void> {
  const profileId = activeProfileId()
  if (loadedFor !== profileId) return
  await api.updateSettings({
    [recordKey(profileId)]: serializeRecords(state.unlocks(), dismissed),
  })
}

/** Wave a card away for good. Persisted next to the unlocks, so it survives a reload. */
export async function dismissAdvice(id: string): Promise<void> {
  if (state.dismissedAdvice().includes(id)) return
  const next = [...state.dismissedAdvice(), id]
  state.setDismissedAdvice(next)
  await saveAdvice(next)
}

/** Bring every dismissed card back. */
export async function restoreAdvice(): Promise<void> {
  if (state.dismissedAdvice().length === 0) return
  state.setDismissedAdvice([])
  await saveAdvice([])
}

/**
 * Keep the rows that belong to the active profile.
 *
 * The list reads cover the household view: the endpoints take the household scope, and in
 * local-first mode the handlers read the household from storage whatever a request asks for. So
 * the filter goes here, where it holds in both modes. The schemas require `profile_id` on every
 * row this is used on; a row that names no profile cannot belong to another one, so it is kept.
 */
function ownRows<T extends object>(rows: T[], profileId: number): T[] {
  return rows.filter((row) => {
    const owner = (row as { profile_id?: number | null }).profile_id
    return owner === null || owner === undefined || owner === profileId
  })
}

let inFlight: { profileId: number; run: Promise<UnlockRecord[]> } | null = null

/**
 * Evaluate, persist what is new, toast. Concurrent calls for the same profile share one run; a
 * call after a profile switch starts its own, so the new profile is not handed the old one's.
 */
export function refreshAchievements(): Promise<UnlockRecord[]> {
  const profileId = activeProfileId()
  if (inFlight?.profileId === profileId) return inFlight.run
  const current = run(profileId).finally(() => {
    if (inFlight?.run === current) inFlight = null
  })
  inFlight = { profileId, run: current }
  return current
}

/**
 * The loans, with the rate periods and prepayments the amortisation needs. The list route does
 * not carry either in server mode, so each loan is fetched once; a profile with no loans makes
 * no extra request at all, and one with a mortgage makes one.
 *
 * A loan deleted between the list and its own read (in another tab, say) answers 404. It is
 * simply not counted, and the 404 is not logged as an error: nothing went wrong.
 */
async function loadLoans(profileId: number): Promise<EvaluateInput['loans']> {
  const list = ownRows(await api.getLoans().catch(() => []), profileId)
  if (list.length === 0) return []
  const details = await Promise.all(
    list.map((l) =>
      api.getLoan(l.id, { expectedStatuses: [404] }).catch(() => null as unknown as null)
    )
  )
  return details
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({
      principal: d.principal,
      interest_rate: d.interest_rate,
      start_date: d.start_date,
      term_months: d.term_months,
      rate_periods: d.rate_periods ?? [],
      prepayments: d.prepayments ?? [],
    }))
}

async function run(profileId: number): Promise<UnlockRecord[]> {
  const key = recordKey(profileId)
  const [settings, ...lists] = await Promise.all([
    api.getSettings(),
    api.getTransactions(),
    api.getBudgets(),
    api.getGoals(),
    api.getImportLogs(),
    api.getCategories(),
    api.getBills(),
    loadLoans(profileId),
  ])
  const transactions = ownRows(lists[0], profileId)
  const budgets = ownRows(lists[1], profileId)
  const goals = ownRows(lists[2], profileId)
  const importLogs = ownRows(lists[3], profileId)
  const categories = ownRows(lists[4], profileId)
  const bills = ownRows(lists[5], profileId)
  const loans = lists[6]

  // The profile changed while the lists loaded. What came back is the old profile's, and so would
  // the write be: in cloud mode it would land in the new profile's settings, because X-Profile-Id
  // is read when a request is made. The refresh the switch schedules evaluates the new profile.
  if (activeProfileId() !== profileId) return []

  // A record saved before badges were per profile sits under the plain key in local-first mode.
  // The first profile to evaluate adopts it and the old key is emptied: left in place, it would be
  // handed to every other profile too, which is the behaviour being fixed.
  const adopting =
    key !== SETTINGS_KEY && settings[key] === undefined && Boolean(settings[SETTINGS_KEY])
  const raw = adopting ? settings[SETTINGS_KEY] : settings[key]
  const stored = parseRecords(raw)
  const dismissed = parseDismissed(raw)
  const now = new Date()
  const today = localToday(now)
  const evaluation = evaluateAchievements({
    transactions,
    budgets,
    goals,
    importLogs,
    loans,
    selfHosted: isSelfHosted(),
    today,
  })
  state.setStreak(evaluation.streak)
  state.setDismissedAdvice(dismissed)
  state.setSnapshot({
    transactions,
    budgets,
    goals,
    importLogs,
    loans,
    categories,
    bills,
    evaluation,
    today,
  })
  const { newly, merged } = diffUnlocks(stored, evaluation.earned, now.toISOString())
  state.setUnlocks(merged)
  loadedFor = profileId
  if (newly.length === 0 && !adopting) return []
  await api.updateSettings({
    [key]: serializeRecords(merged, dismissed),
    ...(adopting ? { [SETTINGS_KEY]: '' } : {}),
  })
  // Saved for the profile that earned them either way; not announced on one that did not.
  if (newly.length > 0 && activeProfileId() === profileId) announce(newly, stored.length === 0)
  return newly
}

function announce(newly: UnlockRecord[], firstRun: boolean): void {
  const opts = {
    channel: 'achievements',
    durationMs: 9000,
    action: {
      label: 'See badges',
      onClick: () => {
        setPage('progress')
      },
    },
  }
  if (firstRun && newly.length > 1) {
    addToast(`${newly.length} badges earned from your history so far.`, 'success', opts)
    return
  }
  for (const rec of newly) {
    addToast(`Badge unlocked: ${achievementById(rec.id).name}.`, 'success', opts)
  }
}
