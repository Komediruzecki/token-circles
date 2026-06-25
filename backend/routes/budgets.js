'use strict';
const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { toCamelCase } = require('../utils');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter , requireAuth }) {
  const router = express.Router();

  router.get('/api/budgets', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const rows = req.repos.budgets.listByProfiles(pids);
    res.json(rows);

  }));

  router.post('/api/budgets', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date, rollover_enabled } = req.body;
    const result = req.repos.budgets.create({
      category_id,
      amount,
      period: period || 'monthly',
      start_date,
      end_date: end_date || null,
      rollover_enabled: rollover_enabled ? 1 : 0,
      profile_id: pid,
    });
    res.json({ id: result.lastInsertRowid, ...req.body, profile_id: pid });

  }));

  router.put('/api/budgets/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date, rollover_enabled } = req.body;
    const result = req.repos.budgets.update(req.params.id, pid, {
      category_id,
      amount,
      period,
      start_date,
      end_date: end_date || null,
      rollover_enabled: rollover_enabled ? 1 : 0,
    });
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/budgets/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const result = req.repos.budgets.deleteById(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  // Manual rollover adjustment
  router.put('/api/budgets/:id/rollover', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { rollover_amount, rollover_used, rollover_enabled } = req.body;

    // Build dynamic update based on what was provided
    const updates = [];
    const values = [];

    if (rollover_amount !== undefined) {
      updates.push('rollover_amount = ?');
      values.push(rollover_amount);
    }
    if (rollover_used !== undefined) {
      updates.push('rollover_used = ?');
      values.push(rollover_used);
    }
    if (rollover_enabled !== undefined) {
      updates.push('rollover_enabled = ?');
      values.push(rollover_enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No rollover fields provided' });
    }

    values.push(req.params.id, pid);

    const result = req.repos.budgets.run(
      `UPDATE budgets SET ${updates.join(', ')} WHERE id = ? AND profile_id = ?`,
      ...values
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    // Return updated budget
    const budget = req.repos.budgets.getById(req.params.id, pid);

    res.json({ ok: true, budget });

  }));

  router.get('/api/budgets/summary', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { year, month, apply_rollover } = req.query;
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const budgets = req.repos.budgets.listActive(pid, startDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const spent = req.repos.transactions.all(
      `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
      pid, startDate, endDate
    );

    const spentMap = {};
    for (const s of spent) spentMap[s.category_id] = s.total;

    // Calculate automatic rollover from previous month
    let prevY = m === 1 ? y - 1 : y;
    let prevM = m === 1 ? 12 : m - 1;
    const prevStart = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
    const prevEnd = `${y}-${String(m).padStart(2, '0')}-01`;

    // Get previous month's budgets with their spent amounts
    const prevBudgets = req.repos.budgets.all(
      `SELECT b.category_id, b.amount as budget_amount, b.rollover_enabled, b.rollover_amount, b.rollover_used
       FROM budgets b
       WHERE b.profile_id = ? AND b.start_date >= ? AND b.start_date < ?`,
      pid, prevStart, prevEnd
    );

    // Get previous month's spent
    const prevSpent = req.repos.transactions.all(
      `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
      pid, prevStart, prevEnd
    );

    const prevSpentMap = {};
    for (const s of prevSpent) prevSpentMap[s.category_id] = s.total;

    // Calculate unused from previous month for each category
    const prevUnusedMap = {};
    for (const pb of prevBudgets) {
      const unused = Math.max(0, pb.budget_amount - (prevSpentMap[pb.category_id] || 0));
      prevUnusedMap[pb.category_id] = { unused, rollover_enabled: pb.rollover_enabled };
    }

    const summary = budgets.map((b) => {
      const spentAmt = spentMap[b.category_id] || 0;
      const baseRemaining = b.amount - spentAmt;

      // Calculate rollover contribution
      let rollover_contribution = 0;
      let auto_rollover = 0;

      if (b.rollover_enabled) {
        const prevInfo = prevUnusedMap[b.category_id];
        if (prevInfo && prevInfo.rollover_enabled) {
          auto_rollover = prevInfo.unused;
        }
        rollover_contribution = (b.rollover_amount || 0) + auto_rollover - (b.rollover_used || 0);
      }

      // Effective budget = base budget + rollover contribution
      const effective_budget = b.amount + Math.max(0, rollover_contribution);
      const effective_remaining = effective_budget - spentAmt;

      return {
        ...b,
        spent: spentAmt,
        remaining: baseRemaining, // base remaining without rollover
        effective_budget,
        effective_remaining,
        rollover_contribution: Math.max(0, rollover_contribution),
        auto_rollover,
        percentage: b.amount > 0 ? Math.min(100, (spentAmt / b.amount) * 100) : 0,
      };
    });

    res.json(summary);

  }));

  // Duplicate budgets from previous month
  router.post('/api/budgets/duplicate-last', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { year, month } = req.body;

    // Calculate previous month
    let prevYear = year || new Date().getFullYear();
    let prevMonth = (month || new Date().getMonth() + 1) - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear--;
    }

    const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;

    // Get previous month's budgets
    const prevBudgets = req.repos.budgets.all(
      `SELECT category_id, amount, period
       FROM budgets
       WHERE profile_id = ? AND start_date >= ? AND start_date < ?`,
      pid, prevStart, `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`
    );

    if (prevBudgets.length === 0) {
      return res.json({ ok: false, message: 'No budgets found for previous month' });
    }

    const currYear = year || new Date().getFullYear();
    const currMonth = month || new Date().getMonth() + 1;
    const count = req.repos.budgets.duplicateLast(pid, currYear, currMonth);

    res.json({ ok: true, count });

  }));

  // Set budgets from last month's actual expenses
  router.post('/api/budgets/from-expenses', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { year, month } = req.body;

    // Calculate previous month
    let prevYear = year || new Date().getFullYear();
    let prevMonth = (month || new Date().getMonth() + 1) - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear--;
    }

    const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;

    // Get actual expenses by category
    const expenses = req.repos.transactions.all(
      `SELECT t.category_id, c.name, SUM(COALESCE(t.amount_local, t.amount)) as total
       FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id = ? AND t.date >= ? AND t.date < ? AND t.type = 'expense' AND t.category_id IS NOT NULL
       GROUP BY t.category_id`,
      pid, prevStart, prevEnd
    );

    if (expenses.length === 0) {
      return res.json({ ok: false, message: 'No expenses found for previous month' });
    }

    // Create current month start date
    const currYear = year || new Date().getFullYear();
    const currMonth = month || new Date().getMonth() + 1;
    const currStart = `${currYear}-${String(currMonth).padStart(2, '0')}-01`;

    // Clear existing budgets for current month
    req.repos.budgets.deleteByDateRange(pid, currStart, `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`);

    req.repos.budgets.bulkCreateMonthly(pid, currStart, expenses);

    res.json({ ok: true, count: expenses.length });

  }));

  // Get budget history for a category
  router.get('/api/budgets/history', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { category_id, months = 6 } = req.query;

    const history = req.repos.budgets.all(
      `SELECT b.start_date as month, b.amount as budget_amount,
              COALESCE(SUM(COALESCE(t.amount_local, t.amount)), 0) as spent
       FROM budgets b
       LEFT JOIN transactions t ON t.category_id = b.category_id
         AND t.profile_id = b.profile_id
         AND t.date >= b.start_date
         AND t.date < date(b.start_date, '+1 month')
         AND t.type = 'expense'
       WHERE b.profile_id = ? AND b.category_id = ?
       GROUP BY b.start_date
       ORDER BY b.start_date DESC
       LIMIT ?`,
      pid, parseInt(category_id), parseInt(months)
    );

    res.json(history);

  }));

  // Get budget improvements (month-over-month adherence)
  router.get('/api/budgets/improvements', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { months = 6 } = req.query;
    const numMonths = parseInt(months);

    // Get monthly aggregated adherence
    const history = req.repos.budgets.all(
      `WITH monthly_data AS (
        SELECT
          strftime('%Y-%m', b.start_date) as month,
          b.amount as budget_amount,
          COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as spent
        FROM budgets b
        LEFT JOIN transactions t ON t.category_id = b.category_id
          AND t.profile_id = b.profile_id
          AND t.date >= b.start_date
          AND t.date < date(b.start_date, '+1 month')
        WHERE b.profile_id = ?
        GROUP BY b.start_date
      ),
      aggregated AS (
        SELECT
          month,
          SUM(budget_amount) as total_budget,
          SUM(spent) as total_spent,
          CASE WHEN SUM(budget_amount) > 0 THEN (SUM(spent) / SUM(budget_amount) * 100) ELSE 0 END as adherence_pct
        FROM monthly_data
        GROUP BY month
        ORDER BY month DESC
      )
      SELECT
        month,
        total_budget,
        total_spent,
        adherence_pct,
        LAG(adherence_pct) OVER (ORDER BY month) as prev_adherence,
        CASE WHEN LAG(adherence_pct) OVER (ORDER BY month) IS NOT NULL
             THEN adherence_pct - LAG(adherence_pct) OVER (ORDER BY month)
             ELSE NULL END as change_pct
      FROM aggregated
      ORDER BY month DESC
      LIMIT ?`,
      pid, numMonths
    );

    // Get category breakdown for latest month (for donut chart)
    let categoryBudgets = [];
    if (history.length > 0) {
      const latestMonth = history[0].month;
      const catData = req.repos.budgets.all(
        `SELECT c.name, c.color, b.amount as budget_amount
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.profile_id = ? AND strftime('%Y-%m', b.start_date) = ?
         ORDER BY b.amount DESC`,
        pid, latestMonth
      );
      categoryBudgets = catData;
    }

    // Attach category_budgets JSON to last item for donut
    if (history.length > 0) {
      history[0].category_budgets = JSON.stringify(categoryBudgets);
    }

    res.json(history);

  }));

  // ========================
  // BUDGET ALERTS
  // ========================
  router.get('/api/budgets/alerts', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { threshold = 80, year, month } = req.query;
    const alertThreshold = parseFloat(threshold);

    // Support optional year/month for historical alerts, default to current month
    let startDate, endDate;
    if (year && month) {
      const y = parseInt(year);
      const m = parseInt(month);
      startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    } else {
      const now = new Date();
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const nextM = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
      const nextY = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    }

    const budgets = req.repos.budgets.listActive(pid, startDate);

    const spent = req.repos.transactions.all(
      `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
      pid, startDate, endDate
    );

    const spentMap = {};
    for (const s of spent) spentMap[s.category_id] = Math.abs(s.total);

    const alerts = budgets
      .map((b) => {
        const s = spentMap[b.category_id] || 0;
        const pct = b.amount > 0 ? (s / b.amount) * 100 : 0;
        const remaining = b.amount - s;
        return {
          categoryId: b.category_id,
          categoryName: b.category_name,
          categoryColor: b.category_color,
          categoryIcon: b.category_icon,
          budgetAmount: b.amount,
          spent: s,
          remaining,
          percentage: Math.round(pct),
          status: pct > 100 ? 'over' : pct >= alertThreshold ? 'warning' : 'ok',
        };
      })
      .filter((b) => b.percentage >= alertThreshold)
      .sort((a, b) => b.percentage - a.percentage);

    res.json({ alerts, threshold: alertThreshold, startDate, endDate });

  }));

  // ========================
  // ZERO-BASED BUDGETING
  // ========================

  // Get budget allocation form - categories with remaining allocation
  router.get('/api/budgets/zero-based', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;
    const nextMonth = new Date(
      new Date(month + '-01').setMonth(new Date(month + '-01').getMonth() + 1)
    );
    const endOfMonth = nextMonth.toISOString().slice(0, 10);

    // Get all expense categories for this profile
    const categories = req.repos.categories.all(
      `SELECT id, name, color, icon FROM categories WHERE profile_id = ? AND type = 'expense' ORDER BY name`,
      pid
    );

    // Get existing budgets for this month
    const budgets = req.repos.budgets.all(
      `SELECT * FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ? AND period = 'monthly'`,
      pid, startOfMonth, endOfMonth
    );

    const budgetMap = {};
    budgets.forEach((b) => (budgetMap[b.category_id] = b));

    // Get actual spending for this month
    const spent = req.repos.transactions.all(
      `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
      pid, startOfMonth, endOfMonth
    );

    const spentMap = {};
    spent.forEach((s) => (spentMap[s.category_id] = Math.abs(s.total)));

    // Calculate remaining amount for zero-based budgeting
    const incomeRows = req.repos.transactions.all(
      `SELECT SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'income'`,
      pid, startOfMonth, endOfMonth
    );
    const remaining = incomeRows[0]?.total || 0;

    // Calculate already budgeted amounts
    const alreadyBudgetedRows = req.repos.budgets.all(
      `SELECT SUM(amount) as total FROM budgets
       WHERE profile_id = ? AND start_date >= ? AND start_date < ?`,
      pid, startOfMonth, endOfMonth
    );
    const alreadyBudgeted = (alreadyBudgetedRows && alreadyBudgetedRows[0]?.total) ?? 0;

    // Calculate unassigned budget for this month
    const unassignedBudget = Math.max(0, remaining - alreadyBudgeted);

    // Build category allocation details
    const allocations = categories.map((cat) => {
      const budget = budgetMap[cat.id];
      const spentAmt = spentMap[cat.id] || 0;
      const remainingBudget = budget ? budget.amount - spentAmt : 0;
      const percentUsed = budget && budget.amount > 0 ? (spentAmt / budget.amount) * 100 : 0;

      return {
        budget_id: budget?.id ?? null,
        category_id: cat.id,
        category_name: cat.name,
        category_color: cat.color,
        category_icon: cat.icon,
        amount: budget?.amount || 0,
        spent: spentAmt,
        remaining_budget: remainingBudget,
        percent_used: Math.min(100, Math.round(percentUsed)),
        is_budgeted: !!budget,
        can_allocate: unassignedBudget > 0,
        rollover_enabled: budget?.rollover_enabled ?? false,
      };
    });

    res.json({
      categories,
      allocations,
      remaining_income: remaining,
      alreadyBudgeted,
      unassigned_budget: unassignedBudget,
      period: month,
      can_allocate: unassignedBudget > 0,
    });

  }));

  // Allocate budget to a category (zero-based budgeting)
  router.post('/api/budgets/allocate', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { category_id, amount, period } = req.body;

    if (!category_id || amount == null) {
      return res.status(400).json({ error: 'Category ID and amount are required' });
    }

    const budgetPeriod = period || 'monthly';

    // Get month for this budget (default to current month)
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const start_date = `${month}-01`;

    // Check if budget already exists for this category and month
    const existing = req.repos.budgets.getByCategoryForMonth(
      category_id, pid, start_date, budgetPeriod
    );

    if (existing) {
      return res.status(400).json({
        error: `Budget already exists for ${month}. Use PUT /api/budgets/:id to update it.`,
      });
    }

    const info = req.repos.budgets.create({
      category_id,
      amount,
      period: budgetPeriod,
      start_date,
      profile_id: pid,
    });

    res.json({
      id: info.lastInsertRowid,
      category_id,
      amount,
      period: budgetPeriod,
      start_date,
      profile_id: pid,
      message: 'Budget allocated successfully',
    });

  }));

  // Get zero-based budget summary - view allocations and spending
  router.get('/api/budgets/zero-based/summary', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;
    const nextMonth = new Date(
      new Date(month + '-01').setMonth(new Date(month + '-01').getMonth() + 1)
    );
    const endOfMonth = nextMonth.toISOString().slice(0, 10);

    // Get allocations (budgets for this month)
    const budgets = req.repos.budgets.all(
      `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM budgets b
       JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id = ? AND b.start_date >= ? AND b.start_date < ? AND b.period = 'monthly'`,
      pid, startOfMonth, endOfMonth
    );

    // Get actual spending by category
    const spent = req.repos.transactions.all(
      `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
      pid, startOfMonth, endOfMonth
    );

    const spentMap = {};
    spent.forEach((s) => (spentMap[s.category_id] = Math.abs(s.total)));

    // Get total income for this month
    const incomeRows = req.repos.transactions.all(
      `SELECT SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'income'`,
      pid, startOfMonth, endOfMonth
    );
    const income = incomeRows[0]?.total || 0;

    // Calculate summary
    const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
    const totalSpent = Object.values(spentMap).reduce((sum, val) => sum + val, 0);
    const remaining = totalBudget - totalSpent;
    const zero_based_remaining = income - totalBudget;

    const summary = budgets.map((b) => ({
      budget_id: b.id,
      category_id: b.category_id,
      category_name: b.category_name,
      category_color: b.category_color,
      category_icon: b.category_icon,
      allocated: b.amount,
      spent: spentMap[b.category_id] || 0,
      remaining: b.amount - (spentMap[b.category_id] || 0),
      percent_used: b.amount > 0 ? ((spentMap[b.category_id] || 0) / b.amount) * 100 : 0,
      status: (spentMap[b.category_id] || 0) > b.amount ? 'over' : 'ok',
      is_fully_allocated: b.amount > 0 && (spentMap[b.category_id] || 0) <= b.amount,
      rollover_enabled: b.rollover_enabled ?? false,
      alerts: [],
    }));

    // Add remaining unallocated alerts
    if (zero_based_remaining > 0) {
      summary.push({
        category_id: 0,
        category_name: 'Unallocated / Future',
        category_color: '#9ca3af',
        category_icon: 'wallet',
        allocated: 0,
        spent: 0,
        remaining: zero_based_remaining,
        percent_used: 0,
        status: 'ok',
        is_fully_allocated: true,
        alerts: [
          'You have unallocated income. Consider adding a savings allocation or increase existing budgets.',
        ],
        is_unallocated: true,
      });
    }

    // Over-budget alerts
    summary.forEach((item) => {
      if (item.percent_used >= 90) {
        item.alerts.push(`Approaching limit: ${Math.round(item.percent_used)}% used`);
      }
      if (item.percent_used > 100) {
        item.alerts.push(`Over budget by $${item.remaining.toFixed(2)}`);
      }
    });

    res.json({
      allocations: summary,
      total_budget: totalBudget,
      total_spent: totalSpent,
      remaining: remaining,
      zero_based_remaining,
      income,
      period: month,
      can_allocate: zero_based_remaining > 0,
      unassigned_budget: zero_based_remaining,
      already_budgeted: totalBudget,
    });

  }));

  // ========================
  // BUDGET FORECASTING
  // ========================
  router.get('/api/budgets/forecast', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { month = new Date().toISOString().slice(0, 7) } = req.query;

    // Get budgets active in or before the forecast start month
    const startOfMonth = `${month}-01`;
    const endOfMonth = new Date(
      new Date(`${month}-01`).setMonth(new Date(`${month}-01`).getMonth() + 1)
    )
      .toISOString()
      .slice(0, 10);

    const budgets = req.repos.budgets.all(
      `SELECT b.*, c.name as category_name, c.color as category_color
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.profile_id = ? AND b.start_date <= ?
       ORDER BY b.start_date DESC`,
      pid, month
    );

    if (budgets.length === 0) {
      return res.json({
        period: month,
        history: [],
        forecast: [],
        total_budget: 0,
        avg_adherence: 0,
      });
    }

    // Get historical spending by category for past 12 months
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const startHistory = oneYearAgo.toISOString().slice(0, 7);

    const historicalData = req.repos.budgets.all(
      `SELECT
        strftime('%Y-%m', date) as month,
        b.category_id,
        b.period,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as spent
      FROM budgets b
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.profile_id = b.profile_id
        AND t.date >= b.start_date
        AND t.date < date(b.start_date, '+1 month')
        AND t.type = 'expense'
      WHERE b.profile_id = ?
      GROUP BY month, b.category_id, b.period`,
      pid
    );

    // Build category historical averages
    const categoryAverages = {};
    for (const row of historicalData) {
      if (!categoryAverages[row.category_id]) {
        categoryAverages[row.category_id] = { total: 0, count: 0, avgAmount: 0 };
      }
      if (row.spent > 0) {
        categoryAverages[row.category_id].total += row.spent;
        categoryAverages[row.category_id].count += 1;
      }
    }

    for (const cid in categoryAverages) {
      if (categoryAverages[cid].count > 0) {
        categoryAverages[cid].avgAmount =
          categoryAverages[cid].total / categoryAverages[cid].count;
      }
    }

    // Generate forecast for next 6 months
    const forecastMonths = [];
    const now = new Date();
    for (let i = 1; i <= 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      forecastMonths.push({
        month: date.toISOString().slice(0, 7),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      });
    }

    const forecastData = forecastMonths.map((fm) => {
      const fmMonthStr = fm.month + '-01';
      const fmNextMonthStr = new Date(
        new Date(fm.month + '-01').setMonth(new Date(fm.month + '-01').getMonth() + 1)
      )
        .toISOString()
        .slice(0, 10);

      // Get current budget amount for this month (if active)
      const currentBudget =
        budgets.find((b) => b.start_date === fmMonthStr) || budgets[budgets.length - 1];

      // Predicted spending based on historical average
      const avgSpending = categoryAverages[currentBudget.category_id]
        ? categoryAverages[currentBudget.category_id].avgAmount
        : currentBudget.amount * 0.5; // Default to 50% if no history

      // Apply inflation adjustment (3% annually)
      const monthsDiff = new Date(fm.month + '-01').getMonth() - new Date().getMonth();
      const inflationFactor = Math.pow(1.03, Math.max(0, monthsDiff));

      const predictedSpent = avgSpending * inflationFactor;
      const adherence =
        currentBudget.amount > 0
          ? Math.min(100, (predictedSpent / currentBudget.amount) * 100)
          : 0;
      const status = adherence > 100 ? 'over' : adherence >= 80 ? 'warning' : 'ok';
      const forecastRemaining = Math.max(0, currentBudget.amount - predictedSpent);

      return {
        month: fm.month,
        label: fm.label,
        budget_amount: currentBudget.amount,
        predicted_spent: predictedSpent,
        adherence,
        status,
        forecast_remaining: forecastRemaining,
      };
    });

    // Get historical adherence for comparison
    const historyMonths = [];
    const endOfHistory = new Date(now);
    endOfHistory.setMonth(endOfHistory.getMonth() - 1);

    for (let i = 1; i <= 6; i++) {
      const date = new Date(endOfHistory.getFullYear(), endOfHistory.getMonth() - i, 1);
      historyMonths.push({
        month: date.toISOString().slice(0, 7),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      });
    }

    const historyData = req.repos.budgets.all(
      `SELECT
        strftime('%Y-%m', start_date) as month,
        SUM(b.amount) as total_budget,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as total_spent
      FROM budgets b
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.profile_id = b.profile_id
        AND t.date >= b.start_date
        AND t.date < date(b.start_date, '+1 month')
      WHERE b.profile_id = ? AND strftime('%Y-%m', start_date) <= ?
      GROUP BY month
      ORDER BY month DESC
      LIMIT ?`,
      pid, now.toISOString().slice(0, 7), 6
    );

    const history = historyData.map((h) => ({
      month: h.month,
      label: new Date(h.month + '-01').toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      }),
      total_budget: h.total_budget || 0,
      total_spent: h.total_spent || 0,
      adherence: h.total_budget > 0 ? Math.min(100, (h.total_spent / h.total_budget) * 100) : 0,
    }));

    const avgAdherence =
      history.length > 0 ? history.reduce((sum, h) => sum + h.adherence, 0) / history.length : 0;

    res.json({
      period: month,
      history,
      forecast: forecastData,
      total_budget: budgets.reduce((sum, b) => sum + b.amount, 0),
      avg_adherence: Math.round(avgAdherence),
    });

  }));

  return router;
};
