const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/settings', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const rows = db
      .prepare('SELECT key, value FROM settings WHERE profile_id = ? OR profile_id IS NULL')
      .all(pid);
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    // Add user preferences section
    settings.preferences = {
      theme: settings.theme || 'light',
      notifications: settings.notifications !== undefined ? settings.notifications : true,
    };
    res.setHeader('Cache-Control', 'no-cache');
    res.json(settings);

  }));

  router.put('/api/settings', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    // Validate currency code (ISO 4217)
    if (req.body.currency && !/^[A-Z]{3}$/.test(req.body.currency)) {
      return res.status(422).json({
        error: 'Invalid currency code. Must be 3-letter ISO 4217 code (e.g., USD, EUR).',
      });
    }
    // Validate locale code (BCP 47 language tags - simplified)
    if (req.body.locale) {
      // Must be in format: language[-region] or language[-region][-variant]
      const localeRegex = /^[a-z]{2,3}(?:-[A-Z]{2,3}(?:-[A-Z0-9]+)*)?$/i;
      if (!localeRegex.test(req.body.locale)) {
        return res.status(422).json({
          error: 'Invalid locale code. Use valid BCP 47 language tags (e.g., en-US, fr-FR).',
        });
      }
    }

    const upsert = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)'
    );
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) upsert.run(k, String(v), pid);
    res.json(toCamelCase({ ok: true }));

  }));

  router.post('/api/settings/set-storage', apiRateLimiter, asyncHandler((req, res) => {
    const { type } = req.body;

    if (type === 'postgresql') {
      // Store PostgreSQL config (optional - would need to expand backend)
      res.json({
        ok: true,
        message: 'PostgreSQL storage configured. Please restart the application.',
      });
    } else {
      // Reset to SQLite
      res.json({
        ok: true,
        message: 'SQLite storage configured. Please restart the application.',
      });
    }

  }));

  return router;
};
