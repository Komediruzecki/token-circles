'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { toCamelCase } = require('../utils');

module.exports = function ({ db, apiRateLimiter, logError, yahooFinanceService }) {
  const router = express.Router();

  router.get('/api/portfolio/holdings', apiRateLimiter, async (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const holdings = db
        .prepare(
          `SELECT * FROM portfolio_holdings WHERE profile_id IN (${inClause}) ORDER BY purchase_date DESC`
        )
        .all(...pids);

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
          ...toCamelCase(h),
          currentPrice,
          marketValue,
          costBasis,
          gain,
          gainPercent,
        };
      });

      res.json(enriched);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get portfolio summary (totals, allocation)
  router.get('/api/portfolio/summary', apiRateLimiter, async (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const holdings = db
        .prepare(`SELECT * FROM portfolio_holdings WHERE profile_id IN (${inClause})`)
        .all(...pids);

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
          ...toCamelCase(h),
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
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new holding
  router.post('/api/portfolio/holdings', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { ticker, shares, purchase_price, purchase_date, notes } = req.body;

      if (!ticker || !shares || !purchase_price || !purchase_date) {
        return res
          .status(400)
          .json({ error: 'ticker, shares, purchase_price, and purchase_date are required' });
      }

      const result = db
        .prepare(
          `INSERT INTO portfolio_holdings (ticker, shares, purchase_price, purchase_date, notes, profile_id)
         VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(ticker).toUpperCase(),
          parseFloat(shares),
          parseFloat(purchase_price),
          purchase_date,
          notes || '',
          pid
        );

      const holding = db
        .prepare('SELECT * FROM portfolio_holdings WHERE id = ?')
        .get(result.lastInsertRowid);
      res.status(201).json(toCamelCase(holding));
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Update a holding
  router.put('/api/portfolio/holdings/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const holdingId = parseInt(req.params.id);
      const { ticker, shares, purchase_price, purchase_date, notes } = req.body;

      const existing = db
        .prepare('SELECT * FROM portfolio_holdings WHERE id = ? AND profile_id = ?')
        .get(holdingId, pid);
      if (!existing) {
        return res.status(404).json({ error: 'Holding not found' });
      }

      db.prepare(
        `UPDATE portfolio_holdings SET ticker = ?, shares = ?, purchase_price = ?, purchase_date = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ? AND profile_id = ?`
      ).run(
        String(ticker || existing.ticker).toUpperCase(),
        shares !== undefined ? parseFloat(shares) : existing.shares,
        purchase_price !== undefined ? parseFloat(purchase_price) : existing.purchase_price,
        purchase_date || existing.purchase_date,
        notes !== undefined ? notes : existing.notes,
        holdingId,
        pid
      );

      const holding = db.prepare('SELECT * FROM portfolio_holdings WHERE id = ?').get(holdingId);
      res.json(toCamelCase(holding));
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a holding
  router.delete('/api/portfolio/holdings/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const holdingId = parseInt(req.params.id);

      const existing = db
        .prepare('SELECT * FROM portfolio_holdings WHERE id = ? AND profile_id = ?')
        .get(holdingId, pid);
      if (!existing) {
        return res.status(404).json({ error: 'Holding not found' });
      }

      db.prepare('DELETE FROM portfolio_holdings WHERE id = ? AND profile_id = ?').run(
        holdingId,
        pid
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Fetch current prices for a list of tickers
  router.post('/api/portfolio/prices', apiRateLimiter, async (req, res) => {
    try {
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
    } catch (err) {
      console.error('Price fetch error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
