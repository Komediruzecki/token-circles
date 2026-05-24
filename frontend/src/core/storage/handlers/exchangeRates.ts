/**
 * Exchange Rates handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { json } from './helpers'

const EXCHANGE_RATES_CACHE_KEY = '__cache__exchange_rates'
const EXCHANGE_RATES_CACHE_TTL = 60 * 60 * 1000 // 1 hour

async function fetchExchangeRates(
  base: string
): Promise<{ rates: Record<string, number>; cached: boolean }> {
  const db = await getDB()
  try {
    const cached = await db.get('settings', EXCHANGE_RATES_CACHE_KEY)
    if (cached) {
      const data = JSON.parse(cached.value as string)
      if (data.base === base && Date.now() - data.ts < EXCHANGE_RATES_CACHE_TTL) {
        return { rates: data.rates, cached: true }
      }
    }
  } catch {
    /* not cached */
  }

  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (!data || !data.rates) throw new Error('Invalid response from exchange rate API')

  await db.put('settings', {
    key: EXCHANGE_RATES_CACHE_KEY,
    value: JSON.stringify({ ts: Date.now(), base, rates: data.rates }),
  })

  return { rates: data.rates as Record<string, number>, cached: false }
}

export async function exchangeRates(query: URLSearchParams): Promise<Response> {
  try {
    const base = query.get('base') || 'EUR'
    const symbols = query.get('symbols')
    const { rates, cached } = await fetchExchangeRates(base)
    let result = rates
    if (symbols) {
      const symbolList = symbols.split(',').map((s) => s.trim().toUpperCase())
      result = {}
      for (const sym of symbolList) {
        if (rates[sym] !== undefined) result[sym] = rates[sym]
      }
    }
    return json({ base, rates: result, cached })
  } catch (err) {
    return json({ error: (err as Error).message || 'Failed to fetch exchange rates' }, 502)
  }
}

export async function exchangeRateSingle(params: Record<string, string>): Promise<Response> {
  try {
    const base = params.p1?.toUpperCase() || 'EUR'
    const target = params.p2?.toUpperCase() || 'USD'
    const { rates } = await fetchExchangeRates(base)
    const rate = rates[target]
    if (rate === undefined) return json({ error: `Rate not found for ${target}` }, 404)
    return json({ base, target, rate })
  } catch (err) {
    return json({ error: (err as Error).message || 'Failed to fetch exchange rate' }, 502)
  }
}
