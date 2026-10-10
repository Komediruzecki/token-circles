/**
 * Portfolio handlers — IndexedDB-backed implementations
 *
 * A holding's body is checked by shared/holdingSchema.ts, as the Worker checks it.
 */
import { checkHoldingCreate, checkHoldingEdit } from '../../../../../shared/holdingSchema'
import { getDB } from '../idb'
import { adapter, currentProfileRecord, idParam, json, notFound, refuse } from './helpers'

export async function portfolioHoldingsList(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const holdings: Record<string, unknown>[] = []
    for (const pid of pids) {
      holdings.push(...(await db.getAllFromIndex('portfolioHoldings', 'by_profile', pid)))
    }
    // Latest purchase first, as the Worker lists them and the Portfolio page shows them.
    const bought = (h: Record<string, unknown>) =>
      typeof h.purchase_date === 'string' ? h.purchase_date : ''
    holdings.sort((a, b) => bought(b).localeCompare(bought(a)))
    const result = holdings.map((h: any) => ({
      ...h,
      currentPrice: h.purchase_price,
      marketValue: h.purchase_price * h.shares,
      costBasis: h.purchase_price * h.shares,
      gain: 0,
      gainPercent: 0,
    }))
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioHoldingsCreate(body: unknown): Promise<Response> {
  try {
    const checked = checkHoldingCreate(body)
    if (!checked.ok) return refuse(checked.fields)
    const db = await getDB()
    const holding = {
      ...checked.value,
      created_at: new Date().toISOString(),
      profile_id: await adapter.getCurrentProfileId(),
    }
    const id = await db.add('portfolioHoldings', holding)
    return json({ ...holding, id }, 201)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioHoldingsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  try {
    const id = idParam(params)
    const db = await getDB()
    // The active profile's own holding only, as the Worker's `AND profile_id = ?`.
    const existing = await currentProfileRecord('portfolioHoldings', id)
    if (!existing) return notFound('Holding')
    // Only what the edit changes is checked and written (decision 2): a field left out stays.
    const checked = checkHoldingEdit(body, existing)
    if (!checked.ok) return refuse(checked.fields)
    if (Object.keys(checked.value).length === 0) return json(existing)
    const updated = { ...existing, ...checked.value, updated_at: new Date().toISOString() }
    await db.put('portfolioHoldings', updated)
    return json(updated)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioHoldingsDelete(params: Record<string, string>): Promise<Response> {
  try {
    const id = idParam(params)
    const db = await getDB()
    if (!(await currentProfileRecord('portfolioHoldings', id))) return notFound('Holding')
    await db.delete('portfolioHoldings', id)
    return json({ ok: true })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioSummary(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const holdings: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('portfolioHoldings', 'by_profile', pid)
      holdings.push(...rows)
    }
    let totalValue = 0
    let totalCostBasis = 0
    const enriched = holdings.map((h: any) => {
      const currentPrice = h.purchase_price
      const marketValue = currentPrice * h.shares
      const costBasis = h.purchase_price * h.shares
      const gain = marketValue - costBasis
      const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0
      totalValue += marketValue
      totalCostBasis += costBasis
      return { ...h, currentPrice, marketValue, costBasis, gain, gainPercent }
    })
    const allocationMap: Record<string, { ticker: string; value: number; shares: number }> = {}
    for (const h of enriched) {
      if (!allocationMap[h.ticker]) {
        allocationMap[h.ticker] = { ticker: h.ticker, value: 0, shares: 0 }
      }
      allocationMap[h.ticker].value += h.marketValue
      allocationMap[h.ticker].shares += h.shares
    }
    const allocation = Object.values(allocationMap)
      .map((a) => ({ ...a, percentage: totalValue > 0 ? (a.value / totalValue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)

    const totalGain = totalValue - totalCostBasis
    const totalGainPercent = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0

    return json({
      totalValue,
      totalCostBasis,
      totalGain,
      totalGainPercent,
      holdings: enriched,
      allocation,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioPrices(body: unknown): Promise<Response> {
  try {
    const data = body as Record<string, unknown>
    const tickers = data.tickers as string[]
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return json({ error: 'tickers array is required' }, 400)
    }
    // Serverless/demo mode can't reach an external quote API from the browser (CORS),
    // so return no live prices. The UI then keeps showing purchase price (no fake 0s).
    return json({})
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
