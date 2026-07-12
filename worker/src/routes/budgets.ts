import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';

// Port of backend/routes/budgets.js + backend/repositories/budgetsRepo.js.
// Both the CRUD routes and the analytical/zero-based/forecast endpoints are
// ported. The analytical endpoints join budgets to transactions by category and
// month-window and recompute the same aggregates the Express handlers produced.
//
// Route ordering note: Hono's default SmartRouter resolves by registration order,
// so a request to /api/budgets/summary would match /api/budgets/:id if :id were
// registered first. All static-segment routes are therefore registered BEFORE the
// /:id routes (mirroring how routes/transactions.ts orders /summary before /:id).
export const budgetsRoutes = new Hono<AppEnv>();

// budgetsRepo.listByProfiles — aggregating read across owned profiles.
budgetsRoutes.get('/api/budgets', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const rows = await db.all(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
     FROM budgets b
     JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
     WHERE b.profile_id IN (${inClause})
     ORDER BY b.id DESC`,
    ...pids
  );
  return c.json(rows);
});

budgetsRoutes.post('/api/budgets', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const res = await db.insert(c.env.DB, 'budgets', {
    category_id: b.category_id,
    amount: b.amount,
    period: b.period || 'monthly',
    start_date: b.start_date,
    end_date: b.end_date || null,
    rollover_enabled: b.rollover_enabled ? 1 : 0,
    profile_id: pid,
  });
  return c.json({ id: res.meta.last_row_id, ...b, profile_id: pid });
});

// ── Analytical / zero-based / forecast endpoints ──────────────────────────────
// Registered before /api/budgets/:id so their static segments aren't shadowed.

interface BudgetRow {
  id: number;
  category_id: number;
  amount: number;
  period: string;
  start_date: string;
  end_date: string | null;
  rollover_enabled: number;
  rollover_amount: number;
  rollover_used: number;
  category_name?: string | null;
  category_color?: string | null;
  category_icon?: string | null;
  [key: string]: unknown;
}

// GET /api/budgets/summary — base budget vs spend plus auto-rollover from prior month.
budgetsRoutes.get('/api/budgets/summary', requireAuth, async (c) => {
  // Multi-profile (household) selection, matching GET /api/budgets so the summary
  // covers the same profiles as the list.
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = c.req.query('year');
  const month = c.req.query('month');
  const y = year ? Number(year) : new Date().getFullYear();
  const m = month ? Number(month) : new Date().getMonth() + 1;
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

  // D13: budgetsAllocate writes one row per month with no end_date, so the old
  // `end_date IS NULL OR end_date >= ?` filter stacked every prior month's row for
  // a category. Restrict to budgets whose start_date falls in the queried month
  // (mirrors zero-based) — exactly one row per category per month.
  const budgets = await db.all<BudgetRow>(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
     FROM budgets b
     JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
     WHERE b.profile_id IN (${inClause}) AND b.start_date >= ? AND b.start_date < ?`,
    ...pids,
    startDate,
    endDate
  );

  const spent = await db.all<{ category_id: number; total: number }>(
    c.env.DB,
    `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
    ...pids,
    startDate,
    endDate
  );
  const spentMap: Record<number, number> = {};
  for (const s of spent) spentMap[s.category_id] = s.total;

  // Automatic rollover from the previous month.
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevStart = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
  const prevEnd = `${y}-${String(m).padStart(2, '0')}-01`;

  const prevBudgets = await db.all<{
    category_id: number;
    budget_amount: number;
    rollover_enabled: number;
    rollover_amount: number;
    rollover_used: number;
  }>(
    c.env.DB,
    `SELECT b.category_id, b.amount as budget_amount, b.rollover_enabled, b.rollover_amount, b.rollover_used
       FROM budgets b
       WHERE b.profile_id IN (${inClause}) AND b.start_date >= ? AND b.start_date < ?`,
    ...pids,
    prevStart,
    prevEnd
  );

  const prevSpent = await db.all<{ category_id: number; total: number }>(
    c.env.DB,
    `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
    ...pids,
    prevStart,
    prevEnd
  );
  const prevSpentMap: Record<number, number> = {};
  for (const s of prevSpent) prevSpentMap[s.category_id] = s.total;

  const prevUnusedMap: Record<number, { unused: number; rollover_enabled: number }> = {};
  for (const pb of prevBudgets) {
    const unused = Math.max(0, pb.budget_amount - (prevSpentMap[pb.category_id] || 0));
    prevUnusedMap[pb.category_id] = { unused, rollover_enabled: pb.rollover_enabled };
  }

  const summary = budgets.map((b) => {
    const spentAmt = spentMap[b.category_id] || 0;
    const baseRemaining = b.amount - spentAmt;

    let rollover_contribution = 0;
    let auto_rollover = 0;

    if (b.rollover_enabled) {
      const prevInfo = prevUnusedMap[b.category_id];
      if (prevInfo && prevInfo.rollover_enabled) {
        auto_rollover = prevInfo.unused;
      }
      rollover_contribution = (b.rollover_amount || 0) + auto_rollover - (b.rollover_used || 0);
    }

    const effective_budget = b.amount + Math.max(0, rollover_contribution);
    const effective_remaining = effective_budget - spentAmt;

    return {
      ...b,
      spent: spentAmt,
      remaining: baseRemaining,
      effective_budget,
      effective_remaining,
      rollover_contribution: Math.max(0, rollover_contribution),
      auto_rollover,
      percentage: b.amount > 0 ? Math.min(100, (spentAmt / b.amount) * 100) : 0,
    };
  });

  return c.json(summary);
});

