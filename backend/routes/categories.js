'use strict';
const express = require('express');
const { getCategoryIcon, toCamelCase } = require('../utils');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError, requireAuth }) {
  const router = express.Router();

  router.get(
    '/api/categories',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const { type, income, expense } = req.query;

      const types = [];
      if (type === 'income' || income === 'true') types.push('income');
      if (type === 'expense' || expense === 'true') types.push('expense');

      const rows = req.repos.categories.listFull(pid, types.length > 0 ? types : null);
      res.json(rows);
    })
  );

  router.post(
    '/api/categories',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const {
        name,
        color = '#6b7280',
        icon = 'tag',
        type = 'expense',
        parent_id: parentIdParam,
        tax_deductible,
      } = req.body;
      const parent_id = parentIdParam !== undefined ? parentIdParam : req.body.parentId || null;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Category name is required' });
      }

      const existing = req.repos.categories.getByName(name.trim(), pid);
      if (existing) {
        return res.status(400).json({ error: 'Category name already exists for this profile' });
      }

      const result = req.repos.categories.create({
        name: name.trim(),
        color: color.trim(),
        icon: icon || 'tag',
        type: type.trim(),
        parent_id,
        tax_deductible: tax_deductible ? 1 : 0,
        profile_id: pid,
      });

      res.json(
        toCamelCase({
          id: result.lastInsertRowid,
          name: name.trim(),
          color: color.trim(),
          icon: icon,
          type: type.trim(),
          parent_id,
          profile_id: pid,
        })
      );
    })
  );

  // ==================== CATEGORY MAPPINGS ====================

  // Built-in merchant dictionary (50+ common merchants)
  const MERCHANT_DICTIONARY = [
    // Streaming
    { pattern: 'netflix', category: 'Streaming', confidence: 0.95 },
    { pattern: 'spotify', category: 'Streaming', confidence: 0.95 },
    { pattern: 'youtube', category: 'Streaming', confidence: 0.9 },
    { pattern: 'disney+', category: 'Streaming', confidence: 0.95 },
    { pattern: 'hulu', category: 'Streaming', confidence: 0.95 },
    { pattern: 'apple tv', category: 'Streaming', confidence: 0.9 },
    { pattern: 'hbo', category: 'Streaming', confidence: 0.9 },
    { pattern: 'prime video', category: 'Streaming', confidence: 0.95 },
    // Shopping
    { pattern: 'amazon', category: 'Shopping', confidence: 0.9 },
    { pattern: 'ebay', category: 'Shopping', confidence: 0.95 },
    { pattern: 'walmart', category: 'Shopping', confidence: 0.95 },
    { pattern: 'target', category: 'Shopping', confidence: 0.95 },
    { pattern: 'costco', category: 'Shopping', confidence: 0.95 },
    { pattern: 'ikea', category: 'Shopping', confidence: 0.95 },
    { pattern: 'zara', category: 'Shopping', confidence: 0.95 },
    { pattern: 'h&m', category: 'Shopping', confidence: 0.95 },
    { pattern: 'macy', category: 'Shopping', confidence: 0.95 },
    // Food & Grocery
    { pattern: 'walmart grocery', category: 'Groceries', confidence: 0.95 },
    { pattern: 'costco', category: 'Groceries', confidence: 0.95 },
    { pattern: 'trader joe', category: 'Groceries', confidence: 0.95 },
    { pattern: 'whole foods', category: 'Groceries', confidence: 0.95 },
    { pattern: 'target grocery', category: 'Groceries', confidence: 0.95 },
    { pattern: 'kroger', category: 'Groceries', confidence: 0.9 },
    { pattern: 'safeway', category: 'Groceries', confidence: 0.9 },
    { pattern: 'albertsons', category: 'Groceries', confidence: 0.9 },
    { pattern: 'stop & shop', category: 'Groceries', confidence: 0.9 },
    { pattern: 'publix', category: 'Groceries', confidence: 0.9 },
    { pattern: 'whole foods market', category: 'Groceries', confidence: 0.95 },
    { pattern: 'sams club', category: 'Groceries', confidence: 0.9 },
    // Dining
    { pattern: 'starbucks', category: 'Dining', confidence: 0.95 },
    { pattern: 'mcdonalds', category: 'Dining', confidence: 0.95 },
    { pattern: 'burger king', category: 'Dining', confidence: 0.9 },
    { pattern: 'wendy', category: 'Dining', confidence: 0.9 },
    { pattern: 'taco bell', category: 'Dining', confidence: 0.9 },
    { pattern: 'pizza hut', category: 'Dining', confidence: 0.9 },
    { pattern: 'dominos', category: 'Dining', confidence: 0.9 },
    { pattern: 'subway', category: 'Dining', confidence: 0.9 },
    { pattern: 'panera', category: 'Dining', confidence: 0.9 },
    { pattern: 'chipotle', category: 'Dining', confidence: 0.9 },
    { pattern: 'chipotle mexican grill', category: 'Dining', confidence: 0.9 },
    { pattern: 'dunkin', category: 'Dining', confidence: 0.9 },
    { pattern: 'krispy kreme', category: 'Dining', confidence: 0.85 },
    { pattern: 'dunkin donuts', category: 'Dining', confidence: 0.85 },
    { pattern: 'starbucks coffee', category: 'Dining', confidence: 0.9 },
    { pattern: 'cafe', category: 'Dining', confidence: 0.85 },
    { pattern: 'restaurant', category: 'Dining', confidence: 0.85 },
    { pattern: 'dinner', category: 'Dining', confidence: 0.85 },
    { pattern: 'lunch', category: 'Dining', confidence: 0.85 },
    { pattern: 'breakfast', category: 'Dining', confidence: 0.85 },
    { pattern: 'brunch', category: 'Dining', confidence: 0.85 },
    { pattern: 'cafe coffee', category: 'Dining', confidence: 0.85 },
    // Utilities
    { pattern: 'electric', category: 'Utilities', confidence: 0.95 },
    { pattern: 'power', category: 'Utilities', confidence: 0.9 },
    { pattern: 'gas bill', category: 'Utilities', confidence: 0.9 },
    { pattern: 'gas', category: 'Utilities', confidence: 0.9 },
    { pattern: 'water bill', category: 'Utilities', confidence: 0.9 },
    { pattern: 'water', category: 'Utilities', confidence: 0.9 },
    { pattern: 'internet', category: 'Utilities', confidence: 0.85 },
    { pattern: 'phone', category: 'Utilities', confidence: 0.85 },
    { pattern: 'mobile', category: 'Utilities', confidence: 0.85 },
    { pattern: 'at&t', category: 'Utilities', confidence: 0.9 },
    { pattern: 'verizon', category: 'Utilities', confidence: 0.9 },
    { pattern: 't-mobile', category: 'Utilities', confidence: 0.9 },
    // Healthcare
    { pattern: 'pharmacy', category: 'Healthcare', confidence: 0.85 },
    { pattern: 'cvs', category: 'Healthcare', confidence: 0.95 },
    { pattern: 'walgreens', category: 'Healthcare', confidence: 0.95 },
    { pattern: 'hospital', category: 'Healthcare', confidence: 0.9 },
    { pattern: 'doctor', category: 'Healthcare', confidence: 0.85 },
    { pattern: 'clinic', category: 'Healthcare', confidence: 0.85 },
    { pattern: 'dental', category: 'Healthcare', confidence: 0.9 },
    { pattern: 'optometrist', category: 'Healthcare', confidence: 0.9 },
    // Entertainment
    { pattern: 'cinema', category: 'Entertainment', confidence: 0.9 },
    { pattern: 'theater', category: 'Entertainment', confidence: 0.9 },
    { pattern: 'concert', category: 'Entertainment', confidence: 0.9 },
    { pattern: 'ticketmaster', category: 'Entertainment', confidence: 0.95 },
    { pattern: 'steam', category: 'Entertainment', confidence: 0.9 },
    { pattern: 'playstation', category: 'Entertainment', confidence: 0.9 },
    { pattern: 'xbox', category: 'Entertainment', confidence: 0.9 },
    // Housing
    { pattern: 'rent', category: 'Housing', confidence: 0.95 },
    { pattern: 'mortgage', category: 'Housing', confidence: 0.95 },
    { pattern: 'hoa', category: 'Housing', confidence: 0.9 },
    { pattern: 'insurance', category: 'Housing', confidence: 0.7 },
    // Income
    { pattern: 'payroll', category: 'Salary', confidence: 0.95 },
    { pattern: 'salary', category: 'Salary', confidence: 0.95 },
    { pattern: 'direct deposit', category: 'Salary', confidence: 0.9 },
    { pattern: 'freelance', category: 'Freelance', confidence: 0.9 },
    { pattern: 'dividend', category: 'Investments', confidence: 0.95 },
    { pattern: 'interest', category: 'Investments', confidence: 0.9 },
  ];

  // Get learned mappings for profile
  router.get(
    '/api/categories/mappings',
    apiRateLimiter,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const rows = req.repos.categories.listMappingsWithCategory(pid);
      res.json(rows);
    })
  );

  // Add/update a mapping
  router.post(
    '/api/categories/mappings',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const { pattern, category_id, confidence, use_count } = req.body;

      // Validation
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return res.status(400).json({ error: 'Pattern is required' });
      }
      if (!category_id || typeof category_id !== 'number' || category_id <= 0) {
        return res.status(400).json({ error: 'Valid category_id is required' });
      }

      const result = req.repos.categories.upsertMapping(
        pid,
        pattern.trim(),
        category_id,
        confidence || 0.9
      );
      res.json(
        toCamelCase({
          ok: true,
          id: result.id,
          use_count: result.use_count,
        })
      );
    })
  );

  // Delete a mapping
  router.delete(
    '/api/categories/mappings/:id',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const result = req.repos.categories.deleteMapping(req.params.id, pid);
      if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
      res.json(toCamelCase({ ok: true }));
    })
  );

  // ==================== CATEGORY CRUD ====================

  router.delete(
    '/api/categories',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      req.repos.categories.deleteAll(pid);
      res.json({ ok: true, message: 'All categories deleted' });
    })
  );

  router.get(
    '/api/categories/:id',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const cat = req.repos.categories.getById(req.params.id, pid);
      if (!cat) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.json(cat);
    })
  );

  router.put(
    '/api/categories/:id',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const existing = req.repos.categories.getById(req.params.id, pid);
      if (!existing) return res.status(404).json({ error: 'Category not found' });

      const { name, color, icon, type, parent_id: parentIdParam, tax_deductible } = req.body;
      const parent_id = parentIdParam !== undefined ? parentIdParam : req.body.parentId || null;
      req.repos.categories.update(req.params.id, pid, {
        name: name !== undefined ? name : existing.name,
        color: color !== undefined ? color : existing.color,
        icon: icon !== undefined ? icon : existing.icon,
        type: type !== undefined ? type : existing.type,
        parent_id: parent_id || null,
        tax_deductible: tax_deductible ? 1 : 0,
      });
      res.json(toCamelCase({ ok: true }));
    })
  );

  router.delete(
    '/api/categories/:id',
    apiRateLimiter,
    requireAuth,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const result = req.repos.categories.deleteById(req.params.id, pid);
      if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
      res.json(toCamelCase({ ok: true }));
    })
  );
  router.post(
    '/api/categories/auto-map',
    apiRateLimiter,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const { transaction_ids, description, amount } = req.body;

      // Fetch categories and learned mappings for matching
      const categories = req.repos.categories.list(pid);
      const learnedMappings = req.repos.categories.listMappings(pid);

      // If transaction_ids provided, use those; otherwise filter by description+amount
      let txQuery = `
    SELECT t.id, t.description, t.beneficiary, t.payor, t.amount, c.name as category_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.profile_id = ? AND (t.category_id IS NULL OR c.name = 'Other')
    `;
      let params = [pid];

      if (transaction_ids && transaction_ids.length > 0) {
        txQuery += ' AND t.id IN (' + transaction_ids.map(() => '?').join(',') + ')';
        params = params.concat(transaction_ids);
      } else if (description && amount) {
        // Match by description and amount
        const normalizedDesc = description
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]/g, '');
        const amountMatch = amount.toString().replace(/[^0-9.]/g, '');
        txQuery += ' AND (LOWER(t.description) LIKE ? OR LOWER(t.beneficiary) LIKE ?)';
        params.push('%' + normalizedDesc + '%', '%' + normalizedDesc + '%');
      }

      const transactions = req.repos.transactions.all(txQuery, ...params);

      const proposedMappings = [];

      for (const tx of transactions) {
        const searchText =
          `${tx.description} ${tx.beneficiary || ''} ${tx.payor || ''}`.toLowerCase();
        const normalizedSearch = searchText.replace(/[^a-z0-9]/g, '');

        let bestMatch = null;
        let bestScore = 0;

        // 1. Check learned mappings first (highest priority, boosted by use_count)
        for (const mapping of learnedMappings) {
          const patternLower = mapping.pattern.toLowerCase();
          if (normalizedSearch.includes(patternLower.replace(/[^a-z0-9]/g, ''))) {
            const score =
              mapping.confidence * Math.min(1 + Math.log10(mapping.use_count + 1) * 0.2, 1.5);
            if (score > bestScore) {
              bestScore = score;
              const cat = categories.find((c) => c.id === mapping.category_id);
              if (cat) {
                bestMatch = {
                  category_id: cat.id,
                  category_name: cat.name,
                  category_color: cat.color,
                  confidence: score,
                };
              }
            }
          }
        }

        // 2. Check merchant dictionary
        if (!bestMatch || bestScore < 0.8) {
          for (const merchant of MERCHANT_DICTIONARY) {
            const patternLower = merchant.pattern.toLowerCase();
            if (normalizedSearch.includes(patternLower.replace(/[^a-z0-9]/g, ''))) {
              if (merchant.confidence > bestScore) {
                bestScore = merchant.confidence;
                const cat = categories.find(
                  (c) => c.name.toLowerCase() === merchant.category.toLowerCase()
                );
                if (cat) {
                  bestMatch = {
                    category_id: cat.id,
                    category_name: cat.name,
                    category_color: cat.color,
                    confidence: merchant.confidence,
                  };
                }
              }
            }
          }
        }

        // 3. Token overlap matching with category names
        if (!bestMatch || bestScore < 0.6) {
          const searchTokens = normalizedSearch.split(/[0-9]+/).filter((t) => t.length > 2);

          for (const cat of categories) {
            const catTokens = cat.name
              .toLowerCase()
              .split(/[^a-z]+/)
              .filter((t) => t.length > 2);

            // Calculate token overlap
            let matches = 0;
            for (const token of searchTokens) {
              if (
                cat.name.toLowerCase().includes(token) ||
                (token.length > 3 &&
                  cat.name
                    .toLowerCase()
                    .split('')
                    .some((c) => c.startsWith(token.slice(0, 3))))
              ) {
                matches++;
              }
            }

            if (matches > 0) {
              const score = (matches / Math.max(searchTokens.length, catTokens.length)) * 0.5;
              if (score > bestScore) {
                bestScore = score;
                bestMatch = {
                  category_id: cat.id,
                  category_name: cat.name,
                  category_color: cat.color,
                  confidence: score,
                };
              }
            }
          }
        }

        if (bestMatch) {
          proposedMappings.push({
            transaction_id: tx.id,
            description: tx.description,
            proposed_category_id: bestMatch.category_id,
            proposed_category_name: bestMatch.category_name,
            proposed_category_color: bestMatch.category_color,
            confidence: Math.min(bestMatch.confidence, 1),
          });
        }
      }

      res.json({
        total: transactions.length,
        mapped: proposedMappings.length,
        mappings: proposedMappings,
      });
    })
  );

  // Apply confirmed mappings to transactions
  router.post(
    '/api/categories/apply-mappings',
    apiRateLimiter,
    asyncHandler((req, res) => {
      const pid = getProfileId(req);
      const { mappings } = req.body;

      if (!mappings || !Array.isArray(mappings)) {
        return res.status(400).json({ error: 'Invalid mappings array' });
      }

      let updated = 0;

      for (const mapping of mappings) {
        const { transaction_id, category_id, pattern } = mapping;

        // Update transaction
        const result = req.repos.transactions.run(
          "UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ? AND profile_id = ?",
          category_id,
          transaction_id,
          pid
        );
        if (result.changes > 0) updated++;

        // Store mapping for future use
        if (pattern) {
          const normalizedPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normalizedPattern.length >= 3) {
            try {
              req.repos.categories.upsertMapping(pid, normalizedPattern, category_id, 0.9);
            } catch (e) {
              // Ignore duplicate errors
            }
          }
        }
      }

      res.json({ ok: true, updated });
    })
  );

  return router;
};
