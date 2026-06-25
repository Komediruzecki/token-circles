'use strict';
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { getCategoryIcon } = require('../utils');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError, uploadImport, spreadsheetService }) {
  const router = express.Router();

  function parseDateString(dateStr) {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    if (typeof dateStr === 'number') {
      const d = spreadsheetService.parseExcelDate(dateStr);
      if (d) return new Date(d.y, d.m - 1, d.d).toISOString().split('T')[0];
    }
    const s = String(dateStr).trim();
    const euMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (euMatch) {
      const [, d, m, y] = euMatch;
      return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString().split('T')[0];
    }
    const date = new Date(s);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
  }

  const importFiles = {};

  router.post('/api/import/upload', apiRateLimiter, uploadImport.single('file'), asyncHandler((req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { sheetNames, sheets, workbook } = spreadsheetService.readFile(req.file.path);

    const selectedSheet =
      req.body.sheetName && sheetNames.includes(req.body.sheetName)
        ? req.body.sheetName
        : sheetNames[0];
    const data = spreadsheetService.sheetToJson(sheets[selectedSheet], { header: 1 });

    const fileId = Date.now().toString(36);
    importFiles[fileId] = {
      path: req.file.path,
      workbook,
      uploadedAt: Date.now(),
    };

    res.json({
      fileId,
      filename: req.file.originalname,
      sheetName: selectedSheet,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows: data.slice(1).filter((r) => r.some((c) => c != null && c !== '')),
      totalRows: data.length - 1,
    });

    // Cleanup old entries
    const cutoff = Date.now() - 3600000;
    Object.keys(importFiles).forEach((k) => {
      if (importFiles[k].uploadedAt < cutoff) {
        try {
          fs.unlinkSync(importFiles[k].path);
        } catch (e) {}
        delete importFiles[k];
      }
    });
  }));
  router.use('/api/import/upload', (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
    }
    next(err);
  });
  router.post('/api/import/file-sheet', apiRateLimiter, asyncHandler((req, res) => {
    const { fileId, sheetName, mapping } = req.body;
    const entry = importFiles[fileId];
    if (!entry) return res.status(400).json({ error: 'File session expired. Please re-upload.' });

    const sheetNames = entry.workbook.SheetNames;
    if (!sheetNames.includes(sheetName))
      return res.status(400).json({ error: 'Sheet not found' });

    const sheet = entry.workbook.Sheets[sheetName];
    const data = spreadsheetService.sheetToJson(sheet, { header: 1 });
    const rows = data.slice(1).filter((r) => r.some((c) => c != null && c !== ''));

    // Server-side duplicate detection
    let duplicateCount = 0;
    let duplicateIndices = [];
    if (
      mapping &&
      mapping.description !== undefined &&
      mapping.amount !== undefined &&
      mapping.date !== undefined
    ) {
      const seen = new Map();
      rows.forEach((row, idx) => {
        const desc = (row[mapping.description] || '').toString().toLowerCase().trim();
        const amount = (row[mapping.amount] || '').toString().trim();
        const date = (row[mapping.date] || '').toString().trim();
        if (!desc && !amount && !date) return;
        const key = `${date}|${amount}|${desc}`;
        if (seen.has(key)) {
          duplicateIndices.push(idx);
          const origIdx = seen.get(key);
          if (!duplicateIndices.includes(origIdx)) duplicateIndices.push(origIdx);
        } else {
          seen.set(key, idx);
        }
      });
      duplicateIndices = duplicateIndices.sort((a, b) => a - b);
      duplicateCount = duplicateIndices.length;
    }

    res.json({
      fileId,
      sheetName,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows,
      totalRows: data.length - 1,
      duplicateCount,
      duplicateIndices,
    });

  }));
  router.post('/api/import/googlesheet', apiRateLimiter, asyncHandler((req, res) => {
    const { url, sheetName } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Extract sheet ID and gid from URL
    // URL can be: /d/ID/edit?gid=N#gid=N or just /d/ID/export?format=csv
    const idMatch = (url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return res.status(400).json({ error: 'Invalid Google Sheets URL or ID' });

    const sheetId = idMatch[1];
    // Extract gid from query param ?gid= or URL fragment #gid=
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : null;

    // Strategy 1: CSV export with gid (works for publicly accessible sheets, respects specific sheet tab)
    function tryCsvExport() {
      return new Promise((resolve) => {
        const csvUrl = gid
          ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
          : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then((text) => {
            // Check if it's actually CSV or an error page
            if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
              throw new Error('Sheet is not publicly accessible (got HTML instead of CSV)');
            }
            // Parse CSV manually (handles quoted fields, commas in values)
            const rows = [];
            const lines = text.trim().split('\n');
            for (const line of lines) {
              const cols = [];
              let cur = '';
              let inQuotes = false;
              for (const ch of line) {
                if (ch === '"') {
                  inQuotes = !inQuotes;
                } else if (ch === ',' && !inQuotes) {
                  cols.push(cur.trim().replace(/^"|"$/g, ''));
                  cur = '';
                } else cur += ch;
              }
              cols.push(cur.trim().replace(/^"|"$/g, ''));
              rows.push(cols);
            }
            const headers = rows[0] || [];
            const dataRows = rows.slice(1).filter((r) => r.some((c) => c));
            resolve({
              headers,
              rows: dataRows,
              sheetName: sheetName || 'Sheet1',
            });
          })
          .catch((err) => resolve({ error: err.message }));
      });
    }

    // Strategy 2: Get all sheet names via XLSX export, then fetch CSV for specific sheet
    function tryXlsxAndListSheets() {
      return new Promise((resolve) => {
        fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          })
          .then((buf) => {
            const result = spreadsheetService.readBuffer(buf);
            resolve({ sheetNames: result.sheetNames, workbook: result.workbook });
          })
          .catch((err) => resolve({ error: err.message }));
      });
    }

    // Execute: try CSV first (respects gid), then fall back to XLSX for sheet listing
    (async () => {
      try {
        if (sheetName) {
          // Specific sheet requested — try CSV with gid first, then XLSX workbook
          const csvResult = await tryCsvExport();
          if (!csvResult.error) {
            return res.json({
              headers: csvResult.headers,
              rows: csvResult.rows,
              selectedSheet: csvResult.sheetName,
              sheetNames: [csvResult.sheetName],
            });
          }

          // CSV failed — try XLSX, find the matching sheet by name
          const xlsxResult = await tryXlsxAndListSheets();
          if (xlsxResult.error) {
            return res.status(500).json({
              error:
                'Failed to fetch Google Sheet: ' +
                xlsxResult.error +
                ". Make sure the sheet is shared as 'Anyone with link can view'.",
            });
          }

          const targetSheet = xlsxResult.sheetNames.includes(sheetName)
            ? sheetName
            : xlsxResult.sheetNames[0];
          const sheet = xlsxResult.workbook.Sheets[targetSheet];
          const data = spreadsheetService.sheetToJson(sheet, { header: 1 });
          const headers = (data[0] || []).map(String);
          const rows = data.slice(1).filter((r) => r.some((c) => c != null && c !== ''));
          return res.json({
            headers,
            rows,
            selectedSheet: targetSheet,
            sheetNames: xlsxResult.sheetNames,
          });
        } else {
          // No specific sheet — try CSV first, fall back to XLSX for sheet list
          const csvResult = await tryCsvExport();
          if (!csvResult.error && csvResult.headers.length > 0) {
            return res.json({
              headers: csvResult.headers,
              rows: csvResult.rows,
              selectedSheet: csvResult.sheetName,
              sheetNames: [csvResult.sheetName],
            });
          }

          // CSV failed or returned empty — get sheet names via XLSX
          const xlsxResult = await tryXlsxAndListSheets();
          if (xlsxResult.error) {
            return res.status(500).json({
              error:
                'Failed to fetch Google Sheet: ' +
                xlsxResult.error +
                ". Make sure the sheet is shared as 'Anyone with link can view'.",
            });
          }
          return res.json({
            sheetNames: xlsxResult.sheetNames,
            selectedSheet: xlsxResult.sheetNames[0],
          });
        }
      } catch (err) {
        console.error(err.message);
        logError('error', err);
        res.status(500).json({ error: 'Failed to fetch Google Sheet: ' + err.message });
      }
    })();
  }));
  router.post('/api/import/execute', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const pids = getProfileIds(req);
    const { rows, mapping, categoryTypes, accountTypes, accountBalances, accountBalanceDates } =
      req.body;
    if (!rows || !mapping) return res.status(400).json({ error: 'Missing data' });

    const repos = req.repos;

    // Create accounts for categories marked as 'account' type
    // Also populate a name→accountId map for resolving Means of Payment (FROM) and Category (TO)
    const accountIdMap = new Map();

    // First, add existing accounts to the map so they can be referenced by name
    const existingAccounts = repos.accounts.all(
      `SELECT id, name FROM accounts WHERE profile_id IN (${pids.map(() => '?').join(',')})`,
      ...pids
    );
    for (const acc of existingAccounts) {
      accountIdMap.set(acc.name.toLowerCase(), acc.id);
    }

    if (categoryTypes) {
      for (const [catName, catType] of Object.entries(categoryTypes)) {
        if (catType !== 'account') continue;
        // Skip if account with this name already exists
        if (accountIdMap.has(String(catName).trim().toLowerCase())) continue;
        const accType = (accountTypes && accountTypes[catName]) || 'giro';
        const balance = parseFloat((accountBalances && accountBalances[catName]) || '0') || 0;
        const balanceDate =
          (accountBalanceDates && accountBalanceDates[catName]) ||
          new Date().toISOString().split('T')[0];
        const result = repos.accounts.run(
          'INSERT INTO accounts (name, type, currency, balance, notes, profile_id, starting_balance, starting_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          catName,
          accType,
          'USD',
          balance,
          '',
          pid,
          balance,
          balanceDate
        );
        const accountId = result.lastInsertRowid;
        accountIdMap.set(catName.toLowerCase(), accountId);
        // Record initial balance history
        repos.accounts.run(
          'INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)',
          accountId,
          balance,
          balanceDate
        );
      }
    }

    // Diverse color palette for new categories
    const newCategoryColors = [
      '#ef4444',
      '#f97316',
      '#f59e0b',
      '#eab308',
      '#84cc16',
      '#22c55e',
      '#14b8a6',
      '#06b6d4',
      '#0ea5e9',
      '#3b82f6',
      '#6366f1',
      '#8b5cf6',
      '#a855f7',
      '#d946ef',
      '#ec4899',
      '#f43f5e',
      '#64748b',
      '#78716c',
    ];
    let colorIndex = 0;

    let imported = 0;
    const db = repos.transactions.db;
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const categoryId = (() => {
          const catName = row[mapping.category] || row[mapping.Category] || row[mapping.CATEGORY];
          if (!catName || !String(catName).trim()) return null;
          const existing = repos.categories.get(
            'SELECT id, color FROM categories WHERE LOWER(name) = LOWER(?) AND profile_id = ? LIMIT 1',
            String(catName).trim(),
            pid
          );
          if (existing) return existing.id;
          // Reuse the same diverse color each time a new category is created (consistent within same import)
          const color = newCategoryColors[colorIndex % newCategoryColors.length];
          colorIndex++;
          const icon = getCategoryIcon(String(catName).trim());
          // Use user-specified type, or auto-detect from category name keywords
          const catType =
            (categoryTypes && categoryTypes[catName]) ||
            (() => {
              const lower = String(catName).toLowerCase();
              const incomeKeywords = [
                'salary',
                'income',
                'wages',
                'wage',
                'payroll',
                'revenue',
                'dividend',
                'refund',
                'bonus',
                'paycheck',
                'pay cheque',
                'interest',
                'credit',
                'received',
                'royalt',
                'reimbursement',
              ];
              return incomeKeywords.some((kw) => lower.includes(kw)) ? 'income' : 'expense';
            })();
          const r = repos.categories.run(
            'INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, ?, ?, ?)',
            String(catName).trim(),
            catType,
            color,
            icon,
            pid
          );
          return r.lastInsertRowid;
        })();

        const amountRaw =
          parseFloat(row[mapping.amount] || row[mapping.Amount] || row[mapping.AMOUNT]) || 0;
        const amount = Math.abs(amountRaw);
        const dateRaw =
          row[mapping.date] ||
          row[mapping.Date] ||
          row[mapping.DATE] ||
          new Date().toISOString().split('T')[0];
        const currency =
          row[mapping.currency] || row[mapping.Currency] || row[mapping.CURRENCY] || 'USD';

        // Determine transaction type
        let validatedType;
        const catName = row[mapping.category] || row[mapping.Category] || row[mapping.CATEGORY];
        const catType = catName ? categoryTypes?.[String(catName).trim()] : null;

        if (mapping.type) {
          const rawType = String(row[mapping.type] || '')
            .trim()
            .toLowerCase();
          if (['income', 'expense', 'transfer'].includes(rawType)) {
            validatedType = rawType;
          } else if (catType && (catType === 'income' || catType === 'expense')) {
            validatedType = catType;
          } else {
            // Auto-detect based on amount sign or common keywords
            validatedType =
              amountRaw < 0 ||
              rawType.includes('expense') ||
              rawType.includes('debit') ||
              rawType.includes('spent')
                ? 'expense'
                : amountRaw > 0 ||
                    rawType.includes('income') ||
                    rawType.includes('credit') ||
                    rawType.includes('received')
                  ? 'income'
                  : 'expense';
          }
        } else if (catType && (catType === 'income' || catType === 'expense')) {
          validatedType = catType;
        } else {
          // No type mapped — auto-detect from amount sign
          validatedType = amountRaw < 0 ? 'expense' : amountRaw > 0 ? 'income' : 'expense';
        }

        // Determine account_id from Means of Payment (FROM account)
        const mopName =
          row[mapping.means_of_payment] ||
          row[mapping.MeansOfPayment] ||
          row[mapping.MEANS_OF_PAYMENT] ||
          '';
        const accountId = mopName
          ? accountIdMap.get(String(mopName).trim().toLowerCase()) || null
          : null;

        // Determine transfer_account_id from Category when it's an account type (TO account)
        const catNameForTransfer =
          row[mapping.category] || row[mapping.Category] || row[mapping.CATEGORY];
        const transferAccountId = catNameForTransfer
          ? accountIdMap.get(String(catNameForTransfer).trim().toLowerCase()) || null
          : null;

        repos.transactions.run(
          `INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
            currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id, account_id, transfer_account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row[mapping.description] || row[mapping.Description] || row[mapping.DESCRIPTION] || '',
          amount,
          parseDateString(dateRaw),
          row[mapping.beneficiary] || row[mapping.Beneficiary] || row[mapping.BENEFICIARY] || '',
          row[mapping.payor] || row[mapping.Payor] || row[mapping.PAYOR] || '',
          categoryId,
          currency,
          parseFloat(row[mapping.amount_local] || row[mapping.AmountLocal] || amount) || amount,
          row[mapping.means_of_payment] ||
            row[mapping.MeansOfPayment] ||
            row[mapping.MEANS_OF_PAYMENT] ||
            '',
          parseFloat(row[mapping.exchange_rate] || row[mapping.ExchangeRate] || 1.0) || 1.0,
          validatedType,
          row[mapping.notes] || row[mapping.Notes] || row[mapping.NOTES] || '',
          pid,
          accountId,
          transferAccountId
        );
        imported++;
      }
    });

    insertMany(rows);

    // Recompute account balances from all linked transactions
    for (const [_name, accountId] of accountIdMap) {
      const account = repos.accounts.get(
        'SELECT starting_balance FROM accounts WHERE id = ?',
        accountId
      );
      const startBalance = account ? account.starting_balance || 0 : 0;
      // Money OUT: expense or transfer FROM this account (account_id = this)
      const moneyOut = repos.transactions.get(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type IN ('expense', 'transfer')",
        accountId
      );
      // Money IN: income TO this account (account_id = this, type=income)
      const moneyInDirect = repos.transactions.get(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'income'",
        accountId
      );
      // Money IN: transfer or income TO this account via transfer_account_id
      const moneyInTransfer = repos.transactions.get(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE transfer_account_id = ? AND type IN ('income', 'transfer')",
        accountId
      );
      const computedBalance =
        startBalance -
        (moneyOut.total || 0) +
        (moneyInDirect.total || 0) +
        (moneyInTransfer.total || 0);
      repos.accounts.run(
        'UPDATE accounts SET balance = ? WHERE id = ?',
        Math.round(computedBalance * 100) / 100,
        accountId
      );
    }

    res.json({
      imported,
      accounts_created: accountIdMap.size,
      message: `Successfully imported ${imported} transactions`,
    });

  }));

  return router;
};
