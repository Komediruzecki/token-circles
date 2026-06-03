const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId } = require('../middleware/profile');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  function updateProfileHandler(req, res) {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const pid = parseInt(req.params.id);
      const { name } = req.body;
      const profile = req.repos.profiles.getById(pid);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      if (profile.user_id !== req.session.userId) {
        return res.status(403).json({ error: "Cannot modify another user's profile" });
      }
      if (name !== undefined) {
        if (!name.trim()) return res.status(400).json({ error: 'Name is required' });
        req.repos.profiles.updateName(pid, name.trim());
      }
      const updated = req.repos.profiles.getById(pid);
      res.json(updated);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  }

  router.get('/api/profiles', apiRateLimiter, (req, res) => {
    try {
      let profiles;
      if (req.session.userId) {
        profiles = req.repos.profiles.listByUserId(req.session.userId);
        if (profiles.length === 0) {
          req.repos.profiles.create('Default', req.session.userId);
          profiles = req.repos.profiles.listByUserId(req.session.userId);
        }
      } else {
        profiles = req.repos.profiles.allByIds([1, 2, 3]);
      }
      const txCounts = req.repos.transactions.countsByProfile('transactions');
      const acctCounts = req.repos.accounts.countsByProfile('accounts');
      const budgetCounts = req.repos.budgets.countsByProfile('budgets');
      const result = profiles.map((p) => ({
        ...p,
        transaction_count: txCounts[p.id] || 0,
        account_count: acctCounts[p.id] || 0,
        budget_count: budgetCounts[p.id] || 0,
      }));
      res.json(result);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/profiles', apiRateLimiter, (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
      const existing = req.repos.profiles.getByName(name.trim());
      if (existing)
        return res.status(400).json({ error: 'A profile with this name already exists' });
      const id = req.repos.profiles.create(name.trim(), req.session.userId);
      res.json({ id, name: name.trim(), transaction_count: 0, account_count: 0, budget_count: 0 });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/profiles/:id', apiRateLimiter, updateProfileHandler);
  router.patch('/api/profiles/:id', apiRateLimiter, updateProfileHandler);

  router.delete('/api/profiles/:id', apiRateLimiter, (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const pid = parseInt(req.params.id);
      if (pid === 1) return res.status(400).json({ error: 'Cannot delete the default profile' });
      const profile = req.repos.profiles.getById(pid);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      if (profile.user_id !== req.session.userId) {
        return res.status(403).json({ error: "Cannot delete another user's profile" });
      }
      if (req.repos.profiles.profileCount() <= 1)
        return res.status(400).json({ error: 'Cannot delete the last profile' });
      req.repos.profiles.deleteAllDataForProfile(pid);
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/profiles/reseed-demo', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      req.repos.transactions.deleteAll(pid);
      req.repos.budgets.deleteAll(pid);
      req.repos.loans.deleteAll(pid);
      req.repos.categories.deleteAll(pid);
      req.repos.accounts.deleteAll(pid);
      req.repos.goals.deleteAll(pid);
      db.seedThreeTierProfiles();
      res.json({ ok: true, message: 'Demo data has been restored' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/profile/data', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      req.repos.transactions.deleteAll(pid);
      req.repos.budgets.deleteAll(pid);
      req.repos.loans.deleteAll(pid);
      req.repos.categories.deleteAll(pid);
      req.repos.accounts.deleteAll(pid);
      req.repos.goals.deleteAll(pid);
      const defaults = [
        { name: 'Housing', color: '#ef4444', icon: 'home', type: 'expense', tax_deductible: 0 },
        {
          name: 'Food & Dining',
          color: '#f97316',
          icon: 'utensils',
          type: 'expense',
          tax_deductible: 0,
        },
        {
          name: 'Transportation',
          color: '#eab308',
          icon: 'car',
          type: 'expense',
          tax_deductible: 0,
        },
        { name: 'Healthcare', color: '#22c55e', icon: 'heart', type: 'expense', tax_deductible: 0 },
        {
          name: 'Entertainment',
          color: '#06b6d4',
          icon: 'film',
          type: 'expense',
          tax_deductible: 0,
        },
        {
          name: 'Shopping',
          color: '#8b5cf6',
          icon: 'shopping-bag',
          type: 'expense',
          tax_deductible: 0,
        },
        { name: 'Utilities', color: '#64748b', icon: 'zap', type: 'expense', tax_deductible: 0 },
        { name: 'Education', color: '#ec4899', icon: 'book', type: 'expense', tax_deductible: 0 },
        { name: 'Salary', color: '#22c55e', icon: 'briefcase', type: 'income', tax_deductible: 0 },
      ];
      req.repos.categories.seedDefaults(pid, defaults);
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/profiles/me/password', apiRateLimiter, (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      const bcrypt = require('bcrypt');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const valid = bcrypt.compareSync(currentPassword, user.password_hash);
      if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
      const hash = bcrypt.hashSync(newPassword, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
      res.json({ ok: true, message: 'Password changed successfully' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
