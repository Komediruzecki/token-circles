'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { toCamelCase } = require('../utils');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError, yahooFinanceService, requireAuth }) {
  const router = express.Router();

  router.get('/api/portfolio/holdings', apiRateLimiter, requireAuth, async (req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const holdings = req.repos.portfolio.all(
      `SELECT * FROM portfolio_holdings WHERE profile_id IN (${inClause}) ORDER BY purchase_date DESC`,
      ...pids
    );

    // Try to fetch current prices
    const tickers = [...new Set(holdings.map((h) => h.ticker))];
    const prices = await yahooFinanceService.fetchPrices(tickers);

    // Enrich holdings with current price and gain/loss
    const enriched = holdings.map((h) => {
      const currentPrice = prices[h.ticker] || h.purchase_price;
      const marketValue = currentPrice * h.shares;
      const costBasis = h.purchase_price * h.shares;
      const gain = marketValue - costBasis;
      const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0;
      return {
        ...h,
        currentPrice,
        marketValue,
        costBasis,
        gain,
        gainPercent,
      };
    });

    res.json(enriched);
  });

  // Get portfolio summary (totals, allocation)
  router.get('/api/portfolio/summary', apiRateLimiter, async (req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const holdings = req.repos.portfolio.all(
      `SELECT * FROM portfolio_holdings WHERE profile_id IN (${inClause})`,
      ...pids
    );

    if (holdings.length === 0) {
      return res.json({
        totalValue: 0,
        totalCostBasis: 0,
        totalGain: 0,
        totalGainPercent: 0,
        holdings: [],
        allocation: [],
      });
    }

    // Try to fetch current prices
    let prices = {};
    try {
      const tickers = [...new Set(holdings.map((h) => h.ticker))];
      prices = await yahooFinanceService.fetchPrices(tickers);
    } catch (priceErr) {
      console.warn('Failed to fetch live prices:', priceErr.message);
    }

    let totalValue = 0;
    let totalCostBasis = 0;

    const enrichedHoldings = holdings.map((h) => {
      const currentPrice = prices[h.ticker] || h.purchase_price;
      const marketValue = currentPrice * h.shares;
      const costBasis = h.purchase_price * h.shares;
      const gain = marketValue - costBasis;
      const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0;
      totalValue += marketValue;
      totalCostBasis += costBasis;
      return {
        ...h,
        currentPrice,
        marketValue,
        costBasis,
        gain,
        gainPercent,
      };
    });

    // Calculate allocation percentages
    const allocationMap = {};
    for (const h of enrichedHoldings) {
      const key = h.ticker;
      if (!allocationMap[key]) {
        allocationMap[key] = { ticker: h.ticker, value: 0, shares: 0 };
      }
      allocationMap[key].value += h.marketValue;
      allocationMap[key].shares += h.shares;
    }
    const allocation = Object.values(allocationMap)
      .map((a) => ({
        ...a,
        percentage: totalValue > 0 ? (a.value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    const totalGain = totalValue - totalCostBasis;
    const totalGainPercent = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0;

    res.json({
      totalValue,
      totalCostBasis,
      totalGain,
      totalGainPercent,
      holdings: enrichedHoldings,
      allocation,
    });
  });

  // Add a new holding
  router.post(
    '/api/portfolio/holdings',
    apiRateLimiter,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const { ticker, shares, purchase_price, purchase_date, notes } = req.body;

      if (!ticker || !shares || !purchase_price || !purchase_date) {
        return res
          .status(400)
          .json({ error: 'ticker, shares, purchase_price, and purchase_date are required' });
      }

      const result = req.repos.portfolio.create({
        ticker: String(ticker).toUpperCase(),
        shares: parseFloat(shares),
        purchase_price: parseFloat(purchase_price),
        purchase_date,
        notes: notes || '',
        profile_id: pid,
      });

      const holding = req.repos.portfolio.getById(result.lastInsertRowid, pid);
      res.status(201).json(holding);
    })
  );

  // Update a holding
  router.put(
    '/api/portfolio/holdings/:id',
    apiRateLimiter,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const holdingId = parseInt(req.params.id);
      const { ticker, shares, purchase_price, purchase_date, notes } = req.body;

      const existing = req.repos.portfolio.getById(holdingId, pid);
      if (!existing) {
        return res.status(404).json({ error: 'Holding not found' });
      }

      req.repos.portfolio.update(holdingId, pid, {
        ticker: String(ticker || existing.ticker).toUpperCase(),
        shares: shares !== undefined ? parseFloat(shares) : existing.shares,
        purchase_price:
          purchase_price !== undefined ? parseFloat(purchase_price) : existing.purchase_price,
        purchase_date: purchase_date || existing.purchase_date,
        notes: notes !== undefined ? notes : existing.notes,
        updated_at: new Date().toISOString(),
      });

      const holding = req.repos.portfolio.getById(holdingId, pid);
      res.json(holding);
    })
  );

  // Delete a holding
  router.delete(
    '/api/portfolio/holdings/:id',
    apiRateLimiter,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const holdingId = parseInt(req.params.id);

      const existing = req.repos.portfolio.getById(holdingId, pid);
      if (!existing) {
        return res.status(404).json({ error: 'Holding not found' });
      }

      req.repos.portfolio.deleteById(holdingId, pid);
      res.json({ ok: true });
    })
  );

  // Fetch current prices for a list of tickers
  router.post(
    '/api/portfolio/prices',
    apiRateLimiter,
    asyncHandler(async (req, res) => {
      const { tickers } = req.body;
      if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({ error: 'tickers array is required' });
      }

      const quotes = await yahooFinanceService.fetchQuotes(
        tickers.map((t) => String(t).toUpperCase())
      );

      const prices = {};
      for (const q of quotes) {
        if (q && q.symbol && q.regularMarketPrice) {
          prices[q.symbol] = {
            price: q.regularMarketPrice,
            change: q.regularMarketChange || 0,
            changePercent: q.regularMarketChangePercent || 0,
            dayHigh: q.regularMarketDayHigh,
            dayLow: q.regularMarketDayLow,
            name: q.shortName || q.longName || q.symbol,
          };
        }
      }

      res.json(prices);
    })
  );

  return router;
};
