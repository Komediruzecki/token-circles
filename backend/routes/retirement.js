const express = require('express');
const { toCamelCase, calculateRetirementProjection } = require('../utils');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError , requireAuth }) {
  const router = express.Router();

  // ========================
  // RETIREMENT GOALS CRUD
  // ========================

  router.get('/api/retirement-goals', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = req.repos.retirementGoals.all(
      `SELECT * FROM retirement_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`,
      ...pids
    );
    const settingsRow = req.repos.settings.all(
      'SELECT * FROM settings WHERE key = ? AND profile_id = ?',
      'retirement_settings', pids[0]
    );
    const settings = settingsRow.length ? settingsRow[0] : null;
    res.json({
      goals: rows,
      settings: settings ? JSON.parse(settings.value) : {},
    });

  }));

  router.post('/api/retirement-goals', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const {
      name,
      target_amount,
      current_amount,
      deadline,
      target_date,
      notes,
      current_age,
      retirement_age,
      monthly_contribution,
      expected_return_rate,
    } = req.body;
    const dl = deadline || target_date || null;
    if (!name || target_amount == null) {
      return res.status(400).json({ error: 'Name and target amount are required' });
    }
    const info = req.repos.retirementGoals.create({
      profile_id: pid,
      name,
      target_amount,
      current_amount: current_amount || 0,
      deadline: dl,
      notes: notes || '',
      current_age: current_age || 30,
      retirement_age: retirement_age || 65,
      monthly_contribution: monthly_contribution || 0,
      expected_return_rate: expected_return_rate || 7,
    });
    res.json({
      id: info.lastInsertRowid,
      name,
      target_amount,
      current_amount: current_amount || 0,
      deadline: dl,
      notes,
      profile_id: pid,
    });

  }));

  router.put('/api/retirement-goals/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const {
      name,
      target_amount,
      current_amount,
      deadline,
      target_date,
      notes,
      current_age,
      retirement_age,
      monthly_contribution,
      expected_return_rate,
    } = req.body;
    const dl = deadline || target_date || null;
    const result = req.repos.retirementGoals.update(req.params.id, pid, {
      name,
      target_amount,
      current_amount,
      deadline: dl,
      notes: notes || '',
      current_age: current_age || 30,
      retirement_age: retirement_age || 65,
      monthly_contribution: monthly_contribution || 0,
      expected_return_rate: expected_return_rate || 7,
    });
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/retirement-goals/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const result = req.repos.retirementGoals.deleteById(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));

  }));

  // ========================
  // RETIREMENT CALCULATOR
  // ========================

  router.post('/api/calculator/retire', apiRateLimiter, asyncHandler((req, res) => {
    const {
      currentAge = 30,
      retirementAge = 65,
      currentSavings = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      annualExpenses = 30000,
      withdrawalRate = 4,
      inflationRate = 2,
      expensesAtRetirement = null,
      country = '',
    } = req.body;

    // Use direct expenses at retirement if provided, otherwise apply country cost-of-living adjustment
    const colMultipliers = {
      usa: 1.0,
      europe: 0.9,
      switzerland: 1.3,
      croatia: 0.6,
      japan: 0.85,
    };
    const col = colMultipliers[country] || 1.0;
    const adjustedExpenses =
      expensesAtRetirement !== null ? expensesAtRetirement : annualExpenses * col;

    // FIRE number: how much needed to retire (25x rule, or 100 / withdrawalRate)
    const fireNumber = adjustedExpenses / (withdrawalRate / 100);

    // Project savings until retirement
    const monthsToRetirement = (retirementAge - currentAge) * 12;
    if (monthsToRetirement <= 0) {
      return res.status(400).json({ error: 'Retirement age must be greater than current age' });
    }
    const monthlyReturn = annualReturn / 100 / 12;

    let savings = currentSavings;
    const timeline = [];
    for (let m = 0; m <= monthsToRetirement; m++) {
      if (m % 12 === 0) {
        timeline.push({
          year: currentAge + m / 12,
          age: Math.round(currentAge + m / 12),
          savings: Math.round(savings),
        });
      }
      savings = savings * (1 + monthlyReturn) + monthlyContribution;
    }

    // FIRE date: find first month where savings >= fireNumber
    let fireMonth = null;
    let fireAge = null;
    savings = currentSavings;
    for (let m = 1; m <= monthsToRetirement * 2; m++) {
      savings = savings * (1 + monthlyReturn) + monthlyContribution;
      if (savings >= fireNumber && fireMonth === null) {
        fireMonth = m;
        fireAge = currentAge + m / 12;
      }
    }

    // Withdrawal phase projection (20 years)
    let retirementSavings = savings;
    const withdrawalTimeline = [];
    if (fireMonth !== null) {
      const annualWithdrawal = adjustedExpenses;
      for (let y = 0; y < 20; y++) {
        retirementSavings = retirementSavings * (1 + annualReturn / 100) - annualWithdrawal;
        withdrawalTimeline.push({
          year: y + 1,
          savings: Math.max(0, Math.round(retirementSavings)),
          balance: Math.max(0, Math.round(retirementSavings)),
        });
      }
    }

    res.json({
      fireNumber: Math.round(fireNumber),
      fireAge: fireAge ? Math.round(fireAge * 10) / 10 : null,
      fireMonth,
      fireYear: fireAge ? Math.floor(fireAge) : null,
      savingsAtRetirement: Math.round(savings),
      monthsToFire: fireMonth,
      currentNWAtFire: Math.round(savings),
      traditionalRetirementAge: 65,
      timeline: timeline.filter((t) => t.year % 5 === 0 || t.year === currentAge),
      withdrawalTimeline,
      scenarios: [
        {
          name: 'Conservative',
          return: 4,
          fireNumber: Math.round(adjustedExpenses / 0.04),
          fireAge: null,
        },
        {
          name: 'Moderate',
          return: 6,
          fireNumber: Math.round(adjustedExpenses / 0.06),
          fireAge: null,
        },
        {
          name: 'Optimistic',
          return: 8,
          fireNumber: Math.round(adjustedExpenses / 0.08),
          fireAge: null,
        },
      ].map((s) => {
        let m = currentSavings;
        let fa = null;
        for (let mo = 1; mo <= monthsToRetirement * 2; mo++) {
          m = m * (1 + s.return / 100 / 12) + monthlyContribution;
          if (m >= s.fireNumber && fa === null) {
            fa = currentAge + mo / 12;
          }
        }
        return {
          ...s,
          fireAge: fa ? Math.round(fa * 10) / 10 : null,
          reached: fa !== null,
          savingsAtFire: Math.round(m),
          shortfall: fa === null ? s.fireNumber - Math.round(m) : 0,
        };
      }),
      inputs: {
        currentAge,
        retirementAge,
        currentSavings,
        monthlyContribution,
        annualReturn,
        adjustedExpenses,
        withdrawalRate,
        country,
        expensesAtRetirement,
      },
    });

  }));

  // ========================
  // RETIREMENT PROJECTION
  // ========================

  router.get('/api/retirement/projection', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const params = req.query;

    const settingsRow = req.repos.settings.all(
      'SELECT * FROM settings WHERE key = ? AND profile_id = ?',
      'retirement_goals', pid
    );
    const settings = settingsRow.length ? settingsRow[0] : null;

    const result = calculateRetirementProjection(
      null,
      pid,
      settings ? JSON.parse(settings.value) : null,
      parseFloat(params.currentAge || params.age || 30) || 30,
      parseFloat(params.retirementAge || params.retire || 65) || 65,
      parseFloat(params.currentSavings || params.savings || 0) || 0,
      parseFloat(params.monthlyContribution || params.contribution || 500) || 0,
      parseFloat(params.annualReturn || params.return || 7) || 7,
      parseFloat(params.withdrawalRate || params.rate || 4) || 4,
      params.country || 'US'
    );

    res.json(result);

  }));

  return router;
};