// GET /api/budgets/history — per-month budget vs spent for one category.
budgetsRoutes.get('/api/budgets/history', requireAuth, async (c) => {
  // Multi-profile (household) selection, matching GET /api/budgets. category_id is
  // globally unique, so the IN clause simply widens the search to the owning profile.
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const categoryId = c.req.query('category_id');
  const months = c.req.query('months') ?? 6;

  const history = await db.all(
    c.env.DB,
    `SELECT b.start_date as month, b.amount as budget_amount,
            COALESCE(SUM(COALESCE(t.amount_local, t.amount)), 0) as spent
       FROM budgets b
       LEFT JOIN transactions t ON t.category_id = b.category_id
         AND t.profile_id = b.profile_id
         AND t.date >= b.start_date
         AND t.date < date(b.start_date, '+1 month')
         AND t.type = 'expense'
       WHERE b.profile_id IN (${inClause}) AND b.category_id = ?
       GROUP BY b.start_date
       ORDER BY b.start_date DESC
       LIMIT ?`,
    ...pids,
    parseInt(String(categoryId)),
    parseInt(String(months))
  );

  return c.json(history);
});

// GET /api/budgets/improvements — month-over-month adherence (window fns) + donut data.
budgetsRoutes.get('/api/budgets/improvements', requireAuth, async (c) => {
  // Multi-profile (household) selection, matching GET /api/budgets.
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const months = c.req.query('months') ?? 6;
  const numMonths = parseInt(String(months));

  const history = await db.all<{ month: string; category_budgets?: string; [k: string]: unknown }>(
    c.env.DB,
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
        WHERE b.profile_id IN (${inClause})
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
    ...pids,
    numMonths
  );

  // Category breakdown for the latest month (donut chart).
  let categoryBudgets: unknown[] = [];
  if (history.length > 0) {
    const latestMonth = history[0].month;
    categoryBudgets = await db.all(
      c.env.DB,
      `SELECT c.name, c.color, b.amount as budget_amount
         FROM budgets b
         JOIN categories c ON c.id = b.category_id AND c.profile_id = b.profile_id
         WHERE b.profile_id IN (${inClause}) AND strftime('%Y-%m', b.start_date) = ?
         ORDER BY b.amount DESC`,
      ...pids,
      latestMonth
    );
  }

  if (history.length > 0) {
    history[0].category_budgets = JSON.stringify(categoryBudgets);
  }

  return c.json(history);
});

// GET /api/budgets/alerts — categories at/over a spend threshold (camelCase keys, literal).
budgetsRoutes.get('/api/budgets/alerts', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const threshold = c.req.query('threshold') ?? 80;
  const year = c.req.query('year');
  const month = c.req.query('month');
  const alertThreshold = parseFloat(String(threshold));

  let startDate: string;
  let endDate: string;
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

  // budgetsRepo.listActive
  const budgets = await db.all<BudgetRow>(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
     FROM budgets b
     JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
     WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)`,
    pid,
    startDate
  );

  const spent = await db.all<{ category_id: number; total: number }>(
    c.env.DB,
    `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
    pid,
    startDate,
    endDate
  );

  const spentMap: Record<number, number> = {};
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

  return c.json({ alerts, threshold: alertThreshold, startDate, endDate });
});

