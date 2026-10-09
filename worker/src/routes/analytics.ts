import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileIds } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { localNow } from '../local-date';
import { daysOfWeek, weekLabel, weeksOfMonth, weeksOfYear } from '../../../shared/calendarWeeks';

// Port of backend/routes/analytics.js — read-only stats/analytics aggregations.
// All response objects are built by hand with their exact key casing (labels,
// datasets, numDays, nodes, links, sourceCategory, ...); none go through
// toCamelCase. All analytics reads use the selected household profiles.
//
// The Express module guarded only /api/stats/monthly with requireAuth, but the
// Worker's profile scoping reads c.get('userId'), so requireAuth is applied to
// every route here.
export const analyticsRoutes = new Hono<AppEnv>();

// ── GET /api/stats/monthly ────────────────────────────────────────────────────
analyticsRoutes.get('/api/stats/monthly', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const months = c.req.query('months') ?? '24';
  // Ends today on the person's calendar. The app dates what they enter with their own date, so a
  // range ending on the UTC date left out everything entered between local midnight and the UTC
  // one (00:00-02:00 in CEST) from Monthly Income, Monthly Expense and the savings rate.
  const endDate = localNow(c);
  // From the 1st of the first month, so that month counts whole. setMonth() on today's date began
  // it on today's day of the month instead, and on the 29th to the 31st overflowed past a shorter
  // month: on 31 October, twelve months began on 1 December and left November out.
  const startDate = new Date(
    endDate.getFullYear(),
    endDate.getMonth() - parseInt(String(months)) + 1,
    1
  );
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  const rows = await db.all<{ month: string; type: string | null; total: number | null }>(
    c.env.DB,
    `
      SELECT strftime('%Y-%m', date) as month, type,
        SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
      FROM transactions
      WHERE profile_id IN (${inClause})
        AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `,
    ...pids,
    startStr,
    endStr
  );

  const map: Record<string, { month: string; income: number; expense: number; net?: number }> = {};
  for (const r of rows) {
    if (!map[r.month]) map[r.month] = { month: r.month, income: 0, expense: 0 };
    if (r.type === 'income') map[r.month]!.income = r.total ?? 0;
    if (r.type === 'expense') map[r.month]!.expense = r.total ?? 0;
    map[r.month]!.net = map[r.month]!.income - map[r.month]!.expense;
  }

  return c.json(Object.values(map));
});

// ── GET /api/analytics/daily-heatmap ──────────────────────────────────────────
analyticsRoutes.get('/api/analytics/daily-heatmap', requireAuth, async (c) => {
  const year = parseInt(c.req.query('year') || '');
  if (!year) {
    throw new HttpError(400, 'year query parameter is required');
  }
  const type = c.req.query('type') === 'income' ? 'income' : 'expense';

  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');

  const rows = await db.all<{ date: string; total: number | null }>(
    c.env.DB,
    `SELECT date, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id IN (${inClause})
         AND substr(date, 1, 4) = ?
         AND type = ?
       GROUP BY date`,
    ...pids,
    String(year),
    type
  );

  const dates: Record<string, number | null> = {};
  for (const r of rows) {
    dates[r.date] = r.total;
  }

  return c.json({ dates, year, type });
});

// ── GET /api/analytics/distinct-years ─────────────────────────────────────────
analyticsRoutes.get('/api/analytics/distinct-years', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const rows = await db.all<{ year: string }>(
    c.env.DB,
    `SELECT DISTINCT substr(date, 1, 4) as year FROM transactions WHERE profile_id IN (${inClause}) ORDER BY year DESC`,
    ...pids
  );
  const years = rows.map((r) => parseInt(r.year));
  const currentYear = localNow(c).getFullYear();
  if (years.length === 0) years.push(currentYear);
  if (!years.includes(currentYear)) years.unshift(currentYear);
  return c.json({ years });
});

// ── GET /api/analytics/weeks ──────────────────────────────────────────────────
analyticsRoutes.get('/api/analytics/weeks', requireAuth, async (c) => {
  // Profile scoping is resolved/authorized to match the Express route even though
  // the week list itself is computed purely from the calendar.
  await getProfileIds(c);
  const year = parseInt(c.req.query('year') || '');
  const monthQ = c.req.query('month');
  if (!year) {
    return c.json({ weeks: [] });
  }
  // Sunday to Saturday, every week that holds a day of the month (shared/calendarWeeks.ts, as
  // local-first lists them). Stepping a week at a time from the 1st stopped at the week of the
  // 29th, so a month's last days that start a new week were in none.
  const weeks = monthQ ? weeksOfMonth(year, parseInt(monthQ)) : weeksOfYear(year);
  return c.json({ weeks: weeks.map((w) => ({ week: w.week, label: weekLabel(w) })) });
});

