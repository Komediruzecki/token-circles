'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/dashboard', apiRateLimiter, async (req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // Get settings for currency
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    // Get summary (income, expenses, balance, recent transactions)
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;
    const allTime = req.query.all === 'true';
    let startDate;
    let endDate;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    if (allTime) {
      startDate = '0000-01-01';
      endDate = '9999-12-31';
    } else if (dateFrom && dateTo) {
      startDate = dateFrom;
      endDate = dateTo;
    } else {
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    // Previous month calculation
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevStartDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
    const prevEndDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;

    const monthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? GROUP BY type`
      )
      .all(...pids, startDate, endDate);

    const summary = { income: 0, expense: 0, balance: 0 };
    for (const r of monthly) {
      if (r.type === 'income') summary.income = r.total;
      else if (r.type === 'expense') summary.expense = r.total;
      else if (r.type === 'transfer') summary.balance += r.total;
    }

    // Get previous month summary for MoM delta
    const prevMonthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? GROUP BY type`
      )
      .all(...pids, prevStartDate, prevEndDate);

    const prevSummary = { income: 0, expense: 0, balance: 0 };
    for (const r of prevMonthly) {
      if (r.type === 'income') prevSummary.income = r.total;
      else if (r.type === 'expense') prevSummary.expense = r.total;
      else if (r.type === 'transfer') prevSummary.balance += r.total;
    }

    const momIncomeDelta = summary.income - prevSummary.income;
    const momExpenseDelta = summary.expense - prevSummary.expense;
    const momBalanceDelta =
      summary.income - summary.expense - (prevSummary.income - prevSummary.expense);

    const recent = db
      .prepare(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC LIMIT 10`
      )
      .all(...pids, startDate, endDate);

    // Get category breakdown for expenses
    const expenseByCategory = db
      .prepare(
        `SELECT c.name as category_name, c.color as category_color, SUM(COALESCE(t.amount_local, t.amount)) as total FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ? GROUP BY c.id, c.name, c.color ORDER BY total DESC`
      )
      .all(...pids, startDate, endDate);

    // Get account balances
    const accounts = db
      .prepare(
        `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`
      )
      .all(...pids);
    const balance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    // Get upcoming bills
    const today = new Date();
    const upcomingBills = db
      .prepare(
        `SELECT b.*, p.name as profile_name FROM bills b LEFT JOIN profiles p ON b.profile_id = p.id WHERE b.profile_id IN (${inClause}) AND b.due_date >= ? AND b.due_date <= ? ORDER BY b.due_date ASC LIMIT 5`
      )
      .all(
        ...pids,
        today.toISOString().split('T')[0],
        new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      );

    res.json({
      totalIncome: summary.income,
      totalExpenses: summary.expense,
      balance,
      incomeByCategory: [],
      expenseByCategory,
      recentTransactions: recent,
      upcomingBills,
      momIncomeDelta,
      momExpenseDelta,
      momBalanceDelta,
    });

  });

  // ========================
  // DASHBOARD (per-profile, multi-profile for combined view)
  // ========================
  router.get('/api/dashboard/summary', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { year, month } = req.query;
    // Support both "YYYY-MM" format and just "MM"
    const monthPart = month ? (month.includes('-') ? month.split('-')[1] : month) : null;
    const y = year || new Date().getFullYear();
    const m = monthPart;
    let startDate, endDate;

    if (m) {
      // Specific month
      startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    } else {
      // Full year
      startDate = `${y}-01-01`;
      endDate = `${y + 1}-01-01`;
    }

    // Use amount_local if available (for imported transactions), otherwise amount
    const monthly = db
      .prepare(
        `
    SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
    FROM transactions
    WHERE profile_id IN (${inClause}) AND date >= ? AND date < ?
    GROUP BY type
    `
      )
      .all(...pids, startDate, endDate);

    const summary = { income: 0, expense: 0, transfer: 0, balance: 0 };
    for (const r of monthly) {
      if (r.type === 'income') summary.income = r.total;
      else if (r.type === 'expense') summary.expense = r.total;
      else if (r.type === 'transfer') summary.transfer = r.total;
    }
    summary.balance = summary.income - summary.expense;

    const recent = db
      .prepare(
        `
    SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date < ?
    ORDER BY t.date DESC, t.id DESC
    LIMIT 10
    `
      )
      .all(...pids, startDate, endDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const yearStart = `${y}-01-01`;
    const ytd = db
      .prepare(
        `
    SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? GROUP BY type
    `
      )
      .all(...pids, yearStart);
    const ytdSummary = { income: 0, expense: 0 };
    for (const r of ytd) {
      if (r.type === 'income') ytdSummary.income = r.total;
      else if (r.type === 'expense') ytdSummary.expense = r.total;
    }
    ytdSummary.net = ytdSummary.income - ytdSummary.expense;

    // Get currency setting
    // Previous period comparison
    let prevStartDate, prevEndDate;
    if (m) {
      // Previous month
      const pm = m == 1 ? 12 : m - 1;
      const py = m == 1 ? y - 1 : y;
      prevStartDate = `${py}-${String(pm).padStart(2, '0')}-01`;
      const nextPm = pm == 12 ? 1 : pm + 1;
      const nextPy = pm == 12 ? py + 1 : py;
      prevEndDate = `${nextPy}-${String(nextPm).padStart(2, '0')}-01`;
    } else {
      // Previous year
      prevStartDate = `${y - 1}-01-01`;
      prevEndDate = `${y}-01-01`;
    }

    const prevMonthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? GROUP BY type`
      )
      .all(...pids, prevStartDate, prevEndDate);
    const prevSummary = { income: 0, expense: 0 };
    for (const r of prevMonthly) {
      if (r.type === 'income') prevSummary.income = r.total;
      else if (r.type === 'expense') prevSummary.expense = r.total;
    }

    // Get currency setting
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({
      summary,
      prevSummary,
      recent,
      ytd: ytdSummary,
      month: m ? `${y}-${String(m).padStart(2, '0')}` : y,
      currency,
    });

  }));

  router.get('/api/dashboard/charts', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { months = 12 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Use amount_local if available (for imported transactions), otherwise amount
    const byCategory = db
      .prepare(
        `
    SELECT c.name, c.color, c.icon, SUM(COALESCE(t.amount_local, t.amount)) as total, COUNT(*) as count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause}) AND t.type = 'expense'
    GROUP BY c.id
    ORDER BY total DESC
    `
      )
      .all(...pids);

    const monthly = db
      .prepare(
        `
    SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
    FROM transactions
    WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income', 'expense')
    GROUP BY month, type
    ORDER BY month
    `
      )
      .all(...pids, startStr, endStr);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, income: 0, expense: 0 };
      if (r.type === 'income') monthlyMap[r.month].income = r.total;
      if (r.type === 'expense') monthlyMap[r.month].expense = r.total;
    }

    const cashFlow = Object.values(monthlyMap);
    let running = 0;
    for (const row of cashFlow) {
      running += row.income - row.expense;
      row.cumulative = running;
    }

    // Get currency setting
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({
      byCategory,
      monthly: Object.values(monthlyMap),
      cashFlow,
      currency,
    });

  }));

  router.get('/api/dashboard/net-worth', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    // Get account balances
    const accounts = db
      .prepare(
        `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`
      )
      .all(...pids);
    const totalNetWorth = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    // Get monthly net flow (income - expense) from earliest transaction to now
    const monthly = db
      .prepare(
        `
    SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
    FROM transactions
    WHERE profile_id IN (${inClause}) AND type IN ('income', 'expense')
    GROUP BY month, type
    ORDER BY month
    `
      )
      .all(...pids);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, net: 0 };
      if (r.type === 'income') monthlyMap[r.month].net += r.total;
      if (r.type === 'expense') monthlyMap[r.month].net -= r.total;
    }

    // Build timeline from earliest transaction to now with running total
    const timeline = [];
    const sortedMonths = Object.keys(monthlyMap).sort();
    if (sortedMonths.length > 0) {
      // Total net from all months in range
      const totalNet = Object.values(monthlyMap).reduce((s, m) => s + m.net, 0);
      // Opening balance = current net worth - total net accumulated
      const opening = totalNetWorth - totalNet;

      let balance = opening;
      for (const m of sortedMonths) {
        balance += monthlyMap[m].net;
        timeline.push({
          month: m,
          balance: Math.round(balance * 100) / 100,
          netChange: Math.round(monthlyMap[m].net * 100) / 100,
        });
      }
    }

    res.json({
      totalNetWorth: Math.round(totalNetWorth * 100) / 100,
      accounts,
      timeline,
    });

  }));

  return router;
};
