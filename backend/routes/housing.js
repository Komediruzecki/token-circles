const express = require('express');
const { getProfileId } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/housing', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);

    // Custom ordering by due_date ASC (repo defaults to created_at DESC)
    const housings = req.repos.housing.all(
      `SELECT id, name, type, monthly_amount, due_date, autopay, notes, created_at
       FROM housings WHERE profile_id = ? ORDER BY due_date ASC`,
      pid
    );

    const totalMonthly = housings.reduce(
      (sum, h) => sum + Math.abs(parseFloat(h.monthly_amount) || 0),
      0
    );

    res.json({
      housings: housings.map((h) => ({ ...h, profile_id: pid })),
      total_monthly: Math.round(totalMonthly),
    });

  }));

  router.post('/api/housing', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { type, property_name, monthly_amount, due_day, due_month, autopay, notes } = req.body;

    const amount = parseFloat(monthly_amount);
    if (!property_name || isNaN(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ error: 'Property name and a valid monthly amount are required' });
    }

    const due_date = `${(due_month || 1).toString().padStart(2, '0')}-${(due_day || 1).toString().padStart(2, '0')}`;

    const info = req.repos.housing.create({
      profile_id: pid,
      name: property_name,
      type: type || 'other',
      monthly_amount: amount,
      due_date,
      autopay: autopay ? 1 : 0,
      notes: notes || '',
    });

    res.json({ id: info.lastInsertRowid });

  }));

  router.put('/api/housing/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { property_name, monthly_amount, due_day, due_month, autopay, notes } = req.body;

    const existing = req.repos.housing.getById(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const due_date = `${due_month.toString().padStart(2, '0')}-${due_day.toString().padStart(2, '0')}`;

    req.repos.housing.update(req.params.id, pid, {
      name: property_name,
      monthly_amount: parseFloat(monthly_amount),
      due_date,
      autopay: autopay ? 1 : 0,
      notes: notes || '',
    });

    res.json({ success: true });

  }));

  router.delete('/api/housing/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const existing = req.repos.housing.getById(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    req.repos.housing.deleteById(req.params.id, pid);
    res.json({ success: true });

  }));

  return router;
};
