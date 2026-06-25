const express = require('express');
const { getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/counterparties', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // Aggregate outgoing by beneficiary (we pay them = expense)
    const outgoing = req.repos.transactions.all(
      `
      SELECT beneficiary AS name, 'outgoing' AS direction, SUM(amount) AS total, COUNT(*) AS count
      FROM transactions
      WHERE beneficiary != '' AND type = 'expense'
        AND profile_id IN (${inClause})
      GROUP BY beneficiary
    `,
      ...pids
    );

    // Aggregate incoming by payor (they pay us = income)
    const incoming = req.repos.transactions.all(
      `
      SELECT payor AS name, 'incoming' AS direction, SUM(amount) AS total, COUNT(*) AS count
      FROM transactions
      WHERE payor != '' AND type = 'income'
        AND profile_id IN (${inClause})
      GROUP BY payor
    `,
      ...pids
    );

    // Merge by name to compute net
    const map = new Map();
    for (const row of outgoing) {
      const name = (row.name || '').trim();
      if (!name) continue;
      map.set(name, { name, incoming: 0, outgoing: row.total || 0, count: row.count || 0 });
    }
    for (const row of incoming) {
      const name = (row.name || '').trim();
      if (!name) continue;
      const existing = map.get(name);
      if (existing) {
        existing.incoming = row.total || 0;
        existing.count += row.count || 0;
      } else {
        map.set(name, { name, incoming: row.total || 0, outgoing: 0, count: row.count || 0 });
      }
    }

    const result = Array.from(map.values()).map((c) => ({
      name: c.name,
      incoming: Math.round(c.incoming * 100) / 100,
      outgoing: Math.round(c.outgoing * 100) / 100,
      net: Math.round((c.incoming - c.outgoing) * 100) / 100,
      transaction_count: c.count,
    }));

    // Sort by absolute net amount desc
    result.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    res.json(result);

  }));

  return router;
};
