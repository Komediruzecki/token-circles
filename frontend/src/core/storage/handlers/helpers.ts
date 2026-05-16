/**
 * Shared helpers for local API handlers.
 */
import { IndexedDBAdapter } from '../idb'

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
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}
