const express = require('express');
const { getProfileId } = require('../middleware/profile');

// 2025 US Federal tax brackets (simplified)
const FEDERAL_BRACKETS = {
  single: [
    { rate: 0.1, upTo: 11600 },
    { rate: 0.12, upTo: 47150 },
    { rate: 0.22, upTo: 100525 },
    { rate: 0.24, upTo: 191950 },
    { rate: 0.32, upTo: 243725 },
    { rate: 0.35, upTo: 609350 },
    { rate: 0.37, upTo: Infinity },
  ],
  married_joint: [
    { rate: 0.1, upTo: 23200 },
    { rate: 0.12, upTo: 94300 },
    { rate: 0.22, upTo: 201050 },
    { rate: 0.24, upTo: 383900 },
    { rate: 0.32, upTo: 487450 },
    { rate: 0.35, upTo: 731200 },
    { rate: 0.37, upTo: Infinity },
  ],
  head_of_household: [
    { rate: 0.1, upTo: 16550 },
    { rate: 0.12, upTo: 63100 },
    { rate: 0.22, upTo: 100500 },
    { rate: 0.24, upTo: 191950 },
    { rate: 0.32, upTo: 243700 },
    { rate: 0.35, upTo: 609350 },
    { rate: 0.37, upTo: Infinity },
  ],
};

const STATE_TAX_RATES = {
  CA: 0.093,
  NY: 0.0685,
  TX: 0,
  FL: 0,
  WA: 0,
  IL: 0.0495,
  MA: 0.05,
  PA: 0.0307,
  NJ: 0.0637,
  OH: 0.0399,
};

const VALID_STATES = Object.keys(STATE_TAX_RATES);
const VALID_FILING_STATUSES = ['single', 'married_joint', 'head_of_household'];

function calculateFederalTax(income, filingStatus) {
  const brackets = FEDERAL_BRACKETS[filingStatus] || FEDERAL_BRACKETS.single;
  let tax = 0;
  let remaining = income;
  let previousUpTo = 0;

  for (const bracket of brackets) {
    const taxableInBracket = Math.min(remaining, bracket.upTo - previousUpTo);
    if (taxableInBracket <= 0) break;
    tax += taxableInBracket * bracket.rate;
    remaining -= taxableInBracket;
    previousUpTo = bracket.upTo;
  }

  return Math.round(tax * 100) / 100;
}

