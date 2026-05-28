'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');

module.exports = function ({
  db,
  apiRateLimiter,
  logError,
  spreadsheetService,
  pdfService,
  pdfRenderService,
  requireAuth,
}) {
  const router = express.Router();
  const PORT = process.env.PORT || 3847;

  function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    const commandInjectionPatterns = [
      /[;|&]/,
      /`/,
      /\$\(/,
      /\$\{/,
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
      />\s*(\||>>|>|<|&)/,
      /~\//,
      /etc\/(?:passwd|shadow|group)/,
      /home\/(?:root|admin)/,
      /\/(dev|proc|sys)\//,
      /sudo/,
      /ping\s+-/,
    ];
    for (const pattern of commandInjectionPatterns) {
      if (pattern.test(input)) {
        return '';
      }
    }
    let sanitized = input.replace(/['";\\]/g, '');
    sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    const dangerousSQLPatterns = [
      /DROP\s+TABLE/i,
      /DROP\s+DB/i,
      /DROP\s+DATABASE/i,
      /DELETE\s+FROM/i,
      /INSERT\s+INTO/i,
      /UPDATE\s+\w+/i,
      /TRUNCATE/i,
      /ALTER\s+\w+/i,
      /\.\./i,
      /\*/i,
    ];
    for (const pattern of dangerousSQLPatterns) {
      if (pattern.test(sanitized)) {
        return '';
      }
    }
    return sanitized.trim();
  }

  router.get('/api/reports/monthly-pdf', apiRateLimiter, async (req, res) => {
    try {
      const { year, month } = req.query;
      if (!year || !month) {
        return res.status(400).json({ error: 'year and month are required' });
      }

      // Validate year format (4 digits)
      if (!/^\d{4}$/.test(String(year))) {
        return res.status(400).json({ error: 'Valid year is required' });
      }

      // Validate month format and range (1-12)
      const monthNum = parseInt(month, 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ error: 'Valid month (1-12) is required' });
      }

      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const monthName = monthNames[parseInt(month) - 1] || month;

      // Fetch settings for currency
      const settings = db
        .prepare(
          `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
        )
        .get(...pids);
      const currency = settings ? settings.value : 'EUR';

      // Fetch transactions for the month
      const transactions = db
        .prepare(
          `
      SELECT t.date, t.amount, t.description, c.name as cat_name, c.type as cat_type, c.color as cat_color, t.type as tx_type
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.date
    `
        )
        .all(...pids, startStr, endStr);

      // Aggregate by category
      const incomeByCat = {};
      const expenseByCat = {};
      let totalIncome = 0;
      let totalExpenses = 0;

      transactions.forEach((tx) => {
        const amt = Math.abs(parseFloat(tx.amount) || 0);
        const catName = tx.cat_name || 'Uncategorized';
        const catColor = tx.cat_color || (tx.tx_type === 'income' ? '#059669' : '#dc2626');

        if (tx.tx_type === 'income') {
          totalIncome += amt;
          if (!incomeByCat[catName])
            incomeByCat[catName] = { name: catName, color: catColor, total: 0 };
          incomeByCat[catName].total += amt;
        } else {
          totalExpenses += amt;
          if (!expenseByCat[catName])
            expenseByCat[catName] = { name: catName, color: catColor, total: 0 };
          expenseByCat[catName].total += amt;
        }
      });

      const netSavings = totalIncome - totalExpenses;

      // Prepare data for export page
      const theme = req.query.theme === 'dark' ? 'dark' : 'light';
      const exportData = {
        yearMonth: `${year}-${String(month).padStart(2, '0')}`,
        currency,
        theme,
        summary: { totalIncome, totalExpense: totalExpenses, netSavings },
        incomeByCategory: Object.values(incomeByCat).sort((a, b) => b.total - a.total),
        expenseByCategory: Object.values(expenseByCat).sort((a, b) => b.total - a.total),
      };

      // --- Use puppeteer to render and export as PDF directly ---
      let pdfBuffer = null;

      pdfBuffer = await pdfRenderService.renderToPdf(exportData, {
        pagePath: '/export-monthly.html',
        basePort: PORT,
        viewport: { width: 800, height: 1000, deviceScaleFactor: 2 },
        pdfMargin: { top: '15px', right: '15px', bottom: '15px', left: '15px' },
      });

      // --- Return the PDF directly ---
      if (pdfBuffer && pdfBuffer.length > 1000) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="report-${year}-${String(month).padStart(2, '0')}.pdf"`
        );
        return res.send(pdfBuffer);
      }

      // Fallback: text-only PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="report-${year}-${String(month).padStart(2, '0')}.pdf"`
      );

      const doc = pdfService.createDocument({ margin: 50 });
      doc.pipe(res);

      const titleColor = '#1e293b';
      const headerBg = '#1e293b';
      const incomeColor = '#059669';
      const expenseColor = '#dc2626';
      const borderColor = '#e2e8f0';
      const mutedColor = '#64748b';

      function formatCurrencyPdf(amount, curr) {
        const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
        const sym = symbols[curr] || curr + ' ';
        return sym + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }

      doc
        .fillColor(titleColor)
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('Monthly Financial Report', { align: 'center' });
      doc.moveDown(0.3);
      doc
        .fillColor(mutedColor)
        .fontSize(13)
        .font('Helvetica')
        .text(`${monthName} ${year}`, { align: 'center' });
      doc.moveDown(0.8);

      const boxY = doc.y;
      const boxW = doc.page.width - 100;
      const colW = boxW / 3;

      doc.rect(50, boxY, boxW, 60).fill('#f8fafc');
      doc.rect(50, boxY, boxW, 60).stroke(borderColor);

      doc
        .moveTo(50 + colW, boxY)
        .lineTo(50 + colW, boxY + 60)
        .stroke(borderColor);
      doc
        .moveTo(50 + colW * 2, boxY)
        .lineTo(50 + colW * 2, boxY + 60)
        .stroke(borderColor);

      doc
        .fillColor(incomeColor)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('Total Income', 50, boxY + 10, { width: colW, align: 'center' });
      doc
        .fillColor(incomeColor)
        .fontSize(14)
        .font('Helvetica-Bold')
        .text(formatCurrencyPdf(totalIncome, currency), 50, boxY + 28, {
          width: colW,
          align: 'center',
        });

      doc
        .fillColor(expenseColor)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('Total Expenses', 50 + colW, boxY + 10, { width: colW, align: 'center' });
      doc
        .fillColor(expenseColor)
        .fontSize(14)
        .font('Helvetica-Bold')
        .text(formatCurrencyPdf(totalExpenses, currency), 50 + colW, boxY + 28, {
          width: colW,
          align: 'center',
        });

      doc
        .fillColor(netSavings >= 0 ? incomeColor : expenseColor)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('Net Savings', 50 + colW * 2, boxY + 10, { width: colW, align: 'center' });
      doc
        .fillColor(netSavings >= 0 ? incomeColor : expenseColor)
        .fontSize(14)
        .font('Helvetica-Bold')
        .text(formatCurrencyPdf(netSavings, currency), 50 + colW * 2, boxY + 28, {
          width: colW,
          align: 'center',
        });

      doc.y = boxY + 70;

      if (Object.keys(incomeByCat).length > 0) {
        doc.moveDown(0.5);
        doc.fillColor(headerBg).fontSize(12).font('Helvetica-Bold').text('Income');
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .strokeColor(borderColor)
          .stroke();
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');
        const sortedIncome = Object.entries(incomeByCat).sort((a, b) => b[1].total - a[1].total);
        sortedIncome.forEach(([cat, data]) => {
          doc
            .fillColor(incomeColor)
            .text(`${formatCurrencyPdf(data.total, currency)}  `, { continued: true });
          doc.fillColor(titleColor).text(cat);
        });
      }

      if (Object.keys(expenseByCat).length > 0) {
        doc.moveDown(0.5);
        doc.fillColor(headerBg).fontSize(12).font('Helvetica-Bold').text('Expenses');
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .strokeColor(borderColor)
          .stroke();
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');
        const sortedExpenses = Object.entries(expenseByCat).sort((a, b) => b[1].total - a[1].total);
        sortedExpenses.forEach(([cat, data]) => {
          const pct = totalExpenses > 0 ? ((data.total / totalExpenses) * 100).toFixed(1) : '0.0';
          doc
            .fillColor(expenseColor)
            .text(`${formatCurrencyPdf(data.total, currency)}  (${pct}%)  `, { continued: true });
          doc.fillColor(titleColor).text(cat);
        });
      }

      if (Object.keys(incomeByCat).length === 0 && Object.keys(expenseByCat).length === 0) {
        doc.moveDown(1);
        doc
          .fillColor(mutedColor)
          .fontSize(11)
          .font('Helvetica')
          .text('No transactions found for this period.', { align: 'center' });
      }

      doc.moveDown(2);
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, {
          align: 'center',
        });

      doc.end();
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // YEAR-END TAX SUMMARY
  // =====================

  // JSON tax summary
  router.get('/api/reports/tax-summary', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const { year } = req.query;
      if (!year) return res.status(400).json({ error: 'year is required' });

      const startStr = `${year}-01-01`;
      const endStr = `${year}-12-31`;

      const rows = db
        .prepare(
          `
      SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
      ORDER BY c.tax_deductible DESC, c.name, t.date
    `
        )
        .all(...pids, startStr, endStr);

      const taxDeductible = rows.filter((r) => r.tax_deductible);
      const nonDeductible = rows.filter((r) => !r.tax_deductible);

      const byCategory = (rows) => {
        const map = {};
        rows.forEach((r) => {
          if (!map[r.category_name]) map[r.category_name] = { total: 0, transactions: [] };
          map[r.category_name].total += r.amount;
          map[r.category_name].transactions.push({
            id: r.id,
            date: r.date,
            description: r.description,
            amount: r.amount,
            currency: r.currency,
          });
        });
        return map;
      };

      res.json({
        year: parseInt(year),
        taxDeductibleTotal: taxDeductible.reduce((s, r) => s + r.amount, 0),
        nonDeductibleTotal: nonDeductible.reduce((s, r) => s + r.amount, 0),
        totalExpenses: rows.reduce((s, r) => s + r.amount, 0),
        taxDeductibleCategories: byCategory(taxDeductible),
        nonDeductibleCategories: byCategory(nonDeductible),
        transactionCount: rows.length,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Year-end tax summary PDF
  router.get('/api/reports/tax-summary-pdf', apiRateLimiter, (req, res) => {
    try {
      const { year } = req.query;
      if (!year || !/^\d{4}$/.test(String(year))) {
        return res.status(400).json({ error: 'Valid year is required' });
      }

      const startStr = `${year}-01-01`;
      const endStr = `${year}-12-31`;
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');

      const rows = db
        .prepare(
          `
      SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
      ORDER BY c.tax_deductible DESC, c.name, t.date
    `
        )
        .all(...pids, startStr, endStr);

      const taxRows = rows.filter((r) => r.tax_deductible);
      const nonRows = rows.filter((r) => !r.tax_deductible);

      const currency =
        db
          .prepare(
            `SELECT value FROM settings WHERE key='local_currency' AND profile_id IN (${inClause}) ORDER BY profile_id DESC LIMIT 1`
          )
          .get(...pids)?.value || 'USD';
      const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
      const fmt = (amt) =>
        (symbols[currency] || currency + ' ') +
        amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      const taxTotal = taxRows.reduce((s, r) => s + r.amount, 0);
      const nonTotal = nonRows.reduce((s, r) => s + r.amount, 0);
      const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

      const doc = pdfService.createDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="tax-summary-${year}.pdf"`);
      doc.pipe(res);

      // Colors
      const titleColor = '#1e293b';
      const headerBg = '#f1f5f9';
      const borderColor = '#cbd5e1';
      const taxColor = '#16a34a';
      const nonTaxColor = '#94a3b8';
      const mutedColor = '#64748b';
      const positiveColor = '#059669';

      // Header
      doc
        .fillColor(titleColor)
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(`Year-End Tax Summary — ${year}`, 50, 50);
      doc.moveDown(0.5);
      doc
        .fillColor(mutedColor)
        .fontSize(10)
        .font('Helvetica')
        .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, 50, doc.y);
      doc.moveDown(2);

      // Summary box
      const colW = (doc.page.width - 100) / 3;
      const boxY = doc.y;
      doc
        .rect(50, boxY, doc.page.width - 100, 70)
        .fillColor(headerBg)
        .fill();
      doc
        .strokeColor(borderColor)
        .rect(50, boxY, doc.page.width - 100, 70)
        .stroke();

      doc
        .fillColor(taxColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Tax-Deductible Expenses', 50, boxY + 8, { width: colW, align: 'center' });
      doc
        .fillColor(taxColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(fmt(taxTotal), 50, boxY + 28, { width: colW, align: 'center' });
      const taxPct = grandTotal > 0 ? ((taxTotal / grandTotal) * 100).toFixed(1) : '0.0';
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`${taxPct}% of total`, 50, boxY + 50, { width: colW, align: 'center' });

      doc
        .fillColor(nonTaxColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Non-Deductible Expenses', 50 + colW, boxY + 8, { width: colW, align: 'center' });
      doc
        .fillColor(nonTaxColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(fmt(nonTotal), 50 + colW, boxY + 28, { width: colW, align: 'center' });
      const nonPct = grandTotal > 0 ? ((nonTotal / grandTotal) * 100).toFixed(1) : '0.0';
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`${nonPct}% of total`, 50 + colW, boxY + 50, { width: colW, align: 'center' });

      doc
        .fillColor(titleColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Total Expenses', 50 + colW * 2, boxY + 8, { width: colW, align: 'center' });
      doc
        .fillColor(titleColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(fmt(grandTotal), 50 + colW * 2, boxY + 28, { width: colW, align: 'center' });
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`${taxRows.length + nonRows.length} transactions`, 50 + colW * 2, boxY + 50, {
          width: colW,
          align: 'center',
        });

      doc.y = boxY + 85;
      doc.moveDown(1);

      // Tax-deductible section
      const drawSection = (title, color, catRows) => {
        doc.fillColor(color).fontSize(12).font('Helvetica-Bold').text(title);
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .strokeColor(borderColor)
          .stroke();
        doc.moveDown(0.3);

        if (catRows.length === 0) {
          doc
            .fillColor(mutedColor)
            .fontSize(10)
            .font('Helvetica')
            .text('No transactions in this category.');
          doc.moveDown(1);
          return;
        }

        // Group by category
        const byCat = {};
        catRows.forEach((r) => {
          if (!byCat[r.category_name]) byCat[r.category_name] = { total: 0, count: 0 };
          byCat[r.category_name].total += r.amount;
          byCat[r.category_name].count++;
        });

        // Table header
        doc
          .fillColor(mutedColor)
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('Category', 50, doc.y, { width: 220 })
          .text('Transactions', 270, doc.y, { width: 100 })
          .text('Amount', 370, doc.y, { width: 120 });
        doc.moveDown(0.4);
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .strokeColor(borderColor)
          .stroke();
        doc.moveDown(0.4);

        doc.fontSize(10).font('Helvetica');
        Object.entries(byCat).forEach(([cat, data]) => {
          doc
            .fillColor(titleColor)
            .text(cat, 50, doc.y, { width: 220 })
            .fillColor(mutedColor)
            .text(String(data.count), 270, doc.y, { width: 100 })
            .fillColor(color)
            .text(fmt(data.total), 370, doc.y, { width: 120 });
          doc.moveDown(0.3);
        });

        doc.moveDown(0.5);
      };

      drawSection('Tax-Deductible Expenses', taxColor, taxRows);
      drawSection('Non-Deductible Expenses', nonTaxColor, nonRows);

      // Footer
      doc.moveDown(2);
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(
          'This report is for informational purposes only. Consult a tax professional for official filings.',
          { align: 'center' }
        );

      doc.end();
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // YEAR-END P&L REPORT
  // =====================

  // JSON P&L summary
  router.get('/api/reports/pl-summary', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const { year } = req.query;
      if (!year) return res.status(400).json({ error: 'year is required' });

      const startStr = `${year}-01-01`;
      const endStr = `${year}-12-31`;

      const rows = db
        .prepare(
          `
      SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.type, c.name, t.date
    `
        )
        .all(...pids, startStr, endStr);

      const income = rows.filter((r) => r.type === 'income');
      const expenses = rows.filter((r) => r.type === 'expense');

      const byCategory = (txs) => {
        const map = {};
        txs.forEach((r) => {
          if (!map[r.category_name]) map[r.category_name] = { total: 0, count: 0 };
          map[r.category_name].total += r.amount;
          map[r.category_name].count++;
        });
        return map;
      };

      const incomeTotal = income.reduce((s, r) => s + r.amount, 0);
      const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0);

      res.json({
        year: parseInt(year),
        income: { total: incomeTotal, byCategory: byCategory(income) },
        expenses: { total: expenseTotal, byCategory: byCategory(expenses) },
        netSavings: incomeTotal - expenseTotal,
        savingsRate:
          incomeTotal > 0
            ? parseFloat((((incomeTotal - expenseTotal) / incomeTotal) * 100).toFixed(1))
            : 0,
        transactionCount: rows.length,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Year-end P&L PDF
  router.get('/api/reports/pl-summary-pdf', apiRateLimiter, (req, res) => {
    try {
      const { year } = req.query;
      if (!year || !/^\d{4}$/.test(String(year))) {
        return res.status(400).json({ error: 'Valid year is required' });
      }

      const startStr = `${year}-01-01`;
      const endStr = `${year}-12-31`;
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');

      const rows = db
        .prepare(
          `
      SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.type, c.name, t.date
    `
        )
        .all(...pids, startStr, endStr);

      const incomeRows = rows.filter((r) => r.type === 'income');
      const expenseRows = rows.filter((r) => r.type === 'expense');

      const currency =
        db
          .prepare(
            `SELECT value FROM settings WHERE key='local_currency' AND profile_id IN (${inClause}) ORDER BY profile_id DESC LIMIT 1`
          )
          .get(...pids)?.value || 'USD';
      const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
      const fmt = (amt) =>
        (symbols[currency] || currency + ' ') +
        amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      const incomeTotal = incomeRows.reduce((s, r) => s + r.amount, 0);
      const expenseTotal = expenseRows.reduce((s, r) => s + r.amount, 0);
      const netSavings = incomeTotal - expenseTotal;
      const savingsRate = incomeTotal > 0 ? ((incomeTotal - expenseTotal) / incomeTotal) * 100 : 0;

      const doc = pdfService.createDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pl-summary-${year}.pdf"`);
      doc.pipe(res);

      const titleColor = '#1e293b';
      const headerBg = '#f1f5f9';
      const borderColor = '#cbd5e1';
      const incomeColor = '#059669';
      const expenseColor = '#dc2626';
      const mutedColor = '#64748b';
      const netColor = netSavings >= 0 ? '#059669' : '#dc2626';

      // Header
      doc
        .fillColor(titleColor)
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(`Year-End P&L Summary — ${year}`, 50, 50);
      doc.moveDown(0.5);
      doc
        .fillColor(mutedColor)
        .fontSize(10)
        .font('Helvetica')
        .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, 50, doc.y);
      doc.moveDown(2);

      // Summary box
      const colW = (doc.page.width - 100) / 3;
      const boxY = doc.y;
      doc
        .rect(50, boxY, doc.page.width - 100, 70)
        .fillColor(headerBg)
        .fill();
      doc
        .strokeColor(borderColor)
        .rect(50, boxY, doc.page.width - 100, 70)
        .stroke();

      doc
        .fillColor(incomeColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Total Income', 50, boxY + 8, { width: colW, align: 'center' });
      doc
        .fillColor(incomeColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(fmt(incomeTotal), 50, boxY + 28, { width: colW, align: 'center' });
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`${incomeRows.length} transactions`, 50, boxY + 50, { width: colW, align: 'center' });

      doc
        .fillColor(expenseColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Total Expenses', 50 + colW, boxY + 8, { width: colW, align: 'center' });
      doc
        .fillColor(expenseColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(fmt(expenseTotal), 50 + colW, boxY + 28, { width: colW, align: 'center' });
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`${expenseRows.length} transactions`, 50 + colW, boxY + 50, {
          width: colW,
          align: 'center',
        });

      doc
        .fillColor(netColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Net Savings', 50 + colW * 2, boxY + 8, { width: colW, align: 'center' });
      doc
        .fillColor(netColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(fmt(netSavings), 50 + colW * 2, boxY + 28, { width: colW, align: 'center' });
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`Savings rate: ${savingsRate.toFixed(1)}%`, 50 + colW * 2, boxY + 50, {
          width: colW,
          align: 'center',
        });

      doc.y = boxY + 85;
      doc.moveDown(1);

      // Helper: draw section
      const drawSection = (title, color, catRows, total) => {
        doc.fillColor(titleColor).fontSize(12).font('Helvetica-Bold').text(title);
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .strokeColor(borderColor)
          .stroke();
        doc.moveDown(0.3);

        if (catRows.length === 0) {
          doc.fillColor(mutedColor).fontSize(10).font('Helvetica').text('No transactions.');
          doc.moveDown(0.5);
          return;
        }

        const byCat = {};
        catRows.forEach((r) => {
          if (!byCat[r.category_name]) byCat[r.category_name] = { total: 0, count: 0 };
          byCat[r.category_name].total += r.amount;
          byCat[r.category_name].count++;
        });

        doc
          .fillColor(mutedColor)
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('Category', 50, doc.y, { width: 220 })
          .text('Transactions', 270, doc.y, { width: 100 })
          .text('Amount', 370, doc.y, { width: 120 })
          .text('% of Total', 470, doc.y, { width: 70 });
        doc.moveDown(0.4);
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .strokeColor(borderColor)
          .stroke();
        doc.moveDown(0.4);

        doc.fontSize(10).font('Helvetica');
        Object.entries(byCat)
          .sort((a, b) => b[1].total - a[1].total)
          .forEach(([cat, data]) => {
            const pct = total > 0 ? ((data.total / total) * 100).toFixed(1) : '0.0';
            doc
              .fillColor(titleColor)
              .text(cat, 50, doc.y, { width: 220 })
              .fillColor(mutedColor)
              .text(String(data.count), 270, doc.y, { width: 100 })
              .fillColor(color)
              .text(fmt(data.total), 370, doc.y, { width: 120 })
              .fillColor(mutedColor)
              .text(`${pct}%`, 470, doc.y, { width: 70 });
            doc.moveDown(0.3);
          });

        // Total row
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold');
        doc
          .fillColor(titleColor)
          .text('Total', 50, doc.y, { width: 220 })
          .fillColor(mutedColor)
          .text(String(Object.values(byCat).reduce((s, d) => s + d.count, 0)), 270, doc.y, {
            width: 100,
          })
          .fillColor(color)
          .text(fmt(total), 370, doc.y, { width: 120 })
          .fillColor(mutedColor)
          .text('100.0%', 470, doc.y, { width: 70 });
        doc.font('Helvetica');
        doc.moveDown(1);
      };

      drawSection('Income', incomeColor, incomeRows, incomeTotal);
      drawSection('Expenses', expenseColor, expenseRows, expenseTotal);

      // Footer
      doc.moveDown(2);
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(
          `Total: ${rows.length} transactions | Net Savings: ${fmt(netSavings)} (${savingsRate.toFixed(1)}% savings rate)`,
          { align: 'center' }
        );

      doc.end();
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // CUSTOM REPORT
  // =============
  // Accepts custom report name - sanitized to prevent command injection
  router.post('/api/reports/custom', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const { name, type } = req.body;
      // Sanitize name to prevent command injection
      const sanitizedName = sanitizeInput(name || 'Custom Report');
      if (!sanitizedName || sanitizedName.trim().length < 1) {
        return res.status(400).json({ error: 'Invalid report name' });
      }
      res.json({
        reportId: Date.now(),
        name: sanitizedName,
        type: type || 'custom',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ANNUAL FINANCIAL REPORT PDF
  // ============================
  // Uses puppeteer to render charts via a dedicated export page, then embeds screenshot in PDF
  router.get('/api/reports/annual-pdf', apiRateLimiter, async (req, res) => {
    try {
      const { year } = req.query;

      if (!year || !/^\d{4}$/.test(String(year))) {
        return res.status(400).json({ error: 'Valid year is required' });
      }

      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');

      // --- Fetch all data server-side ---
      const currencyRow = db
        .prepare(
          `SELECT value FROM settings WHERE key='local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
        )
        .get(...pids);
      const currency = currencyRow?.value || 'USD';

      // Category breakdown (for doughnut chart)
      const byCategory = db
        .prepare(
          `
      SELECT c.name, c.color, SUM(COALESCE(t.amount_local, t.amount)) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY c.id
      ORDER BY total DESC
    `
        )
        .all(...pids, `${year}-01-01`, `${year}-12-31`);

      // Monthly data for bar and line charts + breakdown table
      const monthly = db
        .prepare(
          `
      SELECT strftime('%m', date) as month_num,
             type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month_num, type
      ORDER BY month_num
    `
        )
        .all(...pids, `${year}-01-01`, `${year}-12-31`);

      const monthlyMap = {};
      for (let m = 1; m <= 12; m++) {
        monthlyMap[String(m).padStart(2, '0')] = { income: 0, expense: 0 };
      }
      for (const r of monthly) {
        if (r.type === 'income') monthlyMap[r.month_num].income = r.total;
        if (r.type === 'expense') monthlyMap[r.month_num].expense = r.total;
      }

      const monthlyArr = Object.entries(monthlyMap).map(([m, v]) => ({
        month: `${year}-${m}`,
        income: v.income,
        expense: v.expense,
      }));

      let totalIncome = 0,
        totalExpenses = 0;
      let running = 0;
      const cashFlow = [];
      for (const row of monthlyArr) {
        totalIncome += row.income;
        totalExpenses += row.expense;
        running += row.income - row.expense;
        cashFlow.push({ month: row.month, cumulative: running });
      }

      const netSavings = totalIncome - totalExpenses;
      const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

      // Prepare data for the export page
      const theme = req.query.theme === 'dark' ? 'dark' : 'light';
      const exportData = {
        year: parseInt(year),
        currency,
        theme,
        summary: { totalIncome, totalExpense: totalExpenses, netSavings, savingsRate },
        byCategory,
        monthly: monthlyArr,
        cashFlow,
      };

      // --- Use puppeteer to render and export as PDF directly ---
      let pdfBuffer = null;

      pdfBuffer = await pdfRenderService.renderToPdf(exportData, {
        pagePath: '/export.html',
        basePort: PORT,
        viewport: { width: 900, height: 1200, deviceScaleFactor: 2 },
        pdfMargin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
      });

      // --- Return the PDF directly ---
      if (pdfBuffer && pdfBuffer.length > 1000) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="annual-report-${year}.pdf"`);
        return res.send(pdfBuffer);
      }

      // Fallback: if puppeteer failed, generate text-only PDF
      const doc = pdfService.createDocument({ margin: 40 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="annual-report-${year}.pdf"`);
      doc.pipe(res);

      const titleColor = '#1e293b';
      const headerBg = '#f1f5f9';
      const borderColor = '#cbd5e1';
      const incomeColor = '#059669';
      const expenseColor = '#dc2626';
      const mutedColor = '#64748b';
      const netColor = netSavings >= 0 ? '#059669' : '#dc2626';
      const pageW = doc.page.width - 80;
      const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
      const fmt = (amt) =>
        (symbols[currency] || currency + ' ') +
        amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      // Header
      doc
        .fillColor(titleColor)
        .fontSize(22)
        .font('Helvetica-Bold')
        .text(`Annual Financial Report \u2014 ${year}`, 50, 50, { width: pageW, align: 'center' });
      doc.moveDown(0.3);
      doc
        .fillColor(mutedColor)
        .fontSize(11)
        .font('Helvetica')
        .text(`Finance Manager  |\u00a0 Generated: ${new Date().toLocaleDateString()}`, {
          align: 'center',
        });

      doc.moveDown(0.5);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();

      // P&L Summary box
      const boxH = 65;
      const boxY = doc.y + 10;
      const colW = pageW / 3;

      doc.fillColor(headerBg).rect(50, boxY, pageW, boxH).fill();
      doc.strokeColor(borderColor).rect(50, boxY, pageW, boxH).stroke();

      doc.y = boxY + 10;
      doc
        .fillColor(titleColor)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`${year} Annual Summary`, 50, doc.y, { width: pageW, align: 'center' });
      doc.y += 14;

      doc.fontSize(10).font('Helvetica');
      doc
        .fillColor(incomeColor)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Total Income', 50 + 10, doc.y, { width: colW, align: 'center' });
      doc
        .fillColor(incomeColor)
        .fontSize(14)
        .text(fmt(totalIncome), 50 + 10, doc.y + 14, { width: colW, align: 'center' });

      doc
        .fillColor(expenseColor)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Total Expenses', 50 + colW + 10, doc.y, { width: colW, align: 'center' });
      doc
        .fillColor(expenseColor)
        .fontSize(14)
        .text(fmt(totalExpenses), 50 + colW + 10, doc.y + 14, { width: colW, align: 'center' });

      doc
        .fillColor(netColor)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Net Savings', 50 + colW * 2 + 10, doc.y, { width: colW, align: 'center' });
      doc
        .fillColor(netColor)
        .fontSize(14)
        .text(fmt(netSavings), 50 + colW * 2 + 10, doc.y + 14, { width: colW, align: 'center' });

      // Note about charts
      doc.moveDown(2);
      doc.addPage();
      doc
        .fillColor(mutedColor)
        .fontSize(12)
        .font('Helvetica')
        .text(
          'Note: Charts could not be rendered in this session. Please try again later.',
          50,
          doc.y,
          { width: pageW, align: 'center' }
        );

      // Monthly Breakdown Table — start on a fresh page
      doc.addPage();
      doc.y = 50;
      doc.moveDown(0.5);
      doc.fillColor(titleColor).fontSize(13).font('Helvetica-Bold').text('Monthly Breakdown');
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const tcol = { month: 90, income: 120, expense: 120, net: 110, balance: 110 };
      const rowH = 18;
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];

      doc.fillColor(headerBg).rect(50, tableTop, pageW, rowH).fill();
      doc.strokeColor(borderColor).rect(50, tableTop, pageW, rowH).stroke();
      doc.fillColor(titleColor).fontSize(9).font('Helvetica-Bold');
      doc.text('Month', 54, tableTop + 5, { width: tcol.month, align: 'left' });
      doc.text('Income', 54 + tcol.month, tableTop + 5, { width: tcol.income, align: 'right' });
      doc.text('Expenses', 54 + tcol.month + tcol.income, tableTop + 5, {
        width: tcol.expense,
        align: 'right',
      });
      doc.text('Net', 54 + tcol.month + tcol.income + tcol.expense, tableTop + 5, {
        width: tcol.net,
        align: 'right',
      });
      doc.text('Balance', 54 + tcol.month + tcol.income + tcol.expense + tcol.net, tableTop + 5, {
        width: tcol.balance,
        align: 'right',
      });

      let runningBal = 0;
      for (let m = 1; m <= 12; m++) {
        const monthStr = String(m).padStart(2, '0');
        const inc = monthlyMap[monthStr].income;
        const exp = monthlyMap[monthStr].expense;
        const net = inc - exp;
        runningBal += net;

        const rowY = tableTop + rowH * m;
        const bg = m % 2 === 0 ? '#f8fafc' : '#ffffff';
        doc.fillColor(bg).rect(50, rowY, pageW, rowH).fill();
        doc.strokeColor(borderColor).rect(50, rowY, pageW, rowH).stroke();

        doc.fillColor(titleColor).fontSize(9).font('Helvetica');
        doc.text(monthNames[m - 1], 54, rowY + 4, { width: tcol.month, align: 'left' });
        doc
          .fillColor(incomeColor)
          .fontSize(9)
          .text(inc.toFixed(2), 54 + tcol.month, rowY + 4, { width: tcol.income, align: 'right' });
        doc
          .fillColor(expenseColor)
          .fontSize(9)
          .text(exp.toFixed(2), 54 + tcol.month + tcol.income, rowY + 4, {
            width: tcol.expense,
            align: 'right',
          });
        doc
          .fillColor(net >= 0 ? incomeColor : expenseColor)
          .fontSize(9)
          .text(net.toFixed(2), 54 + tcol.month + tcol.income + tcol.expense, rowY + 4, {
            width: tcol.net,
            align: 'right',
          });
        doc
          .fillColor(runningBal >= 0 ? incomeColor : expenseColor)
          .fontSize(9)
          .text(
            runningBal.toFixed(2),
            54 + tcol.month + tcol.income + tcol.expense + tcol.net,
            rowY + 4,
            { width: tcol.balance, align: 'right' }
          );
      }

      doc.y = Math.max(doc.y, tableTop + rowH * 13) + 20;
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica')
        .text(`Generated by Finance Manager \u2014 ${new Date().toLocaleDateString()}`, {
          align: 'center',
        });

      doc.end();
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
