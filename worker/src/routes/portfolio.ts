import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/portfolio.js + backend/repositories/portfolioRepo.js.
// Holdings are profile-scoped. Live prices come from Yahoo Finance (external),
// which can't be reached here, so we use the same fallback the Express route
// already applies (currentPrice = purchase_price) and the enriched fields are
// computed in JS exactly as upstream. The enriched keys are camelCase because
// the Express route spreads computed JS fields onto the snake_case DB row.
export const portfolioRoutes = new Hono<AppEnv>()

interface Holding {
  ticker: string
  shares: number
  purchase_price: number
  [key: string]: any
}

function enrich(h: Holding) {
  // Fallback used by the Express route when live prices are unavailable.
  const currentPrice = h.purchase_price
  const marketValue = currentPrice * h.shares
  const costBasis = h.purchase_price * h.shares
  const gain = marketValue - costBasis
  const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0
  return { ...h, currentPrice, marketValue, costBasis, gain, gainPercent }
}

// Aggregating read across profiles -> getProfileIds.
portfolioRoutes.get('/api/portfolio/holdings', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const holdings = await db.all<Holding>(
    c.env.DB,
    `SELECT * FROM portfolio_holdings WHERE profile_id IN (${inClause}) ORDER BY purchase_date DESC`,
    ...pids
  )
  return c.json(holdings.map(enrich))
})

portfolioRoutes.get('/api/portfolio/summary', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const holdings = await db.all<Holding>(
    c.env.DB,
    `SELECT * FROM portfolio_holdings WHERE profile_id IN (${inClause})`,
    ...pids
  )

  if (holdings.length === 0) {
    return c.json({
      totalValue: 0,
      totalCostBasis: 0,
      totalGain: 0,
      totalGainPercent: 0,
      holdings: [],
      allocation: [],
    })
  }

  let totalValue = 0
  let totalCostBasis = 0
  const enrichedHoldings = holdings.map((h) => {
    const e = enrich(h)
    totalValue += e.marketValue
    totalCostBasis += e.costBasis
    return e
  })

  const allocationMap: Record<string, { ticker: string; value: number; shares: number }> = {}
  for (const h of enrichedHoldings) {
    const key = h.ticker
    if (!allocationMap[key]) allocationMap[key] = { ticker: h.ticker, value: 0, shares: 0 }
    allocationMap[key].value += h.marketValue
    allocationMap[key].shares += h.shares
  }
  const allocation = Object.values(allocationMap)
    .map((a) => ({ ...a, percentage: totalValue > 0 ? (a.value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)

  const totalGain = totalValue - totalCostBasis
  const totalGainPercent = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0

  return c.json({
    totalValue,
    totalCostBasis,
    totalGain,
    totalGainPercent,
    holdings: enrichedHoldings,
    allocation,
  })
})

portfolioRoutes.post('/api/portfolio/holdings', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  if (!b.ticker || !b.shares || !b.purchase_price || !b.purchase_date) {
    throw new HttpError(400, 'ticker, shares, purchase_price, and purchase_date are required')
  }
  const res = await db.insert(c.env.DB, 'portfolio_holdings', {
    ticker: String(b.ticker).toUpperCase(),
    shares: parseFloat(b.shares),
    purchase_price: parseFloat(b.purchase_price),
    purchase_date: b.purchase_date,
    notes: b.notes || '',
    profile_id: pid,
  })
  const holding = await db.first(
    c.env.DB,
    'SELECT * FROM portfolio_holdings WHERE id = ? AND profile_id = ?',
    res.meta.last_row_id,
    pid
  )
  return c.json(holding, 201)
})

portfolioRoutes.put('/api/portfolio/holdings/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const b = (await c.req.json()) as Record<string, any>
  const existing = await db.first<Holding>(
    c.env.DB,
    'SELECT * FROM portfolio_holdings WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!existing) throw new HttpError(404, 'Holding not found')
  await db.update(
    c.env.DB,
    'portfolio_holdings',
    {
      ticker: String(b.ticker || existing.ticker).toUpperCase(),
      shares: b.shares !== undefined ? parseFloat(b.shares) : existing.shares,
      purchase_price: b.purchase_price !== undefined ? parseFloat(b.purchase_price) : existing.purchase_price,
      purchase_date: b.purchase_date || existing.purchase_date,
      notes: b.notes !== undefined ? b.notes : existing.notes,
      updated_at: new Date().toISOString(),
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  )
  const holding = await db.first(
    c.env.DB,
    'SELECT * FROM portfolio_holdings WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  return c.json(holding)
})

portfolioRoutes.delete('/api/portfolio/holdings/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM portfolio_holdings WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!existing) throw new HttpError(404, 'Holding not found')
  await db.del(c.env.DB, 'portfolio_holdings', 'id = ? AND profile_id = ?', id, pid)
  return c.json({ ok: true })
})

// Live quote lookup hits Yahoo Finance (external) — not reachable here.
portfolioRoutes.post('/api/portfolio/prices', requireAuth, async (c) => {
  // TODO: port yahooFinanceService.fetchQuotes (external Yahoo Finance call)
  return c.json({ error: 'Not ported yet' }, 501)
})
