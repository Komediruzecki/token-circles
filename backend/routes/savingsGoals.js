const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter , requireAuth }) {
  const router = express.Router();

  router.get('/api/savings-goals', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const rows = req.repos.goals.listByProfiles(pids);
    res.json(rows);

  }));

  router.post('/api/savings-goals', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes, category_id } = req.body;
    if (!name || target_amount == null) {
      return res.status(400).json({ error: 'Name and target amount are required' });
    }
    const info = req.repos.goals.create({
      profile_id: pid,
      name,
      target_amount,
      current_amount: current_amount || 0,
      deadline: deadline || null,
      notes: notes || '',
      category_id: category_id || null,
    });
    res.json({
      id: info.lastInsertRowid,
      name,
      target_amount,
      current_amount: current_amount || 0,
      deadline,
      notes,
      category_id: category_id || null,
      profile_id: pid,
    });

  }));

  router.put('/api/savings-goals/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes, category_id } = req.body;
    const result = req.repos.goals.update(req.params.id, pid, {
      name,
      target_amount,
      current_amount,
      deadline: deadline || null,
      notes: notes || '',
      category_id: category_id !== undefined ? category_id : null,
    });
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/savings-goals/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const result = req.repos.goals.deleteById(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  // Contribute an amount to a savings goal
  router.post('/api/savings-goals/:id/contribute', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const goalId = req.params.id;
    const goal = req.repos.goals.getById(goalId, pid);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    const { amount } = req.body;
    const contribution = parseFloat(amount) || 0;
    const newAmount = (goal.current_amount || 0) + contribution;
    req.repos.goals.updateAmount(goalId, pid, newAmount);
    res.json({ ok: true, current_amount: newAmount });

  }));

  return router;
};
