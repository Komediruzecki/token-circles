/**
 * Portfolio handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound } from './helpers'

export async function portfolioHoldingsList(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const holdings: Record<string, unknown>[] = []
    for (const pid of pids) {
      holdings.push(...(await db.getAllFromIndex('portfolioHoldings', 'by_profile', pid)))
    }
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
    if (typeof body !== 'object' || body === null) {
      return json({ error: 'Invalid request body' }, 400)
    }
    const data = body as Record<string, unknown>
    const tickerVal = data.ticker
    const sharesVal = data.shares
    const priceVal = data.purchase_price
    const dateVal = data.purchase_date
    const notesVal = data.notes
    if (typeof tickerVal !== 'string' && typeof tickerVal !== 'number') {
      return json({ error: 'ticker is required' }, 400)
    }
    if (typeof sharesVal !== 'number' && typeof sharesVal !== 'string') {
      return json({ error: 'shares is required' }, 400)
    }
    if (typeof priceVal !== 'number' && typeof priceVal !== 'string') {
      return json({ error: 'purchase_price is required' }, 400)
    }
    if (typeof dateVal !== 'string') {
      return json({ error: 'purchase_date is required' }, 400)
    }
    const db = await getDB()
    const holding = {
      ticker: String(tickerVal).toUpperCase(),
      shares: parseFloat(String(sharesVal)),
      purchase_price: parseFloat(String(priceVal)),
      purchase_date: dateVal,
      notes: typeof notesVal === 'string' ? notesVal : '',
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
    const data = body as Record<string, unknown>
    const db = await getDB()
    const existing = await db.get('portfolioHoldings', id)
    if (!existing) return notFound('Holding')
    const updTicker = typeof data.ticker === 'string' ? data.ticker.toUpperCase() : existing.ticker
    const updShares =
      typeof data.shares === 'number' || typeof data.shares === 'string'
        ? parseFloat(String(data.shares))
        : existing.shares
    const updPrice =
      typeof data.purchase_price === 'number' || typeof data.purchase_price === 'string'
        ? parseFloat(String(data.purchase_price))
        : existing.purchase_price
    const updDate =
      typeof data.purchase_date === 'string' ? data.purchase_date : existing.purchase_date
    const updNotes = typeof data.notes === 'string' ? data.notes : existing.notes
    const updated = {
      ...existing,
      ticker: updTicker,
      shares: updShares,
      purchase_price: updPrice,
      purchase_date: updDate,
      notes: updNotes,
      updated_at: new Date().toISOString(),
    }
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
    const existing = await db.get('portfolioHoldings', id)
    if (!existing) return notFound('Holding')
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
    const prices: Record<string, unknown> = {}
    for (const t of tickers) {
      prices[t] = { price: 0, change: 0, changePercent: 0, name: t }
    }
    return json(prices)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
