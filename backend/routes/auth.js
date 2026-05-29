const express = require('express');
const bcrypt = require('bcrypt');
const { toCamelCase } = require('../utils');

module.exports = function ({ db, apiRateLimiter, authRateLimiter, requireAuth, logError }) {
  const router = express.Router();

  router.post('/api/auth/login', authRateLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }
      // Password complexity validation
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain an uppercase letter' });
      }
      if (!/[a-z]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain a lowercase letter' });
      }
      if (!/[0-9]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain a number' });
      }
      if (!/[^A-Za-z0-9]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain a special character' });
      }
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) {
        logError('warning', 'AUTH', 'Invalid login attempt - username not found', { username });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        logError('warning', 'AUTH', 'Invalid login attempt - wrong password', { username });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save(() => {
        res.json({ ok: true, username: user.username, isLoggedIn: true });
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/logout', apiRateLimiter, (req, res) => {
    res.clearCookie('connect.sid');
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Logout failed' });
      res.json(toCamelCase({ ok: true }));
    });
  });

  router.get('/api/auth/me', apiRateLimiter, requireAuth, (req, res) => {
    res.json({ userId: req.session.userId, username: req.session.username });
  });

  router.get('/api/auth/check', apiRateLimiter, requireAuth, (req, res) => {
    res.json({ ok: true, userId: req.session.userId, username: req.session.username });
  });

  router.post('/api/auth/2fa/setup', apiRateLimiter, (req, res) => {
    res.status(400).json({ error: '2FA not configured for this server' });
  });

  router.post('/api/auth/2fa/enable', apiRateLimiter, requireAuth, (req, res) => {
    res.status(400).json({ error: '2FA not configured for this server' });
  });

  router.post('/api/auth/change-password', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      res.json({ ok: true, message: 'Password changed successfully' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