// ── GET /api/analytics/category-trends ────────────────────────────────────────
analyticsRoutes.get('/api/analytics/category-trends', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = parseInt(c.req.query('year') || '') || localNow(c).getFullYear();
  const monthQ = c.req.query('month');
  const month = monthQ ? String(monthQ).padStart(2, '0') : null;
  const week = c.req.query('week') ? parseInt(c.req.query('week')!) : null;
  const type = c.req.query('type') || 'expense';
  // A week of the month as /api/analytics/weeks lists and labels it, Sunday to Saturday
  // (shared/calendarWeeks.ts). This used to read week N as days 7N-6 to 7N of the month, so week
  // 2 answered the 8th to the 14th under the label of the 2nd to the 8th. A week the month does
  // not have answers the whole month.
  const picked =
    month && week ? weeksOfMonth(year, parseInt(month)).find((w) => w.week === week) : undefined;

  // Date range.
  let startStr: string;
  let endStr: string;
  if (picked) {
    startStr = picked.start;
    endStr = picked.end;
  } else if (month) {
    // Full month.
    const lastDay = new Date(year, parseInt(month), 0).getDate();
    startStr = `${year}-${month}-01`;
    endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  } else {
    // Full year.
    startStr = `${year}-01-01`;
    endStr = `${year}-12-31`;
  }

  // Number of days in the selected period.
  const [startY, startM, startD] = startStr.split('-').map(Number);
  const [endY, endM, endD] = endStr.split('-').map(Number);
  const startDate = new Date(startY!, startM! - 1, startD!);
  const endDate = new Date(endY!, endM! - 1, endD!);
  const numDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Transactions and categories filtered by type (income or expense).
  const transactions = await db.all<{
    date: string;
    amount: number;
    cat_id: number;
    cat_name: string;
    cat_color: string | null;
  }>(
    c.env.DB,
    `SELECT t.date, COALESCE(t.amount_local, t.amount) as amount, c.id as cat_id, c.name as cat_name, c.color as cat_color FROM transactions t JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date`,
    ...pids,
    type,
    startStr,
    endStr
  );

  const categories = await db.all<{ id: number; name: string; color: string | null }>(
    c.env.DB,
    `SELECT id, name, color FROM categories WHERE profile_id IN (${inClause}) AND type = ? ORDER BY name`,
    ...pids,
    type
  );

  // Generate labels based on view level.
  const labels: string[] = [];
  const periodMap = new Map<string, number>();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthNamesFull = [
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

  if (picked) {
    // Week view: its seven days, Sunday to Saturday, the first or last of them in the month next
    // door when the week crosses into one, as its label says.
    daysOfWeek(picked).forEach((day, i) => {
      labels.push(dayNames[i]!);
      periodMap.set(day, i);
    });
  } else if (month) {
    // Month view: show day numbers.
    const lastDay = new Date(year, parseInt(month), 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      labels.push(`${monthNamesFull[parseInt(month) - 1]} ${d}`);
      periodMap.set(`${year}-${month}-${String(d).padStart(2, '0')}`, labels.length - 1);
    }
  } else {
    // Year view: show 12 months.
    for (let m = 0; m < 12; m++) {
      labels.push(`${monthNames[m]} ${year}`);
      periodMap.set(`${year}-${String(m + 1).padStart(2, '0')}`, m);
    }
  }

  // Initialize datasets for each category.
  const catDataMap: Record<number, { category: string; color: string | null; data: number[] }> = {};
  categories.forEach((cat) => {
    catDataMap[cat.id] = {
      category: cat.name,
      color: cat.color,
      data: new Array(labels.length).fill(0),
    };
  });

  // Aggregate transactions.
  transactions.forEach((t) => {
    // For month/week views use full date (YYYY-MM-DD), for year view use YYYY-MM.
    const dateKey = month ? t.date : t.date.substring(0, 7);
    const idx = periodMap.get(dateKey);
    if (idx !== undefined && catDataMap[t.cat_id]) {
      catDataMap[t.cat_id]!.data[idx] += t.amount;
    }
  });

  // Convert to array and sort by total.
  const datasets = Object.values(catDataMap)
    .filter((d) => d.data.some((v) => v > 0))
    .sort((a, b) => {
      const totalA = a.data.reduce((x, y) => x + y, 0);
      const totalB = b.data.reduce((x, y) => x + y, 0);
      return totalB - totalA;
    });

  return c.json({ labels, datasets, numDays });
});