// GET /api/budgets/zero-based/summary — allocations vs spend vs income for a month.
// Registered before /api/budgets/zero-based so the longer static path resolves first.
budgetsRoutes.get('/api/budgets/zero-based/summary', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`;
  const nextMonth = new Date(
    new Date(month + '-01').setMonth(new Date(month + '-01').getMonth() + 1)
  );
  const endOfMonth = nextMonth.toISOString().slice(0, 10);

  const budgets = await db.all<BudgetRow>(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM budgets b
       JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id = ? AND b.start_date >= ? AND b.start_date < ? AND b.period = 'monthly'`,
    pid,
    startOfMonth,
    endOfMonth
  );

  const spent = await db.all<{ category_id: number; total: number }>(
    c.env.DB,
    `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
    pid,
    startOfMonth,
    endOfMonth
  );
  const spentMap: Record<number, number> = {};
  for (const s of spent) spentMap[s.category_id] = Math.abs(s.total);

  const incomeRow = await db.first<{ total: number | null }>(
    c.env.DB,
    `SELECT SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'income'`,
    pid,
    startOfMonth,
    endOfMonth
  );
  const income = incomeRow?.total || 0;

  const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = Object.values(spentMap).reduce((sum, val) => sum + val, 0);
  const remaining = totalBudget - totalSpent;
  const zero_based_remaining = income - totalBudget;

  const summary: Array<
    Record<string, unknown> & { percent_used: number; remaining: number; alerts: string[] }
  > = budgets.map((b) => ({
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

  summary.forEach((item) => {
    if (item.percent_used >= 90) {
      item.alerts.push(`Approaching limit: ${Math.round(item.percent_used)}% used`);
    }
    if (item.percent_used > 100) {
      item.alerts.push(`Over budget by $${item.remaining.toFixed(2)}`);
    }
  });

  return c.json({
    allocations: summary,
    total_budget: totalBudget,
    total_spent: totalSpent,
    remaining,
    zero_based_remaining,
    income,
    period: month,
    can_allocate: zero_based_remaining > 0,
    unassigned_budget: zero_based_remaining,
    already_budgeted: totalBudget,
  });
});

// GET /api/budgets/zero-based — allocation form (categories + budgets + spend + income).
budgetsRoutes.get('/api/budgets/zero-based', requireAuth, async (c) => {
  // Multi-profile (household) selection, matching GET /api/budgets.
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`;
  const nextMonth = new Date(
    new Date(month + '-01').setMonth(new Date(month + '-01').getMonth() + 1)
  );
  const endOfMonth = nextMonth.toISOString().slice(0, 10);

  const categories = await db.all<{ id: number; name: string; color: string; icon: string }>(
    c.env.DB,
    `SELECT id, name, color, icon FROM categories WHERE profile_id IN (${inClause}) AND type = 'expense' ORDER BY name`,
    ...pids
  );

  const budgets = await db.all<BudgetRow>(
    c.env.DB,
    `SELECT * FROM budgets WHERE profile_id IN (${inClause}) AND start_date >= ? AND start_date < ? AND period = 'monthly'`,
    ...pids,
    startOfMonth,
    endOfMonth
  );
  const budgetMap: Record<number, BudgetRow> = {};
  budgets.forEach((b) => (budgetMap[b.category_id] = b));

  const spent = await db.all<{ category_id: number; total: number }>(
    c.env.DB,
    `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`,
    ...pids,
    startOfMonth,
    endOfMonth
  );
  const spentMap: Record<number, number> = {};
  spent.forEach((s) => (spentMap[s.category_id] = Math.abs(s.total)));

  const incomeRow = await db.first<{ total: number | null }>(
    c.env.DB,
    `SELECT SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? AND type = 'income'`,
    ...pids,
    startOfMonth,
    endOfMonth
  );
  const remaining = incomeRow?.total || 0;

  const alreadyBudgetedRow = await db.first<{ total: number | null }>(
    c.env.DB,
    `SELECT SUM(amount) as total FROM budgets
       WHERE profile_id IN (${inClause}) AND start_date >= ? AND start_date < ?`,
    ...pids,
    startOfMonth,
    endOfMonth
  );
  const alreadyBudgeted = alreadyBudgetedRow?.total ?? 0;

  const unassignedBudget = Math.max(0, remaining - alreadyBudgeted);

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

  return c.json({
    categories,
    allocations,
    remaining_income: remaining,
    alreadyBudgeted,
    unassigned_budget: unassignedBudget,
    period: month,
    can_allocate: unassignedBudget > 0,
  });
});

