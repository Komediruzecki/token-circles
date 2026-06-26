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

// Fetch current prices for a list of tickers. Port of
// backend/routes/portfolio.js POST /api/portfolio/prices, which calls
// yahooFinanceService.fetchQuotes (yahoo-finance2 .quote()).
//
// NOTE: yahoo-finance2's .quote() hits Yahoo's public quote endpoint
// (https://query1.finance.yahoo.com/v7/finance/quote?symbols=...). We replicate
// that here with fetch(). The upstream JSON shape is
//   { quoteResponse: { result: [ { symbol, regularMarketPrice, ... } ], error } }
// and each result object uses the same field names the Express route read
// (regularMarketPrice / regularMarketChange / regularMarketChangePercent /
// regularMarketDayHigh / regularMarketDayLow / shortName / longName). The v7
// endpoint may require a crumb/cookie in some regions and can rate-limit; on any
// failure we fall back to an empty quote list (matching fetchQuotes' catch -> []),
// so the response is {} rather than an error. The v6 host is tried as a fallback.
async function fetchYahooQuotes(symbols: string[]): Promise<any[]> {
  if (!symbols || symbols.length === 0) return []
  const qs = encodeURIComponent(symbols.join(','))
  const urls = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qs}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${qs}`,
  ]
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          // Yahoo rejects requests without a browser-like UA.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'application/json',
        },
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      const result = data?.quoteResponse?.result
      if (Array.isArray(result)) return result
    } catch (err) {
      // Try the next host, else fall through to [].
    }
  }
  return []
}

portfolioRoutes.post('/api/portfolio/prices', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>
  const tickers: any[] | undefined = b.tickers
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    throw new HttpError(400, 'tickers array is required')
  }

  const quotes = await fetchYahooQuotes(tickers.map((t) => String(t).toUpperCase()))

  const prices: Record<string, any> = {}
  for (const q of quotes) {
    if (q && q.symbol && q.regularMarketPrice) {
      prices[q.symbol] = {
        price: q.regularMarketPrice,
        change: q.regularMarketChange || 0,
        changePercent: q.regularMarketChangePercent || 0,
        dayHigh: q.regularMarketDayHigh,
        dayLow: q.regularMarketDayLow,
        name: q.shortName || q.longName || q.symbol,
      }
    }
  }

  return c.json(prices)
})
