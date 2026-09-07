/**
 * Runs the evaluator for the current profile and keeps the unlock records in sync with the
 * profile's settings. Refresh happens on profile change and, debounced, after any mutating
 * request (api.ts dispatches DATA_CHANGED_EVENT). Nothing here is server-side.
 */
import { createRoot, createSignal } from 'solid-js'
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
import { setPage } from './appStore'
import { getStorageMode } from './storage/storageFactory'
import { addToast } from './toastStore'
import type { EvaluateInput, Evaluation } from './achievements/evaluate'
import type { UnlockRecord } from './achievements/records'

export const DATA_CHANGED_EVENT = 'tc:data-changed'

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

/** Wave a card away for good. Persisted next to the unlocks, so it survives a reload. */
export async function dismissAdvice(id: string): Promise<void> {
  if (state.dismissedAdvice().includes(id)) return
  const next = [...state.dismissedAdvice(), id]
  state.setDismissedAdvice(next)
  await api.updateSettings({ [SETTINGS_KEY]: serializeRecords(state.unlocks(), next) })
}

/** Bring every dismissed card back. */
export async function restoreAdvice(): Promise<void> {
  if (state.dismissedAdvice().length === 0) return
  state.setDismissedAdvice([])
  await api.updateSettings({ [SETTINGS_KEY]: serializeRecords(state.unlocks(), []) })
}

let inFlight: Promise<UnlockRecord[]> | null = null

/** Evaluate, persist what is new, toast. Concurrent calls share one run. */
export function refreshAchievements(): Promise<UnlockRecord[]> {
  inFlight ??= run().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function run(): Promise<UnlockRecord[]> {
  const [settings, transactions, budgets, goals, importLogs, categories, bills] = await Promise.all(
    [
      api.getSettings(),
      api.getTransactions(),
      api.getBudgets(),
      api.getGoals(),
      api.getImportLogs(),
      api.getCategories(),
      api.getBills(),
    ]
  )
  const stored = parseRecords(settings[SETTINGS_KEY])
  const dismissed = parseDismissed(settings[SETTINGS_KEY])
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const evaluation = evaluateAchievements({
    transactions,
    budgets,
    goals,
    importLogs,
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
    categories,
    bills,
    evaluation,
    today,
  })
  const { newly, merged } = diffUnlocks(stored, evaluation.earned, now.toISOString())
  state.setUnlocks(merged)
  if (newly.length === 0) return []
  await api.updateSettings({ [SETTINGS_KEY]: serializeRecords(merged, dismissed) })
  announce(newly, stored.length === 0)
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
