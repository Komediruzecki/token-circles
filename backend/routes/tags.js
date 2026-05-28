const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId } = require('../middleware/profile');

// Tag color palette for auto-assignment
const TAG_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
  '#a855f7',
];

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/tags', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const rows = db
        .prepare('SELECT id, name, color, created_at FROM tags WHERE profile_id = ? ORDER BY name')
        .all(pid);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/tags', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { name, color } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Tag name is required' });
      }
      let tagColor = color;
      if (!tagColor) {
        // Cycle through palette based on existing tag count
        const count = db.prepare('SELECT COUNT(*) as c FROM tags WHERE profile_id = ?').get(pid).c;
        tagColor = TAG_COLORS[count % TAG_COLORS.length];
      }
      const info = db
        .prepare('INSERT INTO tags (name, color, profile_id) VALUES (?, ?, ?)')
        .run(name.trim(), tagColor, pid);
      res.json({ id: info.lastInsertRowid, name: name.trim(), color: tagColor });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ error: 'Tag already exists' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/tags/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { name, color } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Tag name is required' });
      }
      const result = db
        .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND profile_id = ?')
        .run(name.trim(), color || '#6b7280', req.params.id, pid);
      if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ error: 'Tag name already exists' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/tags/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const result = db
        .prepare('DELETE FROM tags WHERE id = ? AND profile_id = ?')
        .run(req.params.id, pid);
      if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add tags to a transaction (replaces existing)
  router.post('/api/transactions/:id/tags', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { tagIds } = req.body;
      if (!Array.isArray(tagIds)) {
        return res.status(400).json({ error: 'tagIds must be an array' });
      }
      // Verify transaction belongs to profile
      const tx = db
        .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
        .get(req.params.id, pid);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      // Replace existing tags with new ones
      db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(req.params.id);
      const insertStmt = db.prepare(
        'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)'
      );
      for (const tagId of tagIds) {
        insertStmt.run(req.params.id, tagId);
      }
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Update tags for a transaction (alias for POST — replaces existing)
  router.put('/api/transactions/:id/tags', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { tagIds } = req.body;
      if (!Array.isArray(tagIds)) {
        return res.status(400).json({ error: 'tagIds must be an array' });
      }
      // Verify transaction belongs to profile
      const tx = db
        .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
        .get(req.params.id, pid);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(req.params.id);
      const insertStmt = db.prepare(
        'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)'
      );
      for (const tagId of tagIds) {
        insertStmt.run(req.params.id, tagId);
      }
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get tags for a transaction
  router.get('/api/transactions/:id/tags', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      // Verify transaction belongs to profile
      const tx = db
        .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
        .get(req.params.id, pid);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      const tags = db
        .prepare(
          `
          SELECT t.id, t.name, t.color
          FROM tags t
          JOIN transaction_tags tt ON t.id = tt.tag_id
          WHERE tt.transaction_id = ? AND t.profile_id = ?
          ORDER BY t.name
        `
        )
        .all(req.params.id, pid);
      res.json(tags);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Search transactions by tag
  router.get('/api/transactions/by-tag/:tagId', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { startDate, endDate, category_ids, type, limit, offset } = req.query;

      let sql = `
        SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
        JOIN transaction_tags tt ON t.id = tt.transaction_id
        WHERE t.profile_id = ? AND tt.tag_id = ?
      `;
      const params = [pid, req.params.tagId];

      if (startDate) {
        sql += ' AND t.date >= ?';
        params.push(startDate);
      }
      if (endDate) {
        sql += ' AND t.date <= ?';
        params.push(endDate);
      }
      if (category_ids) {
        const ids = category_ids
          .split(',')
          .map((id) => parseInt(id))
          .filter((id) => !isNaN(id));
        if (ids.length > 0) {
          sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      }
      if (type) {
        sql += ' AND t.type = ?';
        params.push(type);
      }

      sql += ' ORDER BY t.date DESC, t.id DESC';
      if (limit) sql += ` LIMIT ${parseInt(limit)}`;
      if (offset) sql += ` OFFSET ${parseInt(offset)}`;

      const rows = db.prepare(sql).all(...params);
      res.json({ rows, total: rows.length });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
