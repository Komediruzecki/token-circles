const express = require('express');

module.exports = function ({ db, apiRateLimiter }) {
  const router = express.Router();

  router.get('/api/storage-mode', (req, res) => {
    try {
      const rows = db.prepare('SELECT value FROM settings WHERE key = ?').all('storage_mode');
      const mode = rows.length > 0 ? rows[0].value : 'sqlite';
      res.json({ mode });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/storage-mode', apiRateLimiter, (req, res) => {
    try {
      const { mode } = req.body;
      db.prepare('INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, 0)').run(
        'storage_mode',
        mode
      );
      res.json({ ok: true, mode });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
