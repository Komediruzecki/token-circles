'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { toCamelCase } = require('../utils');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/export/:type', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const { type } = req.params;
      const { format = 'csv' } = req.query;

      let data, filename;
      switch (type) {
        case 'transactions': {
          const rows = db
            .prepare(
              `
          SELECT t.date, t.description, t.amount, t.type, t.currency, t.means_of_payment, t.beneficiary, t.payor, t.notes, c.name as category
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
          WHERE t.profile_id IN (${inClause})
          ORDER BY t.date DESC
        `
            )
            .all(...pids);
          data = rows;
          filename = 'transactions';
          break;
        }
        case 'categories': {
          const rows = db
            .prepare(
              `
          SELECT name, color, icon, type, parent_id FROM categories WHERE profile_id IN (${inClause})
        `
            )
            .all(...pids);
          data = rows;
          filename = 'categories';
          break;
        }
        case 'accounts': {
          const rows = db
            .prepare(
              `
          SELECT name, type, currency, balance, notes FROM accounts WHERE profile_id IN (${inClause})
        `
            )
            .all(...pids);
          data = rows;
          filename = 'accounts';
          break;
        }
        case 'budgets': {
          const rows = db
            .prepare(
              `
          SELECT b.*, c.name as category_name FROM budgets b
          JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
          WHERE b.profile_id IN (${inClause})
        `
            )
            .all(...pids);
          data = rows;
          filename = 'budgets';
          break;
        }
        case 'loans': {
          const rows = db
            .prepare(
              `
          SELECT l.name, l.principal, l.interest_rate, l.start_date, l.term_months,
            (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid
          FROM loans l WHERE l.profile_id IN (${inClause})
        `
            )
            .all(...pids);
          data = rows;
          filename = 'loans';
          break;
        }
        case 'recurring': {
          const rows = db
            .prepare(
              `
          SELECT description, amount, type, frequency, day_of_month, next_date, notes, active
          FROM recurring_transactions WHERE profile_id IN (${inClause})
        `
            )
            .all(...pids);
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
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });
  router.get('/api/export', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');

      // Get all data
      const transactions = db
        .prepare(
          `
      SELECT t.* FROM transactions t
      WHERE t.profile_id IN (${inClause})
      ORDER BY t.date DESC
    `
        )
        .all(...pids);

      const categories = db
        .prepare(
          `
      SELECT c.* FROM categories c
      WHERE c.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const accounts = db
        .prepare(
          `
      SELECT a.* FROM accounts a
      WHERE a.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const budgets = db
        .prepare(
          `
      SELECT b.* FROM budgets b
      WHERE b.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const loans = db
        .prepare(
          `
      SELECT l.* FROM loans l
      WHERE l.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const profiles = db.prepare(`SELECT * FROM profiles`).all();

      const goals = db
        .prepare(
          `
      SELECT sg.* FROM savings_goals sg
      WHERE sg.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const balanceHistory = db
        .prepare(
          `
      SELECT abh.* FROM account_balance_history abh
      JOIN accounts a ON a.id = abh.account_id
      WHERE a.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const settings = db
        .prepare(
          `
      SELECT s.key, s.value
      FROM settings s
      WHERE s.profile_id = ? OR s.profile_id IS NULL
    `
        )
        .get(getProfileId(req));

      // Build settings object
      const settingsObj = {};
      if (settings) {
        settingsObj[settings.key] = settings.value;
      }

      const retirementGoals = db
        .prepare(
          `
      SELECT rg.* FROM retirement_goals rg
      WHERE rg.profile_id IN (${inClause})
    `
        )
        .all(...pids);

      const portfolioHoldings = db
        .prepare(
          `
      SELECT ph.* FROM portfolio_holdings ph
      WHERE ph.profile_id IN (${inClause})
    `
        )
        .all(...pids);

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
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Import data from JSON (serverless mode support)
  router.post('/api/import', apiRateLimiter, (req, res) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid data format' });
      }

      const pid = getProfileId(req);

      // Create transaction record ID counter
      let txId = Math.max(
        ...(db.prepare('SELECT MAX(id) as max FROM transactions').get()?.max || [0])
      );
      let catId = Math.max(
        ...(db.prepare('SELECT MAX(id) as max FROM categories').get()?.max || [0])
      );
      let accId = Math.max(
        ...(db.prepare('SELECT MAX(id) as max FROM accounts').get()?.max || [0])
      );
      let budgetId = Math.max(
        ...(db.prepare('SELECT MAX(id) as max FROM budgets').get()?.max || [0])
      );
      let loanId = Math.max(...(db.prepare('SELECT MAX(id) as max FROM loans').get()?.max || [0]));

      // Map category names to IDs for reference
      const categoryMap = new Map();

      // Insert profiles
      if (data.profiles && data.profiles.length > 0) {
        const insertProfile = db.prepare(`INSERT INTO profiles (name, created_at) VALUES (?, ?)`);
        for (const p of data.profiles) {
          insertProfile.run(p.name, p.created_at || new Date().toISOString());
        }
      }

      // Insert categories
      const insertCat = db.prepare(`
      INSERT INTO categories (name, color, icon, type, profile_id, tax_deductible, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

      if (data.categories && data.categories.length > 0) {
        for (const cat of data.categories) {
          // Convert category data to match schema
          const insertData = [
            cat.name || cat.category_name,
            cat.color || '#6b7280',
            cat.icon || 'tag',
            cat.type || 'expense',
            pid,
            cat.tax_deductible ? 1 : 0,
            cat.created_at || new Date().toISOString(),
          ];
          catId++;
          insertCat.run(...insertData);
          categoryMap.set(cat.name, catId);
        }
      }

      // Insert accounts
      const insertAcc = db.prepare(`
      INSERT INTO accounts (name, type, currency, balance, notes, profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

      if (data.accounts && data.accounts.length > 0) {
        for (const acc of data.accounts) {
          accId++;
          insertAcc.run(
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
      const insertBudget = db.prepare(`
      INSERT INTO budgets (category_id, amount, period, start_date, end_date, rollover_enabled, rollover_amount, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

      if (data.budgets && data.budgets.length > 0) {
        for (const b of data.budgets) {
          budgetId++;
          insertBudget.run(
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
      const insertLoan = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

      if (data.loans && data.loans.length > 0) {
        for (const l of data.loans) {
          loanId++;
          insertLoan.run(
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
      const insertTx = db.prepare(`
      INSERT INTO transactions (date, description, amount, type, currency, means_of_payment, beneficiary, payor, notes, category_id, profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

      let importedCount = 0;

      if (data.transactions && data.transactions.length > 0) {
        for (const tx of data.transactions) {
          txId++;
          const catIdForTx = categoryMap.get(tx.description || tx.category_name) || null;
          insertTx.run(
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
        const insertGoal = db.prepare(`
        INSERT INTO savings_goals (name, target_amount, current_amount, deadline, notes, category_id, profile_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
        for (const g of data.goals) {
          insertGoal.run(
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
        const insertRg = db.prepare(`
        INSERT INTO retirement_goals (name, target_amount, current_amount, deadline, notes, current_age, retirement_age, monthly_contribution, expected_return_rate, profile_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
        for (const g of data.retirementGoals) {
          insertRg.run(
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
          const insertBH = db.prepare(`
          INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)
        `);
          for (const entry of data.balanceHistory) {
            insertBH.run(
              entry.account_id,
              entry.balance,
              entry.recorded_at || new Date().toISOString()
            );
          }
        } else if (typeof data.balanceHistory === 'object') {
          const insertBH = db.prepare(`
          INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)
        `);
          for (const [accountId, entries] of Object.entries(data.balanceHistory)) {
            if (Array.isArray(entries)) {
              for (const entry of entries) {
                insertBH.run(
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
        const insertHolding = db.prepare(`
        INSERT INTO portfolio_holdings (ticker, shares, purchase_price, purchase_date, notes, profile_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
        for (const h of data.portfolioHoldings) {
          insertHolding.run(
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
        const upsertSettings = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, profile_id)
        VALUES (?, ?, ?)
      `);
        for (const [key, value] of Object.entries(data.settings)) {
          upsertSettings.run(key, String(value), pid);
        }
      }

      res.json({
        ok: true,
        imported: importedCount,
        message: `Successfully imported ${importedCount} transactions`,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      console.error('Import error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // IMPORT PREVIEW
  // ========================
  router.post('/api/import/preview', apiRateLimiter, (req, res) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid data format' });
      }

      const pid = getProfileId(req);

      // Get existing data for duplicate detection
      const existingTransactions = db
        .prepare('SELECT id, date, description, amount FROM transactions WHERE profile_id = ?')
        .all(pid);
      const existingCategories = db
        .prepare('SELECT name FROM categories WHERE profile_id = ?')
        .all(pid);

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
    } catch (err) {
      console.error('Import preview error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all data (dangerous!)
  router.delete('/api/clear-all', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      db.prepare(
        'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
      ).run(pid);
      db.prepare(
        'DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
      ).run(pid);
      db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(pid);
      db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(pid);
      db.prepare('DELETE FROM loans WHERE profile_id = ?').run(pid);
      db.prepare('DELETE FROM categories WHERE profile_id = ?').run(pid);
      db.prepare('DELETE FROM accounts WHERE profile_id = ?').run(pid);
      // Also clear settings
      db.prepare('DELETE FROM settings WHERE profile_id = ?').run(pid);

      res.json({ ok: true, message: 'All data cleared' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