// GET /api/budgets/forecast — historical averages + 6-month projection with inflation.
budgetsRoutes.get('/api/budgets/forecast', requireAuth, async (c) => {
  // Multi-profile (household) selection, matching GET /api/budgets.
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

  const budgets = await db.all<BudgetRow>(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color
       FROM budgets b
       JOIN categories c ON c.id = b.category_id AND c.profile_id = b.profile_id
       WHERE b.profile_id IN (${inClause}) AND b.start_date <= ?
       ORDER BY b.start_date DESC`,
    ...pids,
    month
  );

  if (budgets.length === 0) {
    return c.json({
      period: month,
      history: [],
      forecast: [],
      total_budget: 0,
      avg_adherence: 0,
    });
  }

  // Historical spending by category (all available history; matches Express, which
  // builds the query then never binds the unused startHistory cutoff).
  const historicalData = await db.all<{
    month: string;
    category_id: number;
    period: string;
    spent: number;
  }>(
    c.env.DB,
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
      WHERE b.profile_id IN (${inClause})
      GROUP BY month, b.category_id, b.period`,
    ...pids
  );

  const categoryAverages: Record<number, { total: number; count: number; avgAmount: number }> = {};
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
      categoryAverages[cid].avgAmount = categoryAverages[cid].total / categoryAverages[cid].count;
    }
  }

  // Forecast for the next 6 months.
  const forecastMonths: Array<{ month: string; label: string }> = [];
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

    const currentBudget =
      budgets.find((b) => b.start_date === fmMonthStr) || budgets[budgets.length - 1];

    const avgSpending = categoryAverages[currentBudget.category_id]
      ? categoryAverages[currentBudget.category_id].avgAmount
      : currentBudget.amount * 0.5;

    const monthsDiff = new Date(fm.month + '-01').getMonth() - new Date().getMonth();
    const inflationFactor = Math.pow(1.03, Math.max(0, monthsDiff));

    const predictedSpent = avgSpending * inflationFactor;
    const adherence =
      currentBudget.amount > 0 ? Math.min(100, (predictedSpent / currentBudget.amount) * 100) : 0;
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

  const historyData = await db.all<{
    month: string;
    total_budget: number | null;
    total_spent: number | null;
  }>(
    c.env.DB,
    `SELECT
        strftime('%Y-%m', start_date) as month,
        SUM(b.amount) as total_budget,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as total_spent
      FROM budgets b
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.profile_id = b.profile_id
        AND t.date >= b.start_date
        AND t.date < date(b.start_date, '+1 month')
      WHERE b.profile_id IN (${inClause}) AND strftime('%Y-%m', start_date) <= ?
      GROUP BY month
      ORDER BY month DESC
      LIMIT ?`,
    ...pids,
    now.toISOString().slice(0, 7),
    6
  );

  const history = historyData.map((h) => ({
    month: h.month,
    label: new Date(h.month + '-01').toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    }),
    total_budget: h.total_budget || 0,
    total_spent: h.total_spent || 0,
    adherence:
      (h.total_budget || 0) > 0
        ? Math.min(100, ((h.total_spent || 0) / (h.total_budget || 0)) * 100)
        : 0,
  }));

  const avgAdherence =
    history.length > 0 ? history.reduce((sum, h) => sum + h.adherence, 0) / history.length : 0;

  return c.json({
    period: month,
    history,
    forecast: forecastData,
    total_budget: budgets.reduce((sum, b) => sum + b.amount, 0),
    avg_adherence: Math.round(avgAdherence),
  });
});

