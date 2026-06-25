const express = require('express');
const bcrypt = require('bcrypt');
const { toCamelCase } = require('../utils');
const { asyncHandler } = require('../lib/errors');

function validatePasswordComplexity(password) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a special character';
  return null;
}

module.exports = function ({ apiRateLimiter, authRateLimiter, requireAuth, logError }) {
  const router = express.Router();

  router.post('/api/auth/login', authRateLimiter, asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = req.repos.users.getByUsername(username);
    if (!user) {
      logError('warning', 'AUTH', 'Invalid login attempt - username not found', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logError('warning', 'AUTH', 'Invalid login attempt - wrong password', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Failed to regenerate session' });
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save(() => {
        res.json({ ok: true, username: user.username, isLoggedIn: true });
      });
    });
  }));

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

  router.post('/api/auth/change-password', apiRateLimiter, requireAuth, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const passwordError = validatePasswordComplexity(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const user = req.repos.users.getById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    req.repos.users.updatePassword(req.session.userId, hash);

    res.json({ ok: true, message: 'Password changed successfully' });
  }));

  return router;
};
