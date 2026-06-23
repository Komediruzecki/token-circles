const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/savings-goals', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM savings_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`
      )
      .all(...pids);
    res.json(rows);

  }));

  router.post('/api/savings-goals', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes, category_id } = req.body;
    if (!name || target_amount == null) {
      return res.status(400).json({ error: 'Name and target amount are required' });
    }
    const info = db
      .prepare(
        'INSERT INTO savings_goals (profile_id, name, target_amount, current_amount, deadline, notes, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        pid,
        name,
        target_amount,
        current_amount || 0,
        deadline || null,
        notes || '',
        category_id || null
      );
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
    const result = db
      .prepare(
        'UPDATE savings_goals SET name=?, target_amount=?, current_amount=?, deadline=?, notes=?, category_id=? WHERE id=? AND profile_id=?'
      )
      .run(
        name,
        target_amount,
        current_amount,
        deadline || null,
        notes || '',
        category_id !== undefined ? category_id : null,
        req.params.id,
        pid
      );
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/savings-goals/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM savings_goals WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  // Contribute an amount to a savings goal
  router.post('/api/savings-goals/:id/contribute', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const goalId = req.params.id;
    const goal = db
      .prepare('SELECT * FROM savings_goals WHERE id=? AND profile_id=?')
      .get(goalId, pid);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    const { amount } = req.body;
    const contribution = parseFloat(amount) || 0;
    const newAmount = (goal.current_amount || 0) + contribution;
    db.prepare('UPDATE savings_goals SET current_amount=? WHERE id=? AND profile_id=?').run(
      newAmount,
      goalId,
      pid
    );
    res.json({ ok: true, current_amount: newAmount });

  }));

  return router;
};