module.exports = function ({ db, apiRateLimiter, logError, requireAuth }) {
  const router = express.Router();

  // ── Tax Summary ──────────────────────────────────────────────────────
  router.get('/api/tax/summary', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const year = req.query.year || new Date().getFullYear();
    const exportFormat = req.query.export;

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // Get total income
    const incomeRows = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`
      )
      .get(pid, startDate, endDate);
    const totalIncome = incomeRows.total || 0;

    // Get total deductions (transactions marked as deduction)
    const deductionRows = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE profile_id = ? AND type = 'deduction' AND date >= ? AND date <= ?`
      )
      .get(pid, startDate, endDate);
    const totalDeductions = deductionRows.total || 0;

    const taxableIncome = totalIncome - totalDeductions;

    // PDF export
    if (exportFormat === 'pdf') {
      const { createDocument } = require('../services/pdfService');
      const doc = createDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="tax-summary-${year}.pdf"`);
        res.send(pdf);
      });
      doc.fontSize(18).text(`Tax Summary ${year}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Total Income: $${totalIncome.toFixed(2)}`);
      doc.text(`Total Deductions: $${totalDeductions.toFixed(2)}`);
      doc.text(`Taxable Income: $${taxableIncome.toFixed(2)}`);
      doc.end();
      return;
    }

    const response = { totalIncome, totalDeductions, taxableIncome, year };

    if (req.query.includeBreakdown === 'true') {
      const breakdown = db
        .prepare(
          `SELECT description, amount, date, type FROM transactions
           WHERE profile_id = ? AND date >= ? AND date <= ? AND (type = 'income' OR type = 'deduction')
           ORDER BY date DESC`
        )
        .all(pid, startDate, endDate);
      response.breakdown = breakdown;
    }

    res.json(response);

  }));

  // ── Tax Deductions ───────────────────────────────────────────────────
  router.get('/api/tax/deductions', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { category, startDate, endDate } = req.query;

    let query = `SELECT * FROM transactions WHERE profile_id = ? AND type = 'deduction'`;
    const params = [pid];

    if (category) {
      query += ` AND category_id = (SELECT id FROM categories WHERE name = ? AND profile_id = ?)`;
      params.push(category, pid);
    }
    if (startDate) {
      query += ` AND date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND date <= ?`;
      params.push(endDate);
    }

    const deductions = db.prepare(query).all(...params);
    const totalDeductions = deductions.reduce((sum, d) => sum + (d.amount || 0), 0);

    res.json({ totalDeductions, deductions, count: deductions.length });

  }));

  // ── Tax Income ───────────────────────────────────────────────────────
  router.get('/api/tax/income', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { type } = req.query;

    let query = `SELECT * FROM transactions WHERE profile_id = ? AND type = 'income'`;
    const params = [pid];

    if (type) {
      query += ` AND description LIKE ?`;
      params.push(`%${type}%`);
    }

    const incomeRows = db.prepare(query).all(...params);
    const totalIncome = incomeRows.reduce((sum, r) => sum + (r.amount || 0), 0);

    res.json({ totalIncome, incomeRows, count: incomeRows.length });

  }));

  // ── Tax Estimate ─────────────────────────────────────────────────────
  const estimateCounter = { value: 0 };
  const estimateStore = new Map();

  router.post('/api/tax/estimates', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const { annualIncome, filingStatus, state, export: exportFormat } = req.body;

    if (annualIncome === undefined || annualIncome === null || isNaN(parseFloat(annualIncome)) || parseFloat(annualIncome) < 0)
      return res.status(400).json({ error: 'Annual income must be a non-negative number' });
    if (!filingStatus || !VALID_FILING_STATUSES.includes(filingStatus))
      return res.status(400).json({ error: 'Invalid filing status' });
    if (!state || !VALID_STATES.includes(state.toUpperCase()))
      return res.status(400).json({ error: 'Invalid state code' });

    const st = state.toUpperCase();
    const income = parseFloat(annualIncome);
    const federalTax = calculateFederalTax(income, filingStatus);
    const stateRate = STATE_TAX_RATES[st] || 0;
    const stateTax = Math.round(income * stateRate * 100) / 100;
    const estimatedTax = federalTax + stateTax;
    const effectiveTaxRate = income > 0 ? Math.round((estimatedTax / income) * 10000) / 100 : 0;

    const id = ++estimateCounter.value;

    const result = {
      id,
      annualIncome: income,
      filingStatus,
      state: st,
      estimatedTax,
      federalTax,
      stateTax,
      effectiveTaxRate,
    };

    estimateStore.set(id, result);

    // PDF export via query param
    if (req.query.export === 'pdf') {
      const { createDocument } = require('../services/pdfService');
      const doc = createDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdf);
      });
      doc.fontSize(18).text('Tax Estimate', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Annual Income: $${income.toFixed(2)}`);
      doc.text(`Filing Status: ${filingStatus}`);
      doc.text(`State: ${st}`);
      doc.text(`Federal Tax: $${federalTax.toFixed(2)}`);
      doc.text(`State Tax: $${stateTax.toFixed(2)}`);
      doc.text(`Estimated Tax: $${estimatedTax.toFixed(2)}`);
      doc.text(`Effective Rate: ${effectiveTaxRate}%`);
      doc.end();
      return;
    }

    res.json(result);

  }));

  // ── Tax Estimate by ID (for PDF export) ──────────────────────────────
  router.get('/api/tax/estimates/:id', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const id = parseInt(req.params.id);
    const estimate = estimateStore.get(id);

    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found. Create one via POST /api/tax/estimates.' });
    }

    if (req.query.export === 'pdf') {
      const { createDocument } = require('../services/pdfService');
const { asyncHandler } = require('../lib/errors');
      const doc = createDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdf);
      });
      doc.fontSize(18).text('Tax Estimate', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Annual Income: $${estimate.annualIncome.toFixed(2)}`);
      doc.text(`Filing Status: ${estimate.filingStatus}`);
      doc.text(`State: ${estimate.state}`);
      doc.text(`Federal Tax: $${estimate.federalTax.toFixed(2)}`);
      doc.text(`State Tax: $${estimate.stateTax.toFixed(2)}`);
      doc.text(`Estimated Tax: $${estimate.estimatedTax.toFixed(2)}`);
      doc.text(`Effective Rate: ${estimate.effectiveTaxRate}%`);
      doc.end();
      return;
    }

    res.json(estimate);

  }));

  // ── Tax Progress ─────────────────────────────────────────────────────
  router.get('/api/tax/progress', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const year = req.query.year || new Date().getFullYear();

    const monthlyProgress = [];
    for (let month = 1; month <= 12; month++) {
      const monthStr = String(month).padStart(2, '0');
      const startDate = `${year}-${monthStr}-01`;
      const endDate = `${year}-${monthStr}-31`;

      const incomeRow = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`
        )
        .get(pid, startDate, endDate);

      const deductionRow = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE profile_id = ? AND type = 'deduction' AND date >= ? AND date <= ?`
        )
        .get(pid, startDate, endDate);

      monthlyProgress.push({
        month,
        income: incomeRow.total || 0,
        deductions: deductionRow.total || 0,
        estimated: 0,
        paid: 0,
      });
    }

    res.json({ year, monthlyProgress });

  }));

  // ── Federal Tax ──────────────────────────────────────────────────────
  router.get('/api/tax/federal', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const year = req.query.year || new Date().getFullYear();
    const quarter = req.query.quarter || null;

    let startDate = `${year}-01-01`;
    let endDate = `${year}-12-31`;
    if (quarter) {
      const q = parseInt(quarter);
      const firstMonthOfQuarter = (q - 1) * 3;
      startDate = `${year}-${String(firstMonthOfQuarter + 1).padStart(2, '0')}-01`;
      // Last day of the quarter's last month
      const lastDay = new Date(year, firstMonthOfQuarter + 3, 0).getDate();
      endDate = `${year}-${String(firstMonthOfQuarter + 3).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    const incomeRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`
      )
      .get(pid, startDate, endDate);

    const totalIncome = incomeRow.total || 0;
    const totalFederalTax = calculateFederalTax(totalIncome, 'single');

    res.json({ totalFederalTax, totalIncome, year, quarter: quarter ? parseInt(quarter) : null });

  }));

  // ── State Tax ────────────────────────────────────────────────────────
  router.get('/api/tax/state', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const state = (req.query.state || 'CA').toUpperCase();

    if (!VALID_STATES.includes(state))
      return res.status(400).json({ error: 'Invalid state code' });

    const year = req.query.year || new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const incomeRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`
      )
      .get(pid, startDate, endDate);

    const totalIncome = incomeRow.total || 0;
    const rate = STATE_TAX_RATES[state] || 0;
    const totalStateTax = Math.round(totalIncome * rate * 100) / 100;

    res.json({ totalStateTax, totalIncome, state, rate });

  }));

  return router;
};
