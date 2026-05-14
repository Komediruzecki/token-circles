/**
 * Yahoo Finance Service — wraps yahoo-finance2 with lazy loading and error handling.
 */
let _yahooFinance = null

function getClient() {
  if (!_yahooFinance) {
    _yahooFinance = require('yahoo-finance2').default
  }
  return _yahooFinance
}

/**
 * Fetch current prices for an array of tickers.
 * Returns { [symbol]: price } map. Silently returns empty object on failure.
 */
async function fetchPrices(tickers) {
  if (!tickers || tickers.length === 0) return {}
  try {
    const quotes = await getClient().quote(tickers)
    const quoteList = Array.isArray(quotes) ? quotes : [quotes]
    const prices = {}
    for (const q of quoteList) {
      if (q && q.symbol && q.regularMarketPrice != null) {
        prices[q.symbol] = q.regularMarketPrice
      }
    }
    return prices
  } catch (err) {
    console.error('Failed to fetch live prices, using fallback:', err.message)
    return {}
  }
}

/**
 * Fetch full quotes for arbitrary tickers.
 * Returns the raw quote array, or empty array on failure.
 */
async function fetchQuotes(tickers) {
  if (!tickers || tickers.length === 0) return []
  try {
    const quotes = await getClient().quote(tickers)
    return Array.isArray(quotes) ? quotes : [quotes]
  } catch (err) {
    console.error('Failed to fetch quotes, using fallback:', err.message)
    return []
  }
}

module.exports = { fetchPrices, fetchQuotes }
