const express = require('express');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter , requireAuth }) {
  const router = express.Router();

  router.get('/api/storage-mode', requireAuth, asyncHandler((req, res) => {
    const rows = req.repos.settings.getValue('storage_mode');
    const mode = rows.length > 0 ? rows[0].value : 'sqlite';
    res.json({ mode });

  }));

  router.post('/api/storage-mode', apiRateLimiter, asyncHandler((req, res) => {
    const { mode } = req.body;
    req.repos.settings.upsert('storage_mode', mode, 0);
    res.json({ ok: true, mode });

  }));

  return router;
};
