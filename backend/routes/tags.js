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

module.exports = function ({ apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/tags', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const rows = req.repos.tags.list(pid);
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
        const count = req.repos.tags.list(pid).length;
        tagColor = TAG_COLORS[count % TAG_COLORS.length];
      }
      const info = req.repos.tags.create({ name: name.trim(), color: tagColor, profile_id: pid });
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

  router.get('/api/tags/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const tag = req.repos.tags.getById(req.params.id, pid);
      if (!tag) return res.status(404).json({ error: 'Tag not found' });
      res.json(tag);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
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
      const result = req.repos.tags.update(req.params.id, pid, {
        name: name.trim(),
        color: color || '#6b7280',
      });
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
      const result = req.repos.tags.deleteById(req.params.id, pid);
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
      const tx = req.repos.transactions.getById(req.params.id, pid);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      req.repos.tags.setTransactionTags(req.params.id, tagIds);
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
      const tx = req.repos.transactions.getById(req.params.id, pid);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      req.repos.tags.setTransactionTags(req.params.id, tagIds);
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
      const tx = req.repos.transactions.getById(req.params.id, pid);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      const tags = req.repos.tags.getTagsForTransaction(req.params.id, pid);
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

      const rows = req.repos.tags.getTransactionsByTag(req.params.tagId, pid, {
        startDate,
        endDate,
        category_ids,
        type,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });
      res.json({ rows, total: rows.length });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