// ── GET /api/analytics/sankey (Budget vs Actual) ──────────────────────────────
analyticsRoutes.get('/api/analytics/sankey', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = parseInt(c.req.query('year') || '') || localNow(c).getFullYear();
  const monthQ = c.req.query('month');
  const month = monthQ ? String(monthQ).padStart(2, '0') : null;

  if (!month) {
    return c.json({ nodes: [], links: [] });
  }

  const lastDay = new Date(year, parseInt(month), 0).getDate();
  const startStr = `${year}-${month}-01`;
  const endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

  // Budgets for this month: the rows that start in it, as the Budgets page reads them (D13).
  // The Budgets page keeps one row per category and month, with no end_date, so the old test
  // (started by this month, not yet ended) matched every earlier month's row too, and GROUP BY
  // kept one of them: March's flow showed February's budget.
  const budgets = await db.all<{
    category_id: number;
    budget_amount: number;
    cat_name: string;
    cat_color: string | null;
  }>(
    c.env.DB,
    `
      SELECT b.category_id, b.amount as budget_amount, c.name as cat_name, c.color as cat_color
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id IN (${inClause}) AND (b.period = 'month' OR b.period = 'monthly')
      AND strftime('%Y-%m', b.start_date) = ?
      GROUP BY b.category_id
    `,
    ...pids,
    `${year}-${month}`
  );

  // Actual spending for this month.
  const actualSpending = await db.all<{ category_id: number | null; actual_amount: number }>(
    c.env.DB,
    `
      SELECT t.category_id, SUM(COALESCE(t.amount_local, t.amount)) as actual_amount
      FROM transactions t
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY t.category_id
    `,
    ...pids,
    startStr,
    endStr
  );

  // Maps for easy lookup.
  const actualMap = new Map<number | null, { category_id: number | null; actual_amount: number }>(
    actualSpending.map((a) => [a.category_id, a])
  );

  // Category name/colour lookup (needed for spending in categories that have no
  // budget row this month).
  const cats = await db.all<{ id: number; name: string; color: string | null }>(
    c.env.DB,
    `SELECT id, name, color FROM categories WHERE profile_id IN (${inClause})`,
    ...pids
  );
  const catMap = new Map(cats.map((cat) => [cat.id, cat]));
  const budgetMap = new Map(budgets.map((b) => [b.category_id, b]));

  // Build nodes and links for sankey.
  interface SankeyNode {
    name: string;
    category: string;
    color?: string | null;
  }
  interface SankeyLink {
    source: string;
    target: string;
    value: number;
    sourceCategory: string;
    targetCategory: string;
  }
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // Categories to show: any with a budget or actual spending this month. Spending without a
  // category is one of them, as Uncategorized: it was left out, so Total Actual was short of what
  // the month cost by exactly that much, and local-first showed it.
  const catIds = new Set<number | null>([
    ...budgetMap.keys(),
    ...actualSpending.map((a) => a.category_id),
  ]);
  // Nothing to visualize — let the UI show its empty state.
  if (catIds.size === 0) {
    return c.json({ nodes: [], links: [], hasBudgets: false });
  }

  const hasBudgets = budgets.length > 0;
  const BUDGET = 'Total Budget';
  const ACTUAL = 'Total Actual';
  nodes.push({ name: BUDGET, category: 'budget' });

  // One row per category. When a category has no explicit budget we treat its
  // budget as its own spending, so an un-budgeted month still renders a proper
  // flow (Budget -> Category -> Actual) that collapses to spending == budget.
  // Once the user sets real budgets, the planned-vs-actual gap appears.
  let totalBudget = 0;
  let totalActual = 0;
  for (const catId of catIds) {
    const cat = catId === null ? undefined : catMap.get(catId);
    const catName = cat?.name || 'Uncategorized';
    const actualRow = actualMap.get(catId);
    const actual = actualRow ? actualRow.actual_amount : 0;
    const explicit = catId === null ? undefined : budgetMap.get(catId);
    const budget = explicit ? explicit.budget_amount : actual;
    if (budget <= 0 && actual <= 0) continue;
    nodes.push({ name: catName, category: 'category', color: cat?.color });
    if (budget > 0) {
      totalBudget += budget;
      links.push({
        source: BUDGET,
        target: catName,
        value: budget,
        sourceCategory: 'budget',
        targetCategory: 'category',
      });
    }
    if (actual > 0) {
      totalActual += actual;
      links.push({
        source: catName,
        target: ACTUAL,
        value: actual,
        sourceCategory: 'category',
        targetCategory: 'actual',
      });
    }
  }

  nodes.push({ name: ACTUAL, category: 'actual' });

  // Any planned budget left unspent flows to a savings node.
  const budgetUnused = totalBudget - totalActual;
  if (budgetUnused > 0) {
    nodes.push({ name: 'Unused Budget', category: 'savings' });
    links.push({
      source: BUDGET,
      target: 'Unused Budget',
      value: budgetUnused,
      sourceCategory: 'budget',
      targetCategory: 'savings',
    });
  }

  return c.json({ nodes, links, hasBudgets });
});
