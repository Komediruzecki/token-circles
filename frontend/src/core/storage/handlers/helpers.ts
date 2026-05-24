/**
 * Shared helpers for local API handlers.
 */
import { getDB, IndexedDBAdapter } from '../idb'

// Singleton: do NOT create additional IndexedDBAdapter instances.
// Multiple instances cause in-memory state divergence (caches, locks).
export const adapter = new IndexedDBAdapter()

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export const ok = (data: Record<string, unknown> = {}): Response => json({ ok: true, ...data })

export const notFound = (what: string): Response => json({ error: `${what} not found` }, 404)

export function idParam(params: Record<string, string>, key = 'p1'): number {
  return parseInt(params[key], 10)
}

// ── Date / amount helpers ─────────────────────────────────────────────────────

export function getAmount(t: Record<string, unknown>): number {
  return (t.amount_local as number) ?? (t.amount as number) ?? 0
}

export function monthStart(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function monthEnd(y: number, m: number): string {
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

export function nextMonth(y: number, m: number): { year: number; month: number } {
  if (m === 12) return { year: y + 1, month: 1 }
  return { year: y, month: m + 1 }
}

export function prevMonth(y: number, m: number): { year: number; month: number } {
  if (m === 1) return { year: y - 1, month: 12 }
  return { year: y, month: m - 1 }
}

export function endOfNextMonth(startDate: string): string {
  const d = new Date(startDate)
  const origDay = d.getDate()
  const targetMonth = d.getMonth() + 1
  d.setMonth(targetMonth, 1)
  // If adding one month overflowed the day (e.g. Jan 31 -> Mar 3), clamp to last
  // valid day of the target month. Otherwise use the original day.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(origDay, lastDay))
  return d.toISOString().slice(0, 10)
}

// ── Shared data helpers ───────────────────────────────────────────────────────

/** Fetch all records from a store across current profile IDs */
export async function getAllForProfiles(storeName: string): Promise<Record<string, unknown>[]> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const all: Record<string, unknown>[] = []
  for (const pid of pids) {
    const rows = await db.getAllFromIndex(storeName, 'by_profile', pid)
    all.push(...rows)
  }
  return all
}

/** Build a category ID → category lookup map for the current profile */
export async function buildCategoryMap(): Promise<Map<number, Record<string, unknown>>> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
  return new Map((cats as Record<string, unknown>[]).map((c) => [c.id as number, c]))
}

/** Best-effort MIME type from a filename extension */
export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    pdf: 'application/pdf',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }
  return ext && mimeMap[ext] ? mimeMap[ext] : 'application/octet-stream'
}
