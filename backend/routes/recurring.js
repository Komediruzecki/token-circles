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
      const info = db
        .prepare(
          `INSERT INTO recurring_transactions (profile_id, description, amount, type, category_id, frequency, day_of_month, next_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          pid,
          description || '',
          amount,
          type || 'expense',
          category_id || null,
          frequency || 'monthly',
          day_of_month || null,
          next_date || null,
          notes || ''
        );
      res.json({ id: info.lastInsertRowid });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/recurring/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const existing = db
        .prepare('SELECT id FROM recurring_transactions WHERE id = ? AND profile_id = ?')
        .get(req.params.id, pid);
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
      db.prepare(
        `UPDATE recurring_transactions SET description=?, amount=?, type=?, category_id=?, frequency=?, day_of_month=?, next_date=?, notes=?, active=? WHERE id=? AND profile_id=?`
      ).run(
        description ?? '',
        amount ?? 0,
        type ?? 'expense',
        category_id ?? null,
        frequency ?? 'monthly',
        day_of_month ?? null,
        next_date ?? null,
        notes ?? '',
        active ?? 1,
        req.params.id,
        pid
      );
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
      db.prepare('DELETE FROM recurring_transactions WHERE id = ? AND profile_id = ?').run(
        req.params.id,
        pid
      );
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
      const r = db
        .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?')
        .get(req.params.id, pid);
      if (!r) return res.status(404).json({ error: 'Not found' });
      const date = r.next_date || new Date().toISOString().split('T')[0];
      const info = db
        .prepare(
          `INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes, beneficiary, payor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(pid, r.description, r.amount, r.type, r.category_id, date, r.notes || '', '', '');

      // Advance next_date
      let next = new Date(date);
      if (r.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
      else if (r.frequency === 'weekly') next.setDate(next.getDate() + 7);
      else if (r.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
      const nextStr = next.toISOString().split('T')[0];
      db.prepare('UPDATE recurring_transactions SET next_date = ? WHERE id = ?').run(
        nextStr,
        req.params.id
      );

      res.json({
        ok: true,
        transactionId: info.lastInsertRowid,
        next_date: nextStr,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/recurring/upcoming', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const now = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      // Get all active recurring transactions
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

      // Expand each recurring transaction into its upcoming occurrences in the next 30 days
      const upcoming = [];
      for (const r of recurring) {
        let cursor = new Date(r.next_date || now.toISOString().split('T')[0]);
        if (cursor < now) {
          // Advance cursor to the next occurrence from today
          cursor = new Date(now.toISOString().split('T')[0]);
        }
        // Cap to the next 30 days
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

          // Advance cursor to next occurrence
          if (r.frequency === 'daily') {
            cursor.setDate(cursor.getDate() + 1);
          } else if (r.frequency === 'weekly') {
            cursor.setDate(cursor.getDate() + 7);
          } else if (r.frequency === 'monthly') {
            cursor.setMonth(cursor.getMonth() + 1);
            // Normalize day of month
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

      // Sort by next_date
      upcoming.sort((a, b) => a.next_date.localeCompare(b.next_date));

      // Group by category
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

      // Get currency from settings
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

  return router;
};
