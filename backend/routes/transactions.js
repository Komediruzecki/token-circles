const express = require('express');
const { toCamelCase, getCategoryIcon } = require('../utils');
const {
  getProfileId,
  getProfileIds,
  profileWhere,
  profileInClause,
  profileParams,
} = require('../middleware/profile');
const spreadsheetService = require('../services/spreadsheetService');
const { validate, validateBoth } = require('../validators/middleware');
const { asyncHandler } = require('../lib/errors');
const {
  transactionCreateSchema,
  transactionUpdateSchema,
  transactionQuerySchema,
  bulkDeleteSchema,
  bulkUpdateCategorySchema,
  bulkReconcileSchema,
} = require('../validators/schemas');

// Date parsing utility - handles DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
function parseDateString(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  if (typeof dateStr === 'number') {
    // Excel date code
    const d = spreadsheetService.parseExcelDate(dateStr);
    if (d) return new Date(d.y, d.m - 1, d.d).toISOString().split('T')[0];
  }
  const s = String(dateStr).trim();
  // Try DD/MM/YYYY or DD-MM-YYYY (European)
  const euMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (euMatch) {
    const [, d, m, y] = euMatch;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString().split('T')[0];
  }
  // Try MM/DD/YYYY (US) or ISO
  const date = new Date(s);
  if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

module.exports = function ({ apiRateLimiter, requireAuth, logError }) {
  const router = express.Router();

  function recalcGoalProgress(goalId, repos, profileIds) {
    const goal = repos.goals.get('SELECT * FROM savings_goals WHERE id=?', goalId);
    if (!goal || !goal.category_id) return;
    const total = repos.transactions.get(
      'SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE category_id=?',
      goal.category_id
    );
    repos.goals.updateAmount(goalId, profileIds[0], total.total);
  }

  function recalcGoalsByCategory(categoryId, repos, profileIds) {
    if (!categoryId) return;
    const goals = repos.goals.all('SELECT id FROM savings_goals WHERE category_id=?', categoryId);
    for (const g of goals) recalcGoalProgress(g.id, repos, profileIds);
  }

  router.get('/api/transactions', apiRateLimiter, validate(transactionQuerySchema, 'query'), asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const {
      startDate,
      endDate,
      category_ids,
      type,
      search,
      reconciled,
      limit,
      offset,
      sort,
      order,
      tag_ids,
    } = req.query;
    let sql = `
    SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause})
    `;
    const params = [...pids];
    let tagFilterApplied = false;
    if (tag_ids) {
      const tids = tag_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (tids.length > 0) {
        const tagPlaceholders = tids.map(() => '?').join(',');
        sql += ` AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
        params.push(...tids);
        tagFilterApplied = true;
      }
    }
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
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND t.category_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (search) {
      sql +=
        ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (reconciled !== undefined) {
      if (reconciled === '0' || reconciled === 'false') {
        sql += ' AND (t.reconciled = 0 OR t.reconciled IS NULL)';
      } else if (reconciled === '1' || reconciled === 'true') {
        sql += ' AND t.reconciled = 1';
      }
    }
    if (sort) {
      const sortCol = [
        'date',
        'amount',
        'description',
        'category_name',
        'type',
        'beneficiary',
        'payor',
      ].includes(sort)
        ? sort === 'category_name'
          ? 'c.name'
          : `t.${sort}`
        : 't.date';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
      sql += ` ORDER BY ${sortCol} ${sortOrder}, t.id ${sortOrder}`;
    } else {
      sql += ` ORDER BY t.date DESC, t.id DESC`;
    }
    if (limit) {
      const lim = parseInt(limit);
      sql += ` LIMIT ${isNaN(lim) ? 50 : Math.min(lim, 1000)}`;
    }
    if (offset) {
      const off = parseInt(offset);
      if (!isNaN(off)) sql += ` OFFSET ${off}`;
    }
    const rows = req.repos.transactions.all(sql, ...params);

    // Attach tags to each transaction
    for (const row of rows) {
      row.tags = req.repos.tags.getTagsForTransaction(row.id, row.profile_id);
    }

    // Count total
    let countSql = `SELECT COUNT(*) as c FROM transactions t WHERE t.profile_id IN (${inClause})`;
    const cparams = [...pids];
    if (startDate) {
      countSql += ' AND t.date >= ?';
      cparams.push(startDate);
    }
    if (endDate) {
      countSql += ' AND t.date <= ?';
      cparams.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        countSql += ` AND t.category_id IN (${placeholders})`;
        cparams.push(...ids);
      }
    }
    if (type) {
      countSql += ' AND t.type = ?';
      cparams.push(type);
    }
    if (search) {
      countSql +=
        ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
      cparams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (reconciled !== undefined) {
      if (reconciled === '0' || reconciled === 'false') {
        countSql += ' AND (t.reconciled = 0 OR t.reconciled IS NULL)';
      } else if (reconciled === '1' || reconciled === 'true') {
        countSql += ' AND t.reconciled = 1';
      }
    }
    if (tag_ids) {
      const tids = tag_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (tids.length > 0) {
        const tagPlaceholders = tids.map(() => '?').join(',');
        countSql += ` AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
        cparams.push(...tids);
      }
    }
    const total = req.repos.transactions.get(countSql, ...cparams).c;
    res.json({
      rows,
      total,
      limit: limit ? parseInt(limit) : total,
      offset: offset ? parseInt(offset) : 0,
    });

  }));

  router.get('/api/transactions/summary', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { startDate, endDate, category_ids, type, search } = req.query;

    let sql = `
    SELECT
      SUM(t.amount) as total_amount,
      SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as total_expense,
      SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as total_income,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause})
    `;
    const params = [...pids];

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
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND t.category_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (search) {
      sql +=
        ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const result = req.repos.transactions.get(sql, ...params);
    const data = {
      total_amount: result.total_amount || 0,
      total_expense: result.total_expense || 0,
      total_expenses: result.total_expense || 0, // Support plural form
      total_income: result.total_income || 0,
      net_balance: (result.total_income || 0) - (result.total_expense || 0),
      count: result.count || 0,
    };
    res.json(toCamelCase(data));

  }));

  router.post('/api/transactions', apiRateLimiter, requireAuth, validate(transactionCreateSchema, 'body'), asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const pids = getProfileIds(req);
    const {
      description,
      amount,
      date,
      beneficiary,
      payor,
      category_id,
      currency,
      amount_local,
      means_of_payment,
      exchange_rate,
      type,
      notes,
      account_id,
      transfer_account_id,
    } = req.body;

    // Business rule: income amounts must be positive (Zod already validates positiveFloat,
    // but this ensures the type/amount combination makes sense)
    if (Number(amount) < 0 && type === 'income') {
      return res.status(400).json({ error: 'Income amount must be positive' });
    }

    // Use the provided date or parse it
    const resolvedDate = date || new Date().toISOString().split('T')[0];

    // Resolve account_id from means_of_payment (FROM) if not explicitly provided
    let resolvedAccountId = account_id || null;
    let resolvedTransferAccountId = transfer_account_id || null;
    if (!resolvedAccountId && means_of_payment) {
      const matchedAccount = req.repos.accounts.get(
        'SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) AND profile_id IN (?)',
        String(means_of_payment).trim(),
        pids
      );
      if (matchedAccount) resolvedAccountId = matchedAccount.id;
    }
    // Resolve transfer_account_id from category if the category is an account type
    if (!resolvedTransferAccountId && category_id) {
      const cat = req.repos.categories.get(
        'SELECT name FROM categories WHERE id = ? AND profile_id IN (?)',
        category_id,
        pids
      );
      if (cat) {
        const matchedAccount = req.repos.accounts.get(
          'SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) AND profile_id IN (?)',
          String(cat.name).trim(),
          pids
        );
        if (matchedAccount) resolvedTransferAccountId = matchedAccount.id;
      }
    }

    const info = req.repos.transactions.run(
      `
    INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
      currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id, account_id, transfer_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      description,
      amount,
      resolvedDate,
      beneficiary || '',
      payor || '',
      category_id || null,
      currency || 'USD',
      amount_local ?? amount,
      means_of_payment || '',
      exchange_rate || 1.0,
      type || 'expense',
      notes || '',
      pid,
      resolvedAccountId,
      resolvedTransferAccountId
    );
    // Return created transaction with all fields including timestamps
    const created = req.repos.transactions.get(
      `SELECT * FROM transactions WHERE id = ? AND profile_id = ?`,
      info.lastInsertRowid,
      pid
    );
    // Auto-update linked account balances
    if (resolvedAccountId && type === 'transfer' && resolvedTransferAccountId) {
      // Transfer: subtract from source (FROM), add to destination (TO)
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
        amount, resolvedAccountId, pids
      );
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
        amount, resolvedTransferAccountId, pids
      );
    } else if (resolvedAccountId && type === 'transfer') {
      // Transfer with only FROM account (no TO): subtract from FROM
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
        amount, resolvedAccountId, pids
      );
    } else if (resolvedAccountId && (type === 'income' || type === 'expense')) {
      const delta = type === 'income' ? amount : -amount;
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
        delta, resolvedAccountId, pids
      );
    }
    // If account_id is null but transfer_account_id is set, money flows TO that account
    if (
      !resolvedAccountId &&
      resolvedTransferAccountId &&
      (type === 'income' || type === 'transfer')
    ) {
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
        amount, resolvedTransferAccountId, pids
      );
    }
    // Recalculate linked goal progress
    if (category_id) recalcGoalsByCategory(category_id, req.repos, pids);
    res.json(toCamelCase(created));

  }));

  // GET single transaction by ID
  router.get('/api/transactions/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { id } = req.params;

    const tx = req.repos.transactions.get(
      `
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.id = ? AND t.profile_id = ?
    `,
      id,
      pid
    );

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    tx.tags = req.repos.tags.getTagsForTransaction(id, pid);

    const response = toCamelCase(tx);
    response.category = response.categoryName || null;
    delete response.categoryName;
    res.json(response);

  }));

  // Bulk update: PUT /api/transactions/bulk
  router.put('/api/transactions/bulk', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    // Support both 'ids' and 'transactionIds' field names
    let ids = req.body.ids || req.body.transactionIds || [];
    const action = req.body.action || req.body._method || 'update';
    const data = req.body.data || req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No transaction IDs provided' });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ error: 'Cannot update more than 1000 transactions at once' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const authParams = [...pids, ...ids];

    if (action === 'delete' || action === 'DELETE' || action.toLowerCase() === 'delete') {
      // Reverse account balance effects before bulk delete
      const txRows = req.repos.transactions.all(
        `SELECT id, account_id, transfer_account_id, type, amount FROM transactions WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`,
        ...authParams
      );
      for (const tx of txRows) {
        if (!tx.account_id) continue;
        if (tx.type === 'transfer' && tx.transfer_account_id) {
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
            tx.amount, tx.account_id, pids
          );
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
            tx.amount, tx.transfer_account_id, pids
          );
        } else if (tx.type === 'income') {
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
            tx.amount, tx.account_id, pids
          );
        } else if (tx.type === 'expense') {
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
            tx.amount, tx.account_id, pids
          );
        }
      }
      const result = req.repos.transactions.run(
        `DELETE FROM transactions WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`,
        ...authParams
      );
      return res.json({ ok: true, deleted: result.changes });
    }

    if (action === 'update' || action === 'UPDATE' || action.toLowerCase() === 'update') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'No update data provided' });
      }

      const allowedFields = [
        'category_id',
        'type',
        'description',
        'beneficiary',
        'payor',
        'notes',
        'reconciled',
      ];
      const updates = [];
      const updateParams = [];

      for (const field of allowedFields) {
        if (data.hasOwnProperty(field)) {
          if (field === 'category_id') {
            updates.push('category_id = ?');
            updateParams.push(
              data.category_id === null || data.category_id === ''
                ? null
                : parseInt(data.category_id)
            );
          } else if (field === 'reconciled') {
            // Convert boolean to integer for SQLite
            updates.push('reconciled = ?');
            updateParams.push(data.reconciled ? 1 : 0);
          } else if (field === 'type') {
            if (!['income', 'expense', 'transfer'].includes(data.type)) {
              return res
                .status(400)
                .json({ error: 'Invalid type. Must be income, expense, or transfer' });
            }
            updates.push('type = ?');
            updateParams.push(data.type);
          } else {
            updates.push(`${field} = ?`);
            updateParams.push(data[field] || '');
          }
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      updates.push("updated_at = datetime('now')");
      updateParams.push(...pids, ...ids);

      const result = req.repos.transactions.run(
        `UPDATE transactions SET ${updates.join(', ')} WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`,
        ...updateParams
      );
      return res.json({ ok: true, updated: result.changes });
    }

    return res.status(400).json({ error: "Invalid action. Must be 'delete' or 'update'" });

  }));

  router.put('/api/transactions/:id', apiRateLimiter, requireAuth, validate(transactionUpdateSchema, 'body'), asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const pids = getProfileIds(req);
    let hasUpdate = false;
    const {
      description,
      amount,
      date,
      beneficiary,
      payor,
      category_id,
      currency,
      amount_local,
      means_of_payment,
      exchange_rate,
      type,
      notes,
      reconciled,
      account_id,
      transfer_account_id,
    } = req.body;

    // Fetch old transaction for account balance reversal
    const oldTx = req.repos.transactions.get(
      'SELECT account_id, transfer_account_id, type, amount FROM transactions WHERE id=? AND profile_id=?',
      req.params.id,
      pid
    );

    let updates = [];
    let params = [];

    if (description !== undefined) {
      updates.push('description=?');
      params.push(description);
      hasUpdate = true;
    }
    if (amount !== undefined) {
      updates.push('amount=?');
      params.push(amount);
      hasUpdate = true;
    }
    if (date !== undefined) {
      updates.push('date=?');
      params.push(date);
      hasUpdate = true;
    }
    if (beneficiary !== undefined) {
      updates.push('beneficiary=?');
      params.push(beneficiary || '');
      hasUpdate = true;
    }
    if (payor !== undefined) {
      updates.push('payor=?');
      params.push(payor || '');
      hasUpdate = true;
    }
    if (category_id !== undefined) {
      updates.push('category_id=?');
      params.push(category_id || null);
      hasUpdate = true;
    }
    if (currency !== undefined) {
      updates.push('currency=?');
      params.push(currency);
      hasUpdate = true;
    }
    if (amount_local !== undefined) {
      updates.push('amount_local=?');
      params.push(amount_local ?? amount);
      hasUpdate = true;
    }
    if (means_of_payment !== undefined) {
      updates.push('means_of_payment=?');
      params.push(means_of_payment || '');
      hasUpdate = true;
    }
    if (exchange_rate !== undefined) {
      updates.push('exchange_rate=?');
      params.push(exchange_rate || 1.0);
      hasUpdate = true;
    }
    if (type !== undefined) {
      updates.push('type=?');
      params.push(type);
      hasUpdate = true;
    }
    if (notes !== undefined) {
      updates.push('notes=?');
      params.push(notes || '');
      hasUpdate = true;
    }
    if (reconciled !== undefined) {
      updates.push('reconciled=?');
      updates.push("reconciled_at=CASE WHEN ?=1 THEN datetime('now') ELSE reconciled_at END");
      params.push(reconciled ? 1 : 0);
      params.push(reconciled ? 1 : 0);
      hasUpdate = true;
    }
    if (account_id !== undefined) {
      updates.push('account_id=?');
      params.push(account_id || null);
      hasUpdate = true;
    }
    if (transfer_account_id !== undefined) {
      updates.push('transfer_account_id=?');
      params.push(transfer_account_id || null);
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    // Reverse old transaction effect on old account(s)
    if (oldTx && oldTx.account_id) {
      if (oldTx.type === 'transfer' && oldTx.transfer_account_id) {
        // Reverse transfer: add back to source, subtract from destination
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          oldTx.amount, oldTx.account_id, pids
        );
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
          oldTx.amount, oldTx.transfer_account_id, pids
        );
      } else if (oldTx.type === 'transfer') {
        // Transfer with only FROM: add back to source
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          oldTx.amount, oldTx.account_id, pids
        );
      } else if (oldTx.type === 'income' || oldTx.type === 'expense') {
        const oldDelta = oldTx.type === 'income' ? -oldTx.amount : oldTx.amount;
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          oldDelta, oldTx.account_id, pids
        );
      }
    }
    // Reverse old transfer TO effect (money added to transfer_account_id)
    if (oldTx && oldTx.transfer_account_id && oldTx.type === 'transfer' && !oldTx.account_id) {
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
        oldTx.amount, oldTx.transfer_account_id, pids
      );
    }

    updates.push("updated_at=datetime('now')");
    params.push(req.params.id);
    params.push(pid);

    const result = req.repos.transactions.run(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id=? AND profile_id=?`,
      ...params
    );
    if (result.changes === 0) {
      // Re-apply old effect (rollback reversal) since no update happened
      if (oldTx && oldTx.account_id) {
        if (oldTx.type === 'transfer' && oldTx.transfer_account_id) {
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
            oldTx.amount, oldTx.account_id, pids
          );
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
            oldTx.amount, oldTx.transfer_account_id, pids
          );
        } else if (oldTx.type === 'transfer') {
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
            oldTx.amount, oldTx.account_id, pids
          );
        } else if (oldTx.type === 'income' || oldTx.type === 'expense') {
          const oldDelta = oldTx.type === 'income' ? oldTx.amount : -oldTx.amount;
          req.repos.accounts.run(
            'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
            oldDelta, oldTx.account_id, pids
          );
        }
      }
      if (oldTx && oldTx.transfer_account_id && oldTx.type === 'transfer' && !oldTx.account_id) {
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          oldTx.amount, oldTx.transfer_account_id, pids
        );
      }
      return res.status(404).json({ error: 'Not found' });
    }

    // Apply new transaction effect on account(s)
    const newAccountId =
      account_id !== undefined ? account_id || null : oldTx ? oldTx.account_id : null;
    const newTransferAccountId =
      transfer_account_id !== undefined
        ? transfer_account_id || null
        : oldTx
          ? oldTx.transfer_account_id
          : null;
    const newType = type !== undefined ? type : oldTx ? oldTx.type : 'expense';
    const newAmount = amount !== undefined ? amount : oldTx ? oldTx.amount : 0;
    if (newAccountId) {
      if (newType === 'transfer' && newTransferAccountId) {
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
          newAmount, newAccountId, pids
        );
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          newAmount, newTransferAccountId, pids
        );
      } else if (newType === 'transfer') {
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
          newAmount, newAccountId, pids
        );
      } else if (newType === 'income' || newType === 'expense') {
        const newDelta = newType === 'income' ? newAmount : -newAmount;
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          newDelta, newAccountId, pids
        );
      }
    }
    if (!newAccountId && newTransferAccountId && newType === 'transfer') {
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
        newAmount, newTransferAccountId, pids
      );
    }

    // Recalculate linked goal progress
    if (category_id !== undefined) recalcGoalsByCategory(category_id, req.repos, pids);
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/transactions/:id', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const pids = getProfileIds(req);
    // Fetch full tx before delete for account reversal and goal recalc
    const tx = req.repos.transactions.get(
      'SELECT category_id, account_id, transfer_account_id, type, amount FROM transactions WHERE id=? AND profile_id=?',
      req.params.id,
      pid
    );
    const result = req.repos.transactions.run(
      'DELETE FROM transactions WHERE id=? AND profile_id=?',
      req.params.id,
      pid
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    // Reverse transaction effect on linked account(s)
    if (tx && tx.account_id) {
      if (tx.type === 'transfer' && tx.transfer_account_id) {
        // Reverse transfer: add back to source, subtract from destination
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          tx.amount, tx.account_id, pids
        );
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
          tx.amount, tx.transfer_account_id, pids
        );
      } else if (tx.type === 'transfer') {
        // Transfer with only FROM: add back to source
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          tx.amount, tx.account_id, pids
        );
      } else if (tx.type === 'income' || tx.type === 'expense') {
        const delta = tx.type === 'income' ? -tx.amount : tx.amount;
        req.repos.accounts.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (?)',
          delta, tx.account_id, pids
        );
      }
    }
    // Reverse transfer TO effect (remove money added to transfer_account_id)
    if (tx && tx.transfer_account_id && tx.type === 'transfer' && !tx.account_id) {
      req.repos.accounts.run(
        'UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (?)',
        tx.amount, tx.transfer_account_id, pids
      );
    }
    if (tx && tx.category_id) recalcGoalsByCategory(tx.category_id, req.repos, pids);
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/transactions', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const pids = getProfileIds(req);
    req.repos.transactions.run('DELETE FROM transactions WHERE profile_id=?', pid);
    // Reset all account balances to starting_balance since all transactions are deleted
    req.repos.accounts.run(
      'UPDATE accounts SET balance = COALESCE(starting_balance, 0) WHERE profile_id IN (?)',
      pids
    );
    res.json({ ok: true, message: 'All transactions deleted' });

  }));

  // ========================
  // RECONCILIATION (per-profile)
  // ========================
  // Toggle reconciled status for a single transaction
  router.patch('/api/transactions/:id/reconcile', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const existing = req.repos.transactions.get(
      'SELECT id, reconciled FROM transactions WHERE id = ? AND profile_id = ?',
      req.params.id,
      pid
    );
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });

    const newStatus = existing.reconciled ? 0 : 1;
    req.repos.transactions.run(
      "UPDATE transactions SET reconciled = ?, reconciled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND profile_id = ?",
      newStatus, newStatus, req.params.id, pid
    );
    res.json({
      id: parseInt(req.params.id),
      reconciled: newStatus,
      reconciled_at: newStatus ? new Date().toISOString() : null,
    });

  }));

  // Bulk reconcile transactions by date range
  router.post('/api/transactions/reconcile/bulk', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate)
      return res.status(400).json({ error: 'startDate and endDate are required' });

    const result = req.repos.transactions.run(
      `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
     WHERE profile_id = ? AND date >= ? AND date <= ? AND reconciled = 0`,
      pid, startDate, endDate
    );
    res.json({ message: `${result.changes} transactions reconciled`, count: result.changes });

  }));

  // Get reconciliation status summary
  router.get('/api/transactions/reconcile/summary', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const summary = req.repos.transactions.get(
      `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN reconciled = 1 THEN 1 ELSE 0 END) as reconciled_count,
      SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN 1 ELSE 0 END) as unreconciled_count,
      SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN amount ELSE 0 END) as unreconciled_total
     FROM transactions WHERE profile_id IN (${inClause})`,
      ...pids
    );
    res.json(summary);

  }));

  // Batch mark transactions as reconciled by ID list
  router.put('/api/transactions/reconcile-batch', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { transaction_ids } = req.body;
    if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return res.status(400).json({ error: 'transaction_ids array is required' });
    }
    const placeholders = transaction_ids.map(() => '?').join(',');
    const result = req.repos.transactions.run(
      `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
     WHERE id IN (${placeholders}) AND profile_id = ?`,
      ...transaction_ids, pid
    );
    res.json({ message: `${result.changes} transactions reconciled`, updated: result.changes });

  }));

  return router;
};
