/**
 * What persists: which badges this profile has unlocked, and when. Stored as one JSON string
 * under the profile's settings key `achievements` — per profile, in both storage modes, and in
 * every backup already. The evaluator decides what is earned; this record only adds, so a badge
 * survives the deletion of the data that earned it.
 */
import { ACHIEVEMENTS } from './definitions'
import type {AchievementId} from './definitions';
import type { Earned } from './evaluate'

export const SETTINGS_KEY = 'achievements'

export interface UnlockRecord extends Earned {
  /** ISO datetime of the unlock (toast time). */
  unlockedAt: string
}

const KNOWN = new Set<string>(ACHIEVEMENTS.map((a) => a.id))
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(v: unknown): v is UnlockRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    KNOWN.has(r.id) &&
    typeof r.earnedOn === 'string' &&
    DAY_RE.test(r.earnedOn) &&
    typeof r.unlockedAt === 'string'
  )
}

export function parseRecords(raw: unknown): UnlockRecord[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as { unlocks?: unknown } | null
    const list = Array.isArray(parsed?.unlocks) ? parsed.unlocks : []
    return list
      .filter(isRecord)
      .map((r) => ({ id: r.id, earnedOn: r.earnedOn, unlockedAt: r.unlockedAt }))
  } catch {
    return []
  }
}

export const serializeRecords = (records: UnlockRecord[]): string =>
  JSON.stringify({ v: 1, unlocks: records })

/** Stored wins; earned-but-unstored becomes a new record stamped `now`. Definition order. */
export function diffUnlocks(
  stored: UnlockRecord[],
  earned: Earned[],
  now: string
): { newly: UnlockRecord[]; merged: UnlockRecord[] } {
  const have = new Map<AchievementId, UnlockRecord>(stored.map((r) => [r.id, r]))
  const newly: UnlockRecord[] = []
  for (const e of earned) {
    if (have.has(e.id)) continue
    const rec = { id: e.id, earnedOn: e.earnedOn, unlockedAt: now }
    have.set(e.id, rec)
    newly.push(rec)
  }
  const merged = ACHIEVEMENTS.map((a) => have.get(a.id)).filter(
    (r): r is UnlockRecord => r !== undefined
  )
  return { newly, merged }
}
