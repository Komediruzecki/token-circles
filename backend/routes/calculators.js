const express = require('express');
const { getProfileId } = require('../middleware/profile');

module.exports = function ({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/calculator/emergency-fund', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);

      // Get monthly expenses from last 12 months
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

      const expenseRows = db
        .prepare(
          `SELECT amount, date FROM transactions
           WHERE profile_id = ? AND type = 'expense' AND date >= ?`
        )
        .all(pid, dateStr);

      // Group by month and calculate average
      const monthlyTotals = {};
      for (const r of expenseRows) {
        const m = r.date.substring(0, 7); // YYYY-MM
        monthlyTotals[m] = (monthlyTotals[m] || 0) + Math.abs(r.amount);
      }
      const monthsWithData = Object.keys(monthlyTotals).length;
      const avgMonthlyExpenses =
        monthsWithData > 0
          ? Object.values(monthlyTotals).reduce((a, b) => a + b, 0) / monthsWithData
          : 0;

      // Get account balances (emergency fund = savings accounts)
      const accounts = db
        .prepare('SELECT name, type, balance FROM accounts WHERE profile_id = ?')
        .all(pid);

      const totalEmergencyFund = accounts
        .filter((a) => a.type === 'savings')
        .reduce((s, a) => s + a.balance, 0);

      const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

      // Coverage levels
      const coverage = [
        { months: 3, label: 'Starter', ratio: 3 },
        { months: 6, label: 'Standard', ratio: 6 },
        { months: 12, label: 'Conservative', ratio: 12 },
      ].map((c) => {
        const required = avgMonthlyExpenses * c.months;
        const current = totalEmergencyFund;
        return {
          months: c.months,
          label: c.label,
          required: Math.round(required),
          current: Math.round(current),
          coveragePct: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 0,
          status: current >= required ? 'complete' : current >= required * 0.5 ? 'partial' : 'low',
        };
      });

      res.json({
        avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
        totalEmergencyFund: Math.round(totalEmergencyFund),
        totalBalance: Math.round(totalBalance),
        monthsWithData,
        coverage,
        accounts: accounts.filter((a) => a.type === 'savings'),
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/calculator/compound-interest', apiRateLimiter, (req, res) => {
    try {
      const {
        principal = 0,
        monthlyContribution = 0,
        annualReturn = 7,
        years = 10,
        compoundsPerYear = 12,
      } = req.body;

      const rate = annualReturn / 100;
      const n = compoundsPerYear;

      const projection = [];
      let balance = principal;
      let totalContributions = principal;

      for (let y = 0; y <= years; y++) {
        projection.push({
          year: y,
          balance: Math.round(balance),
          contributions: Math.round(totalContributions),
          interest: Math.round(balance - totalContributions),
        });

        // Compound for this year
        const yearlyContribution = monthlyContribution * 12;
        for (let p = 0; p < n; p++) {
          balance = balance * (1 + rate / n) + monthlyContribution;
        }
        totalContributions += yearlyContribution;
      }

      // Scenario comparisons: vary return rate
      const scenarios = [
        { name: 'Conservative', return: 4, color: '#3b82f6' },
        { name: 'Moderate', return: 6, color: '#10b981' },
        { name: 'Optimistic', return: 8, color: '#8b5cf6' },
      ].map((s) => {
        const r = s.return / 100;
        let bal = principal;
        let contrib = principal;
        for (let y = 0; y <= years; y++) {
          if (y > 0) {
            for (let p = 0; p < n; p++) {
              bal = bal * (1 + r / n) + monthlyContribution;
            }
            contrib += monthlyContribution * 12;
          }
        }
        return {
          name: s.name,
          return: s.return,
          color: s.color,
          finalBalance: Math.round(bal),
          totalContributions: Math.round(contrib),
          interest: Math.round(bal - contrib),
        };
      });

      res.json({
        projection,
        principal,
        monthlyContribution,
        annualReturn,
        years,
        finalBalance: projection[projection.length - 1].balance,
        totalContributions: projection[projection.length - 1].contributions,
        totalInterest: projection[projection.length - 1].interest,
        scenarios,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
