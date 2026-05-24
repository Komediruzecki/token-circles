/**
 * Counterparties handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, json } from './helpers'

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return ''
  return String(v)
}

export async function getCounterparties(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const txs: Record<string, unknown>[] = []
    for (const pid of pids) {
      txs.push(...(await db.getAllFromIndex('transactions', 'by_profile', pid)))
    }

    const map = new Map<string, { incoming: number; outgoing: number; count: number }>()

    for (const tx of txs) {
      const txAmount = typeof tx.amount === 'number' ? tx.amount : parseFloat(toStr(tx.amount)) || 0
      if (tx.type === 'expense') {
        const beneficiary = toStr(tx.beneficiary).trim() || toStr(tx.description).trim()
        if (beneficiary) {
          const existing = map.get(beneficiary)
          if (existing) {
            existing.outgoing += txAmount
            existing.count++
          } else {
            map.set(beneficiary, { incoming: 0, outgoing: txAmount, count: 1 })
          }
        }
      }
      if (tx.type === 'income') {
        const payor = toStr(tx.payor).trim() || toStr(tx.description).trim()
        if (payor) {
          const existing = map.get(payor)
          if (existing) {
            existing.incoming += txAmount
            existing.count++
          } else {
            map.set(payor, { incoming: txAmount, outgoing: 0, count: 1 })
          }
        }
      }
    }

    const result = Array.from(map.entries()).map(([name, data]) => ({
      name,
      incoming: Math.round(data.incoming * 100) / 100,
      outgoing: Math.round(data.outgoing * 100) / 100,
      net: Math.round((data.incoming - data.outgoing) * 100) / 100,
      transaction_count: data.count,
    }))

    result.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
