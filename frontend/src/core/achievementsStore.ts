/**
 * Runs the evaluator for the current profile and keeps the unlock records in sync with the
 * profile's settings. Refresh happens on profile change and, debounced, after any mutating
 * request (api.ts dispatches DATA_CHANGED_EVENT). Nothing here is server-side.
 */
import { createRoot, createSignal } from 'solid-js'
import { achievementById } from './achievements/definitions'
import { evaluateAchievements } from './achievements/evaluate'
import { diffUnlocks, parseRecords, serializeRecords, SETTINGS_KEY } from './achievements/records'
import { api } from './api'
import { getStorageMode } from './storage/storageFactory'
import { addToast } from './toastStore'
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

const state = createRoot(() => {
  const [unlocks, setUnlocks] = createSignal<UnlockRecord[]>([])
  const [streak, setStreak] = createSignal(0)
  const [panelOpen, setPanelOpen] = createSignal(false)
  return { unlocks, setUnlocks, streak, setStreak, panelOpen, setPanelOpen }
})

export const unlocks = state.unlocks
export const streak = state.streak
export const panelOpen = state.panelOpen
export const openBadgesPanel = (): void => {
  state.setPanelOpen(true)
}
export const closeBadgesPanel = (): void => {
  state.setPanelOpen(false)
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
  const [settings, transactions, budgets, goals, importLogs] = await Promise.all([
    api.getSettings(),
    api.getTransactions(),
    api.getBudgets(),
    api.getGoals(),
    api.getImportLogs(),
  ])
  const stored = parseRecords(settings[SETTINGS_KEY])
  const now = new Date()
  const evaluation = evaluateAchievements({
    transactions,
    budgets,
    goals,
    importLogs,
    selfHosted: isSelfHosted(),
    today: now.toISOString().slice(0, 10),
  })
  state.setStreak(evaluation.streak)
  const { newly, merged } = diffUnlocks(stored, evaluation.earned, now.toISOString())
  state.setUnlocks(merged)
  if (newly.length === 0) return []
  await api.updateSettings({ [SETTINGS_KEY]: serializeRecords(merged) })
  announce(newly, stored.length === 0)
  return newly
}

function announce(newly: UnlockRecord[], firstRun: boolean): void {
  const opts = {
    channel: 'achievements',
    durationMs: 9000,
    action: { label: 'See badges', onClick: openBadgesPanel },
  }
  if (firstRun && newly.length > 1) {
    addToast(`${newly.length} badges earned from your history so far.`, 'success', opts)
    return
  }
  for (const rec of newly) {
    addToast(`Badge unlocked: ${achievementById(rec.id).name}.`, 'success', opts)
  }
}
