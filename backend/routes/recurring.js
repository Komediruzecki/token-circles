const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId } = require('../middleware/profile');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/recurring', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const rows = db
        .prepare(
          `
        SELECT r.*, c.name as category_name, c.color as category_color, c.type as category_type
        FROM recurring_transactions r
        LEFT JOIN categories c ON r.category_id = c.id
        WHERE r.profile_id = ? AND r.active = 1
        ORDER BY r.next_date ASC
      `
        )
        .all(pid);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/recurring', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { description, amount, type, category_id, frequency, day_of_month, next_date, notes } =
        req.body;
      const info = req.repos.recurring.create({
        profile_id: pid,
        description: description || '',
        amount,
        type: type || 'expense',
        category_id: category_id || null,
        frequency: frequency || 'monthly',
        day_of_month: day_of_month || null,
        next_date: next_date || null,
        notes: notes || '',
      });
      res.json({ id: info.lastInsertRowid });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // IMPORTANT: /upcoming must come before /:id to avoid :id capturing "upcoming"
  router.get('/api/recurring/upcoming', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const now = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const recurring = db
        .prepare(
          `
        SELECT r.id, r.description, r.amount, r.type, r.frequency, r.day_of_month, r.next_date,
               c.name as category_name, c.color as category_color
        FROM recurring_transactions r
        LEFT JOIN categories c ON r.category_id = c.id
        WHERE r.profile_id = ? AND r.active = 1
      `
        )
        .all(pid);

      const upcoming = [];
      for (const r of recurring) {
        let cursor = new Date(r.next_date || now.toISOString().split('T')[0]);
        if (cursor < now) {
          cursor = new Date(now.toISOString().split('T')[0]);
        }
        const maxDate = new Date(endDate.toISOString().split('T')[0]);

        while (cursor <= maxDate) {
          upcoming.push({
            id: r.id,
            description: r.description,
            amount: r.amount,
            type: r.type,
            frequency: r.frequency,
            day_of_month: r.day_of_month,
            next_date: cursor.toISOString().split('T')[0],
            category_name: r.category_name,
            category_color: r.category_color,
          });

          if (r.frequency === 'daily') {
            cursor.setDate(cursor.getDate() + 1);
          } else if (r.frequency === 'weekly') {
            cursor.setDate(cursor.getDate() + 7);
          } else if (r.frequency === 'monthly') {
            cursor.setMonth(cursor.getMonth() + 1);
            const day = r.day_of_month || cursor.getDate();
            cursor.setDate(
              Math.min(day, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate())
            );
          } else if (r.frequency === 'yearly') {
            cursor.setFullYear(cursor.getFullYear() + 1);
          } else {
            break;
          }
        }
      }

      upcoming.sort((a, b) => a.next_date.localeCompare(b.next_date));

      const byCategory = {};
      let totalMonthly = 0;
      for (const item of upcoming) {
        const catKey = item.category_name || 'Uncategorized';
        if (!byCategory[catKey]) {
          byCategory[catKey] = { name: catKey, color: item.category_color, total: 0, items: [] };
        }
        byCategory[catKey].total += item.amount;
        byCategory[catKey].items.push(item);
        totalMonthly += item.amount;
      }

      const currencyRow = db
        .prepare("SELECT value FROM settings WHERE key = 'local_currency' AND profile_id = ?")
        .get(pid);
      const currency = currencyRow ? currencyRow.value : 'EUR';

      res.json({
        transactions: upcoming.slice(0, 20),
        byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
        totalMonthly,
        currency,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/recurring/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const r = req.repos.recurring.getById(req.params.id, pid);
      if (!r) return res.status(404).json({ error: 'Not found' });
      res.json(toCamelCase(r));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/recurring/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const existing = req.repos.recurring.getById(req.params.id, pid);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const {
        description,
        amount,
        type,
        category_id,
        frequency,
        day_of_month,
        next_date,
        notes,
        active,
      } = req.body;
      req.repos.recurring.update(req.params.id, pid, {
        description: description ?? '',
        amount: amount ?? 0,
        type: type ?? 'expense',
        category_id: category_id ?? null,
        frequency: frequency ?? 'monthly',
        day_of_month: day_of_month ?? null,
        next_date: next_date ?? null,
        notes: notes ?? '',
        active: active ?? 1,
      });
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/recurring/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      req.repos.recurring.deleteById(req.params.id, pid);
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/recurring/:id/populate', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const result = req.repos.recurring.populate(req.params.id, pid);
      if (!result) return res.status(404).json({ error: 'Not found' });

      const date = result.next_date || new Date().toISOString().split('T')[0];
      let next = new Date(date);
      if (result.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
      else if (result.frequency === 'weekly') next.setDate(next.getDate() + 7);
      else if (result.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
      const nextStr = next.toISOString().split('T')[0];
      req.repos.recurring.update(req.params.id, pid, { next_date: nextStr });

      res.json({
        ok: true,
        transactionId: result.transactionId,
        next_date: nextStr,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