// POST /api/budgets/allocate — create a monthly budget for a category after existence check.
budgetsRoutes.post('/api/budgets/allocate', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const { category_id, amount, period } = b;

  if (!category_id || amount == null) {
    throw new HttpError(400, 'Category ID and amount are required');
  }

  const budgetPeriod = period || 'monthly';

  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const start_date = `${month}-01`;

  // budgetsRepo.getByCategoryForMonth
  const existing = await db.first(
    c.env.DB,
    'SELECT * FROM budgets WHERE category_id = ? AND profile_id = ? AND start_date = ? AND period = ?',
    category_id,
    pid,
    start_date,
    budgetPeriod
  );

  if (existing) {
    throw new HttpError(
      400,
      `Budget already exists for ${month}. Use PUT /api/budgets/:id to update it.`
    );
  }

  const info = await db.insert(c.env.DB, 'budgets', {
    category_id,
    amount,
    period: budgetPeriod,
    start_date,
    profile_id: pid,
  });

  return c.json({
    id: info.meta.last_row_id,
    category_id,
    amount,
    period: budgetPeriod,
    start_date,
    profile_id: pid,
    message: 'Budget allocated successfully',
  });
});

// POST /api/budgets/from-expenses — replace current-month budgets from last month's expenses.
budgetsRoutes.post('/api/budgets/from-expenses', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const body = (await c.req.json()) as Record<string, any>;
  const { year, month } = body;

  let prevYear = year || new Date().getFullYear();
  let prevMonth = (month || new Date().getMonth() + 1) - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear--;
  }

  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  const prevEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;

  const expenses = await db.all<{ category_id: number; name: string; total: number }>(
    c.env.DB,
    `SELECT t.category_id, c.name, SUM(COALESCE(t.amount_local, t.amount)) as total
       FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id = ? AND t.date >= ? AND t.date < ? AND t.type = 'expense' AND t.category_id IS NOT NULL
       GROUP BY t.category_id`,
    pid,
    prevStart,
    prevEnd
  );

  if (expenses.length === 0) {
    return c.json({ ok: false, message: 'No expenses found for previous month' });
  }

  const currYear = year || new Date().getFullYear();
  const currMonth = month || new Date().getMonth() + 1;
  const currStart = `${currYear}-${String(currMonth).padStart(2, '0')}-01`;

  // budgetsRepo.deleteByDateRange — clear existing budgets for the current month.
  await db.run(
    c.env.DB,
    'DELETE FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ?',
    pid,
    currStart,
    `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`
  );

  // Batch all INSERTs into a single D1 batch call to avoid N+1 round-trips.
  if (expenses.length > 0) {
    const stmts = expenses.map((item) =>
      c.env.DB.prepare(
        'INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(item.category_id, item.total, 'monthly', currStart, pid)
    );
    await c.env.DB.batch(stmts);
  }

  return c.json({ ok: true, count: expenses.length });
});

