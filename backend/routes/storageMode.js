const express = require('express');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ db, apiRateLimiter }) {
  const router = express.Router();

  router.get('/api/storage-mode', asyncHandler((req, res) => {
    const rows = db.prepare('SELECT value FROM settings WHERE key = ?').all('storage_mode');
    const mode = rows.length > 0 ? rows[0].value : 'sqlite';
    res.json({ mode });

  }));

  router.post('/api/storage-mode', apiRateLimiter, asyncHandler((req, res) => {
    const { mode } = req.body;
    db.prepare('INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, 0)').run(
      'storage_mode',
      mode
    );
    res.json({ ok: true, mode });

  }));

  return router;
};
