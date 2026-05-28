const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  // ========================
  // STATS
  // ========================
  router.get('/api/stats/monthly', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { months = 24 } = req.query;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Use amount_local if available (for imported transactions), otherwise amount
      const rows = db
        .prepare(
          `
        SELECT strftime('%Y-%m', date) as month, type,
          SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
        FROM transactions
        WHERE profile_id = ? AND date >= ? AND date <= ? AND type IN ('income', 'expense')
        GROUP BY month, type
        ORDER BY month
      `
        )
        .all(pid, startStr, endStr);

      const map = {};
      for (const r of rows) {
        if (!map[r.month]) map[r.month] = { month: r.month, income: 0, expense: 0 };
        if (r.type === 'income') map[r.month].income = r.total;
        if (r.type === 'expense') map[r.month].expense = r.total;
        map[r.month].net = map[r.month].income - map[r.month].expense;
      }

      res.json(Object.values(map));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // ANALYTICS - Daily Heatmap
  // ========================
  router.get('/api/analytics/daily-heatmap', apiRateLimiter, (req, res) => {
    try {
      const year = parseInt(req.query.year);
      if (!year) {
        res.status(400).json({ error: 'year query parameter is required' });
        return;
      }
      const type = req.query.type === 'income' ? 'income' : 'expense';

      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');

      const rows = db
        .prepare(
          `SELECT date, SUM(amount) as total
           FROM transactions
           WHERE profile_id IN (${inClause})
             AND substr(date, 1, 4) = ?
             AND type = ?
           GROUP BY date`
        )
        .all(...pids, String(year), type);

      const dates = {};
      for (const r of rows) {
        dates[r.date] = r.total;
      }

      res.json({ dates, year, type });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // ANALYTICS
  // ========================
  router.get('/api/analytics/distinct-years', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT DISTINCT substr(date, 1, 4) as year FROM transactions WHERE profile_id IN (${inClause}) ORDER BY year DESC`
        )
        .all(...pids);
      const years = rows.map((r) => parseInt(r.year));
      const currentYear = new Date().getFullYear();
      if (years.length === 0) years.push(currentYear);
      if (!years.includes(currentYear)) years.unshift(currentYear);
      res.json({ years });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/analytics/weeks', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const year = parseInt(req.query.year);
      const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;
      if (!year) {
        res.json({ weeks: [] });
        return;
      }
      const weeks = [];
      const firstDay = month ? new Date(year, parseInt(month) - 1, 1) : new Date(year, 0, 1);
      const last = month ? new Date(year, parseInt(month), 0).getDate() : 31;
      const lastDay = month ? new Date(year, parseInt(month) - 1, last) : new Date(year, 11, 31);
      let w = 1;
      const current = new Date(firstDay);
      while (current <= lastDay) {
        const weekStart = new Date(current);
        weekStart.setDate(current.getDate() - current.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weeks.push({
          week: w,
          label: `Week ${w} (${weekStart.toISOString().slice(0, 10)} - ${weekEnd.toISOString().slice(0, 10)})`,
        });
        current.setDate(current.getDate() + 7);
        w++;
      }
      res.json({ weeks });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // ANALYTICS - Stacked Category Trends
  // ========================
  router.get('/api/analytics/category-trends', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;
      const week = req.query.week ? parseInt(req.query.week) : null;
      const type = req.query.type || 'expense';

      // Date range
      let startStr, endStr;
      if (month) {
        const lastDay = new Date(year, parseInt(month), 0).getDate();
        if (week) {
          // Specific week within a month
          const weekStartDay = (week - 1) * 7 + 1;
          const weekEndDay = Math.min(week * 7, lastDay);
          startStr = `${year}-${month}-${String(weekStartDay).padStart(2, '0')}`;
          endStr = `${year}-${month}-${String(weekEndDay).padStart(2, '0')}`;
        } else {
          // Full month
          startStr = `${year}-${month}-01`;
          endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
        }
      } else {
        // Full year
        startStr = `${year}-01-01`;
        endStr = `${year}-12-31`;
      }

      // Calculate actual number of days in the selected period
      const [startY, startM, startD] = startStr.split('-').map(Number);
      const [endY, endM, endD] = endStr.split('-').map(Number);
      const startDate = new Date(startY, startM - 1, startD);
      const endDate = new Date(endY, endM - 1, endD);
      const numDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

      // Transactions and categories filtered by type (income or expense)
      const transactions = db
        .prepare(
          `SELECT t.date, COALESCE(t.amount_local, t.amount) as amount, c.id as cat_id, c.name as cat_name, c.color as cat_color FROM transactions t JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date`
        )
        .all(...pids, type, startStr, endStr);

      const categories = db
        .prepare(
          `SELECT id, name, color FROM categories WHERE profile_id IN (${inClause}) AND type = ? ORDER BY name`
        )
        .all(...pids, type);

      // Generate labels based on view level
      const labels = [];
      const periodMap = new Map();
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

      if (week && month) {
        // Week view: show days of the week (Sun-Sat) for that month
        const lastDay = new Date(year, parseInt(month), 0).getDate();
        const weekStartDay = (week - 1) * 7 + 1;
        const weekEndDay = Math.min(week * 7, lastDay);
        for (let d = weekStartDay; d <= weekEndDay; d++) {
          const date = new Date(year, parseInt(month) - 1, d);
          labels.push(dayNames[date.getDay()]);
          periodMap.set(`${year}-${month}-${String(d).padStart(2, '0')}`, labels.length - 1);
        }
      } else if (month) {
        // Month view: show day numbers
        const lastDay = new Date(year, parseInt(month), 0).getDate();
        for (let d = 1; d <= lastDay; d++) {
          labels.push(`${monthNamesFull[parseInt(month) - 1]} ${d}`);
          periodMap.set(`${year}-${month}-${String(d).padStart(2, '0')}`, labels.length - 1);
        }
      } else {
        // Year view: show 12 months
        for (let m = 0; m < 12; m++) {
          labels.push(`${monthNames[m]} ${year}`);
          periodMap.set(`${year}-${String(m + 1).padStart(2, '0')}`, m);
        }
      }

      // Initialize datasets for each category
      const catDataMap = {};
      categories.forEach((c) => {
        catDataMap[c.id] = {
          category: c.name,
          color: c.color,
          data: new Array(labels.length).fill(0),
        };
      });

      // Aggregate transactions
      transactions.forEach((t) => {
        // For month/week views use full date (YYYY-MM-DD), for year view use YYYY-MM
        const dateKey = month ? t.date : t.date.substring(0, 7);
        const idx = periodMap.get(dateKey);
        if (idx !== undefined && catDataMap[t.cat_id]) {
          catDataMap[t.cat_id].data[idx] += t.amount;
        }
      });

      // Convert to array and sort by total
      const datasets = Object.values(catDataMap)
        .filter((d) => d.data.some((v) => v > 0))
        .sort((a, b) => {
          const totalA = a.data.reduce((x, y) => x + y, 0);
          const totalB = b.data.reduce((x, y) => x + y, 0);
          return totalB - totalA;
        });

      res.json({ labels, datasets, numDays });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // ANALYTICS: SANKEY (Budget vs Actual)
  // ========================
  router.get('/api/analytics/sankey', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;

      if (!month) {
        return res.json({ nodes: [], links: [] });
      }

      const lastDay = new Date(year, parseInt(month), 0).getDate();
      const startStr = `${year}-${month}-01`;
      const endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      // Get budgets for this month
      const budgets = db
        .prepare(
          `
        SELECT b.category_id, b.amount as budget_amount, c.name as cat_name, c.color as cat_color
        FROM budgets b
        JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
        WHERE b.profile_id IN (${inClause}) AND (b.period = 'month' OR b.period = 'monthly')
        AND strftime('%Y-%m', b.start_date) <= ? AND (b.end_date IS NULL OR strftime('%Y-%m', b.end_date) >= ?)
        GROUP BY b.category_id
      `
        )
        .all(...pids, `${year}-${month}`, `${year}-${month}`);

      // Get actual spending for this month
      const actualSpending = db
        .prepare(
          `
        SELECT t.category_id, SUM(COALESCE(t.amount_local, t.amount)) as actual_amount
        FROM transactions t
        WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
        GROUP BY t.category_id
      `
        )
        .all(...pids, startStr, endStr);

      // Create maps for easy lookup
      const budgetMap = new Map(budgets.map((b) => [b.category_id, b]));
      const actualMap = new Map(actualSpending.map((a) => [a.category_id, a]));

      // Build nodes and links for sankey
      const nodes = [];
      const links = [];
      const nodeNames = new Set();

      // Add "Total Budget" source node
      nodes.push({ name: 'Total Budget', category: 'budget' });
      nodeNames.add('Total Budget');

      // Add category nodes and links
      budgets.forEach((b) => {
        if (!nodeNames.has(b.cat_name)) {
          nodes.push({ name: b.cat_name, category: 'category', color: b.cat_color });
          nodeNames.add(b.cat_name);
        }
      });

      // Add "Total Actual" node
      nodes.push({ name: 'Total Actual', category: 'actual' });
      nodeNames.add('Total Actual');

      // Budget -> Category links (planned flow)
      let totalBudget = 0;
      budgets.forEach((b) => {
        totalBudget += b.budget_amount;
        links.push({
          source: 'Total Budget',
          target: b.cat_name,
          value: b.budget_amount,
          sourceCategory: 'budget',
          targetCategory: 'category',
        });
      });

      // Category -> Actual links (actual spent)
      let totalActual = 0;
      budgets.forEach((b) => {
        const actual = actualMap.get(b.category_id);
        const actualAmount = actual ? actual.actual_amount : 0;
        totalActual += actualAmount;
        links.push({
          source: b.cat_name,
          target: 'Total Actual',
          value: actualAmount,
          sourceCategory: 'category',
          targetCategory: 'actual',
        });
      });

      // If no budgets, use actual spending as flow
      if (budgets.length === 0) {
        actualSpending.forEach((a) => {
          const cat = db
            .prepare('SELECT name, color FROM categories WHERE id = ?')
            .get(a.category_id);
          if (cat) {
            if (!nodeNames.has(cat.name)) {
              nodes.push({ name: cat.name, category: 'category', color: cat.color });
              nodeNames.add(cat.name);
            }
            links.push({
              source: cat.name,
              target: 'Total Actual',
              value: a.actual_amount,
              sourceCategory: 'category',
              targetCategory: 'actual',
            });
          }
        });
      }

      // Budget unused (budget - actual) -> "Savings" node if there's difference
      const budgetUnused = totalBudget - totalActual;
      if (budgetUnused > 0 && budgets.length > 0) {
        nodes.push({ name: 'Unused Budget', category: 'savings' });
        links.push({
          source: 'Total Budget',
          target: 'Unused Budget',
          value: budgetUnused,
          sourceCategory: 'budget',
          targetCategory: 'savings',
        });
      }

      res.json({ nodes, links });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