// POST /api/budgets/backfill-from-spending — for every month in the range, set each
// category's monthly budget to that month's actual spending. Fills historical months so
// budget-vs-spent charts aren't empty after an import. Overwrites existing budgets in the
// range (deliberate "set to spent" action). from_month/to_month are 'YYYY-MM'; omit to
// cover the full data range.
budgetsRoutes.post('/api/budgets/backfill-from-spending', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const monthRe = /^\d{4}-\d{2}$/;
  let fromMonth: string | null = monthRe.test(body.from_month) ? body.from_month : null;
  let toMonth: string | null = monthRe.test(body.to_month) ? body.to_month : null;

  if (!fromMonth || !toMonth) {
    const range = await db.first<{ minm: string | null; maxm: string | null }>(
      c.env.DB,
      `SELECT substr(MIN(date),1,7) minm, substr(MAX(date),1,7) maxm
         FROM transactions WHERE profile_id = ? AND type = 'expense'`,
      pid
    );
    if (!range?.minm || !range?.maxm) {
      return c.json({ ok: false, message: 'No expenses to backfill' });
    }
    fromMonth = fromMonth || range.minm;
    toMonth = toMonth || range.maxm;
  }

  const fromStart = `${fromMonth}-01`;
  const [ty, tm] = toMonth.split('-').map(Number);
  // Exclusive end = first day of the month AFTER to_month.
  const toEnd = tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, '0')}-01`;

  const rows = await db.all<{ ym: string; category_id: number; total: number }>(
    c.env.DB,
    `SELECT substr(t.date,1,7) ym, t.category_id, SUM(COALESCE(t.amount_local, t.amount)) total
       FROM transactions t
       WHERE t.profile_id = ? AND t.type = 'expense' AND t.category_id IS NOT NULL
         AND t.date >= ? AND t.date < ?
       GROUP BY ym, t.category_id`,
    pid,
    fromStart,
    toEnd
  );

  if (rows.length === 0) {
    return c.json({ ok: false, message: 'No expenses in the selected range' });
  }

  // Clear budgets in the range, then re-create one per (month, category-with-spending).
  await db.run(
    c.env.DB,
    'DELETE FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ?',
    pid,
    fromStart,
    toEnd
  );

  const months = new Set<string>();
  const stmts = rows.map((r) => {
    months.add(r.ym);
    return c.env.DB.prepare(
      'INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(r.category_id, r.total, 'monthly', `${r.ym}-01`, pid);
  });
  for (let i = 0; i < stmts.length; i += 50) {
    await c.env.DB.batch(stmts.slice(i, i + 50));
  }

  return c.json({ ok: true, count: rows.length, months: months.size });
});

// POST /api/budgets/duplicate-last — copy the previous month's budgets into the current month.
budgetsRoutes.post('/api/budgets/duplicate-last', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const body = (await c.req.json()) as Record<string, any>;
  const { year, month } = body;

  let prevYear = year || new Date().getFullYear();
  let prevMonth = (month || new Date().getMonth() + 1) - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear--;
  }

  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;

  const prevBudgetsCheck = await db.all(
    c.env.DB,
    `SELECT category_id, amount, period
       FROM budgets
       WHERE profile_id = ? AND start_date >= ? AND start_date < ?`,
    pid,
    prevStart,
    `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`
  );

  if (prevBudgetsCheck.length === 0) {
    return c.json({ ok: false, message: 'No budgets found for previous month' });
  }

  const currYear = year || new Date().getFullYear();
  const currMonth = month || new Date().getMonth() + 1;

  // budgetsRepo.duplicateLast — recomputes its own previous month via a LIKE match,
  // then INSERT OR REPLACE into the current-month start_date.
  const dlPrevMonth = currMonth === 1 ? 12 : currMonth - 1;
  const dlPrevYear = currMonth === 1 ? currYear - 1 : currYear;
  const dlPrevBudgets = await db.all<BudgetRow>(
    c.env.DB,
    'SELECT * FROM budgets WHERE profile_id = ? AND start_date LIKE ?',
    pid,
    `${dlPrevYear}-${String(dlPrevMonth).padStart(2, '0')}%`
  );
  const startDate = `${currYear}-${String(currMonth).padStart(2, '0')}-01`;
  let count = 0;
  for (const b of dlPrevBudgets) {
    await db.run(
      c.env.DB,
      'INSERT OR REPLACE INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, ?, ?, ?)',
      pid,
      b.category_id,
      b.amount,
      b.period,
      startDate
    );
    count++;
  }

  return c.json({ ok: true, count });
});

// ── Parametric /:id routes — registered last so static segments above win ─────

budgetsRoutes.put('/api/budgets/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const res = await db.update(
    c.env.DB,
    'budgets',
    {
      category_id: b.category_id,
      amount: b.amount,
      period: b.period,
      start_date: b.start_date,
      end_date: b.end_date || null,
      rollover_enabled: b.rollover_enabled ? 1 : 0,
    },
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

budgetsRoutes.delete('/api/budgets/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.del(
    c.env.DB,
    'budgets',
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

// Manual rollover adjustment — dynamic single-table update on the budget row.
budgetsRoutes.put('/api/budgets/:id/rollover', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const b = (await c.req.json()) as Record<string, any>;

  const updates: string[] = [];
  const values: unknown[] = [];
  if (b.rollover_amount !== undefined) {
    updates.push('rollover_amount = ?');
    values.push(b.rollover_amount);
  }
  if (b.rollover_used !== undefined) {
    updates.push('rollover_used = ?');
    values.push(b.rollover_used);
  }
  if (b.rollover_enabled !== undefined) {
    updates.push('rollover_enabled = ?');
    values.push(b.rollover_enabled ? 1 : 0);
  }
  if (updates.length === 0) throw new HttpError(400, 'No rollover fields provided');

  values.push(id, pid);
  const res = await db.run(
    c.env.DB,
    `UPDATE budgets SET ${updates.join(', ')} WHERE id = ? AND profile_id = ?`,
    ...values
  );
  if (!res.meta.changes) throw new HttpError(404, 'Budget not found');

  const budget = await db.first(
    c.env.DB,
    'SELECT * FROM budgets WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  return c.json({ ok: true, budget });
});
