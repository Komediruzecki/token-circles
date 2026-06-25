'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { toCamelCase } = require('../utils');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/export/:type', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { type } = req.params;
    const { format = 'csv' } = req.query;

    let data, filename;
    switch (type) {
      case 'transactions': {
        const rows = req.repos.transactions.all(
          `
        SELECT t.date, t.description, t.amount, t.type, t.currency, t.means_of_payment, t.beneficiary, t.payor, t.notes, c.name as category
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
        WHERE t.profile_id IN (${inClause})
        ORDER BY t.date DESC
      `,
          ...pids
        );
        data = rows;
        filename = 'transactions';
        break;
      }
      case 'categories': {
        const rows = req.repos.categories.all(
          `
        SELECT name, color, icon, type, parent_id FROM categories WHERE profile_id IN (${inClause})
      `,
          ...pids
        );
        data = rows;
        filename = 'categories';
        break;
      }
      case 'accounts': {
        const rows = req.repos.accounts.all(
          `
        SELECT name, type, currency, balance, notes FROM accounts WHERE profile_id IN (${inClause})
      `,
          ...pids
        );
        data = rows;
        filename = 'accounts';
        break;
      }
      case 'budgets': {
        const rows = req.repos.budgets.all(
          `
        SELECT b.*, c.name as category_name FROM budgets b
        JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
        WHERE b.profile_id IN (${inClause})
      `,
          ...pids
        );
        data = rows;
        filename = 'budgets';
        break;
      }
      case 'loans': {
        const rows = req.repos.loans.all(
          `
        SELECT l.name, l.principal, l.interest_rate, l.start_date, l.term_months,
          (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid
        FROM loans l WHERE l.profile_id IN (${inClause})
      `,
          ...pids
        );
        data = rows;
        filename = 'loans';
        break;
      }
      case 'recurring': {
        const rows = req.repos.recurring.all(
          `
        SELECT description, amount, type, frequency, day_of_month, next_date, notes, active
        FROM recurring_transactions WHERE profile_id IN (${inClause})
      `,
          ...pids
        );
        data = rows;
        filename = 'recurring_transactions';
        break;
      }
      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(data);
    } else {
      // CSV format
      if (data.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.end('');
      }
      const headers = Object.keys(data[0]);
      const csv = [
        headers.join(','),
        ...data.map((row) =>
          headers
            .map((h) => {
              const val = row[h] == null ? '' : String(row[h]);
              return val.includes(',') || val.includes('"') || val.includes('\n')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            })
            .join(',')
        ),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.end(csv);
    }

  }));
  router.get('/api/export', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // Get all data
    const transactions = req.repos.transactions.all(
      `
    SELECT t.* FROM transactions t
    WHERE t.profile_id IN (${inClause})
    ORDER BY t.date DESC
    `,
      ...pids
    );

    const categories = req.repos.categories.all(
      `
    SELECT c.* FROM categories c
    WHERE c.profile_id IN (${inClause})
    `,
      ...pids
    );

    const accounts = req.repos.accounts.all(
      `
    SELECT a.* FROM accounts a
    WHERE a.profile_id IN (${inClause})
    `,
      ...pids
    );

    const budgets = req.repos.budgets.all(
      `
    SELECT b.* FROM budgets b
    WHERE b.profile_id IN (${inClause})
    `,
      ...pids
    );

    const loans = req.repos.loans.all(
      `
    SELECT l.* FROM loans l
    WHERE l.profile_id IN (${inClause})
    `,
      ...pids
    );

    const profiles = req.repos.profiles.all(`SELECT * FROM profiles`);

    const goals = req.repos.goals.all(
      `
    SELECT sg.* FROM savings_goals sg
    WHERE sg.profile_id IN (${inClause})
    `,
      ...pids
    );

    const balanceHistory = req.repos.accounts.all(
      `
    SELECT abh.* FROM account_balance_history abh
    JOIN accounts a ON a.id = abh.account_id
    WHERE a.profile_id IN (${inClause})
    `,
      ...pids
    );

    const settings = req.repos.settings.getAll(getProfileId(req));

    // Build settings object
    const settingsObj = {};
    if (Array.isArray(settings)) {
      for (const s of settings) {
        settingsObj[s.key] = s.value;
      }
    }

    const retirementGoals = req.repos.goals.all(
      `
    SELECT rg.* FROM retirement_goals rg
    WHERE rg.profile_id IN (${inClause})
    `,
      ...pids
    );

    const portfolioHoldings = req.repos.portfolio.all(
      `
    SELECT ph.* FROM portfolio_holdings ph
    WHERE ph.profile_id IN (${inClause})
    `,
      ...pids
    );

    res.json({
      version: '2.0',
      export_date: new Date().toISOString(),
      storage_mode: req.session.storageMode || 'self-hosted',
      profiles,
      categories,
      transactions,
      accounts,
      budgets,
      goals,
      retirementGoals,
      portfolioHoldings,
      loans,
      balanceHistory,
      settings: settingsObj,
    });

  }));

  // Import data from JSON (serverless mode support)
  router.post('/api/import', apiRateLimiter, asyncHandler((req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const pid = getProfileId(req);

    // Create transaction record ID counter
    let txId = Math.max(
      ...(req.repos.transactions.get('SELECT MAX(id) as max FROM transactions')?.max || [0])
    );
    let catId = Math.max(
      ...(req.repos.categories.get('SELECT MAX(id) as max FROM categories')?.max || [0])
    );
    let accId = Math.max(
      ...(req.repos.accounts.get('SELECT MAX(id) as max FROM accounts')?.max || [0])
    );
    let budgetId = Math.max(
      ...(req.repos.budgets.get('SELECT MAX(id) as max FROM budgets')?.max || [0])
    );
    let loanId = Math.max(
      ...(req.repos.loans.get('SELECT MAX(id) as max FROM loans')?.max || [0])
    );

    // Map category names to IDs for reference
    const categoryMap = new Map();

    // Insert profiles
    if (data.profiles && data.profiles.length > 0) {
      for (const p of data.profiles) {
        req.repos.profiles.run(
          `INSERT INTO profiles (name, created_at) VALUES (?, ?)`,
          p.name,
          p.created_at || new Date().toISOString()
        );
      }
    }

    // Insert categories
    if (data.categories && data.categories.length > 0) {
      for (const cat of data.categories) {
        catId++;
        req.repos.categories.run(
          `INSERT INTO categories (name, color, icon, type, profile_id, tax_deductible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          cat.name || cat.category_name,
          cat.color || '#6b7280',
          cat.icon || 'tag',
          cat.type || 'expense',
          pid,
          cat.tax_deductible ? 1 : 0,
          cat.created_at || new Date().toISOString()
        );
        categoryMap.set(cat.name, catId);
      }
    }

    // Insert accounts
    if (data.accounts && data.accounts.length > 0) {
      for (const acc of data.accounts) {
        accId++;
        req.repos.accounts.run(
          `INSERT INTO accounts (name, type, currency, balance, notes, profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          acc.name,
          acc.type || 'giro',
          acc.currency || 'EUR',
          acc.balance || 0,
          acc.notes || '',
          pid,
          new Date().toISOString()
        );
      }
    }

    // Insert budgets
    if (data.budgets && data.budgets.length > 0) {
      for (const b of data.budgets) {
        budgetId++;
        req.repos.budgets.run(
          `INSERT INTO budgets (category_id, amount, period, start_date, end_date, rollover_enabled, rollover_amount, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          b.category_id || null,
          b.amount || 0,
          b.period || 'monthly',
          b.start_date || new Date().toISOString(),
          b.end_date || null,
          b.rollover_enabled ? 1 : 0,
          b.rollover_amount || 0,
          pid
        );
      }
    }

    // Insert loans
    if (data.loans && data.loans.length > 0) {
      for (const l of data.loans) {
        loanId++;
        req.repos.loans.run(
          `INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id) VALUES (?, ?, ?, ?, ?, ?)`,
          l.name,
          l.principal || 0,
          l.interest_rate || 5.0,
          l.start_date || new Date().toISOString(),
          l.term_months || 360,
          pid
        );
      }
    }

    // Insert transactions
    let importedCount = 0;

    if (data.transactions && data.transactions.length > 0) {
      for (const tx of data.transactions) {
        txId++;
        const catIdForTx = categoryMap.get(tx.description || tx.category_name) || null;
        req.repos.transactions.run(
          `INSERT INTO transactions (date, description, amount, type, currency, means_of_payment, beneficiary, payor, notes, category_id, profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tx.date,
          tx.description || tx.category_name,
          parseFloat(tx.amount) || 0,
          tx.type || 'expense',
          tx.currency || 'EUR',
          tx.means_of_payment || tx.means || '',
          tx.beneficiary || '',
          tx.payor || '',
          tx.notes || '',
          catIdForTx,
          pid,
          tx.created_at || new Date().toISOString()
        );
        importedCount++;
      }
    }

    // Insert goals
    if (data.goals && data.goals.length > 0) {
      for (const g of data.goals) {
        req.repos.goals.run(
          `INSERT INTO savings_goals (name, target_amount, current_amount, deadline, notes, category_id, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          g.name,
          g.target_amount || 0,
          g.current_amount || 0,
          g.deadline || null,
          g.notes || '',
          g.category_id || null,
          pid
        );
      }
    }

    // Insert retirement goals
    if (data.retirementGoals && data.retirementGoals.length > 0) {
      for (const g of data.retirementGoals) {
        req.repos.goals.run(
          `INSERT INTO retirement_goals (name, target_amount, current_amount, deadline, notes, current_age, retirement_age, monthly_contribution, expected_return_rate, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          g.name,
          g.target_amount || 0,
          g.current_amount || 0,
          g.deadline || null,
          g.notes || '',
          g.current_age || 30,
          g.retirement_age || 65,
          g.monthly_contribution || 0,
          g.expected_return_rate || 7,
          pid
        );
      }
    }

    // Insert balance history
    if (data.balanceHistory) {
      if (Array.isArray(data.balanceHistory)) {
        for (const entry of data.balanceHistory) {
          req.repos.accounts.run(
            `INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)`,
            entry.account_id,
            entry.balance,
            entry.recorded_at || new Date().toISOString()
          );
        }
      } else if (typeof data.balanceHistory === 'object') {
        for (const [accountId, entries] of Object.entries(data.balanceHistory)) {
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              req.repos.accounts.run(
                `INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)`,
                parseInt(accountId),
                entry.balance,
                entry.recorded_at || new Date().toISOString()
              );
            }
          }
        }
      }
    }

    // Insert portfolio holdings
    if (data.portfolioHoldings && data.portfolioHoldings.length > 0) {
      for (const h of data.portfolioHoldings) {
        req.repos.portfolio.run(
          `INSERT INTO portfolio_holdings (ticker, shares, purchase_price, purchase_date, notes, profile_id) VALUES (?, ?, ?, ?, ?, ?)`,
          h.ticker,
          h.shares,
          h.purchase_price || h.purchasePrice,
          h.purchase_date || h.purchaseDate,
          h.notes || '',
          pid
        );
      }
    }

    // Update settings
    if (data.settings && Object.keys(data.settings).length > 0) {
      for (const [key, value] of Object.entries(data.settings)) {
        req.repos.settings.run(
          `INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)`,
          key,
          String(value),
          pid
        );
      }
    }

    res.json({
      ok: true,
      imported: importedCount,
      message: `Successfully imported ${importedCount} transactions`,
    });
  }));

  // ========================
  // IMPORT PREVIEW
  // ========================
  router.post('/api/import/preview', apiRateLimiter, asyncHandler((req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const pid = getProfileId(req);

    // Get existing data for duplicate detection
    const existingTransactions = req.repos.transactions.all(
      'SELECT id, date, description, amount FROM transactions WHERE profile_id = ?',
      pid
    );
    const existingCategories = req.repos.categories.all(
      'SELECT name FROM categories WHERE profile_id = ?',
      pid
    );

    // Build lookup maps for duplicates
    const existingTransactionMap = new Map();
    existingTransactions.forEach((tx) => {
      const key = `${tx.date}|${tx.description.toLowerCase().trim()}|${tx.amount}`;
      if (!existingTransactionMap.has(key)) {
        existingTransactionMap.set(key, []);
      }
      existingTransactionMap.get(key).push(tx);
    });

    // Track duplicates by key
    const duplicateMap = new Map();
    let totalNew = 0;
    let totalDuplicates = 0;
    let totalEstimatedImport = 0;

    // Check transactions for duplicates
    if (data.transactions && data.transactions.length > 0) {
      data.transactions.forEach((tx) => {
        const key = `${tx.date}|${(tx.description || tx.category_name || '').toLowerCase().trim()}|${parseFloat(tx.amount) || 0}`;
        const existing = existingTransactionMap.get(key);

        if (existing && existing.length > 0) {
          duplicateMap.set(key, existing);
          totalDuplicates++;
        } else {
          totalNew++;
        }
        totalEstimatedImport++;
      });
    }

    // Check categories (count as duplicates if name exists)
    let newCategories = 0;
    let duplicateCategories = 0;
    if (data.categories && data.categories.length > 0) {
      data.categories.forEach((cat) => {
        const catName = (cat.name || cat.category_name || '').toLowerCase().trim();
        const exists = existingCategories.find((c) => c.name.toLowerCase() === catName);
        if (exists) {
          duplicateCategories++;
        } else {
          newCategories++;
        }
      });
    }

    // Build preview data
    const previewData = {
      totalTransactions: data.transactions?.length || 0,
      newTransactions: totalNew,
      duplicateTransactions: totalDuplicates,
      totalCategories: data.categories?.length || 0,
      newCategories: newCategories,
      duplicateCategories: duplicateCategories,
      totalEstimatedImport,
      duplicateCountByDate: duplicateMap,
    };

    res.json(previewData);
  }));

  // Clear all data (dangerous!)
  router.delete('/api/clear-all', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    req.repos.loans.run(
      'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)',
      pid
    );
    req.repos.loans.run(
      'DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)',
      pid
    );
    req.repos.transactions.run('DELETE FROM transactions WHERE profile_id = ?', pid);
    req.repos.budgets.run('DELETE FROM budgets WHERE profile_id = ?', pid);
    req.repos.loans.run('DELETE FROM loans WHERE profile_id = ?', pid);
    req.repos.categories.run('DELETE FROM categories WHERE profile_id = ?', pid);
    req.repos.accounts.run('DELETE FROM accounts WHERE profile_id = ?', pid);
    // Also clear settings
    req.repos.settings.run('DELETE FROM settings WHERE profile_id = ?', pid);

    res.json({ ok: true, message: 'All data cleared' });

  }));

  return router;
};
