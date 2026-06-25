const express = require('express');
const { calcMonthlyPayment } = require('../models/loanCalculator');
const { getProfileId } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError , requireAuth }) {
  const router = express.Router();

  // ── Loan Payment Calculator ──────────────────────────────────────────
  router.get('/api/calculators/loans', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const principal = parseFloat(req.query.principal);
    const rate = parseFloat(req.query.rate);
    const term = parseFloat(req.query.term);

    if (isNaN(principal) || principal <= 0)
      return res.status(400).json({ error: 'Principal must be a positive number' });
    if (isNaN(rate) || rate < 0)
      return res.status(400).json({ error: 'Rate must be a non-negative number' });
    if (isNaN(term) || term < 1 || !Number.isInteger(term))
      return res.status(400).json({ error: 'Term must be a positive integer' });

    const monthlyPayment = calcMonthlyPayment(principal, rate, term);
    const totalPayment = monthlyPayment * term;
    const totalInterest = totalPayment - principal;

    res.json({
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalPayment: Math.round(totalPayment * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
      principal,
      rate,
      termMonths: term,
    });

  }));

  // ── Mortgage Calculator ──────────────────────────────────────────────
  router.get('/api/calculators/mortgages', apiRateLimiter, asyncHandler((req, res) => {
    const principal = parseFloat(req.query.principal);
    const rate = parseFloat(req.query.rate);
    const term = parseFloat(req.query.term);
    const downPayment = parseFloat(req.query.downPayment) || 0;
    const downPaymentPercent = parseFloat(req.query.downPaymentPercent) || 0;
    const propertyTax = parseFloat(req.query.propertyTax) || 0;
    const monthlyInsurance = parseFloat(req.query.monthlyInsurance) || 0;
    const noPmi = req.query.noPmi === 'true';

    if (isNaN(principal) || principal <= 0)
      return res.status(400).json({ error: 'Principal must be a positive number' });
    if (isNaN(rate) || rate < 0)
      return res.status(400).json({ error: 'Rate must be non-negative' });
    if (isNaN(term) || term < 1)
      return res.status(400).json({ error: 'Term must be a positive integer' });

    let effectiveDown = downPayment;
    if (downPaymentPercent > 0) {
      effectiveDown = principal * (downPaymentPercent / 100);
    }

    const loanAmount = principal - effectiveDown;
    const termMonths = term;
    const monthlyPayment = calcMonthlyPayment(loanAmount, rate, termMonths);

    // PMI: typically 0.5-1% of loan annually if down payment < 20%
    let pmi = 0;
    if (!noPmi && effectiveDown / principal < 0.2) {
      pmi = (loanAmount * 0.0075) / 12; // 0.75% annual PMI
    }

    const totalMonthly = monthlyPayment + propertyTax / 12 + monthlyInsurance + pmi;
    const totalPayment = totalMonthly * termMonths;
    const totalInterest =
      totalPayment -
      loanAmount -
      propertyTax * term -
      monthlyInsurance * termMonths -
      pmi * termMonths;

    res.json({
      monthlyPayment: Math.round(totalMonthly * 100) / 100,
      principalAndInterest: Math.round(monthlyPayment * 100) / 100,
      propertyTax: Math.round((propertyTax / 12) * 100) / 100,
      insurance: Math.round(monthlyInsurance * 100) / 100,
      pmi: Math.round(pmi * 100) / 100,
      totalPayment: Math.round(totalPayment * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
      loanAmount: Math.round(loanAmount * 100) / 100,
      downPayment: effectiveDown,
      rate,
      termYears: term,
    });

  }));

  // ── Savings Goal Calculator ──────────────────────────────────────────
  router.get('/api/calculators/savings', apiRateLimiter, asyncHandler((req, res) => {
    const goalAmount = parseFloat(req.query.goalAmount);
    const currentAmount = parseFloat(req.query.currentAmount);
    const monthlyContribution = parseFloat(req.query.monthlyContribution);
    const annualRate = parseFloat(req.query.annualRate);

    if (isNaN(goalAmount) || goalAmount <= 0)
      return res.status(400).json({ error: 'Goal amount must be positive' });
    if (isNaN(currentAmount))
      return res.status(400).json({ error: 'Current amount is required' });
    if (isNaN(monthlyContribution))
      return res.status(400).json({ error: 'Monthly contribution is required' });
    if (monthlyContribution < 0)
      return res.status(400).json({ error: 'Monthly contribution must be non-negative' });
    if (isNaN(annualRate) || annualRate < 0)
      return res.status(400).json({ error: 'Annual rate must be non-negative' });

    if (currentAmount >= goalAmount) {
      return res.json({
        monthsToGoal: 0,
        yearsToGoal: 0,
        goalAmount,
        currentAmount,
        monthlyContribution,
        annualRate,
        finalBalance: currentAmount,
        status: 'already_achieved',
      });
    }

    const monthlyRate = annualRate / 100 / 12;
    let balance = currentAmount;
    let months = 0;
    const maxMonths = 1200; // 100 years safety cap

    while (balance < goalAmount && months < maxMonths) {
      balance = balance * (1 + monthlyRate) + monthlyContribution;
      months++;
    }

    if (months >= maxMonths && balance < goalAmount) {
      return res.json({
        monthsToGoal: -1,
        yearsToGoal: -1,
        goalAmount,
        currentAmount,
        monthlyContribution,
        annualRate,
        finalBalance: Math.round(balance * 100) / 100,
        status: 'not_achievable',
      });
    }

    res.json({
      monthsToGoal: months,
      yearsToGoal: Math.round((months / 12) * 10) / 10,
      goalAmount,
      currentAmount,
      monthlyContribution,
      annualRate,
      finalBalance: Math.round(balance * 100) / 100,
      status: 'on_track',
    });

  }));

  // ── Retirement Calculator ────────────────────────────────────────────
  router.get('/api/calculators/retirement', apiRateLimiter, asyncHandler((req, res) => {
    const currentAge = parseInt(req.query.currentAge);
    const retirementAge = parseInt(req.query.retirementAge);
    const currentSavings = parseFloat(req.query.currentSavings);
    const monthlyContribution = parseFloat(req.query.monthlyContribution);
    const annualReturn = parseFloat(req.query.annualReturn);
    const withdrawalRate = parseFloat(req.query.withdrawalRate);
    const country = (req.query.country || 'US').toUpperCase();

    if (
      isNaN(currentAge) ||
      isNaN(retirementAge) ||
      isNaN(currentSavings) ||
      isNaN(monthlyContribution) ||
      isNaN(annualReturn) ||
      isNaN(withdrawalRate)
    )
      return res.status(400).json({ error: 'All numeric parameters are required' });
    if (monthlyContribution < 0)
      return res.status(400).json({ error: 'Monthly contribution must be non-negative' });
    if (retirementAge <= currentAge)
      return res.status(400).json({ error: 'Retirement age must be greater than current age' });
    if (!['US', 'CA', 'GB', 'AU', 'DE', 'FR'].includes(country))
      return res.status(400).json({ error: 'Unsupported country code' });

    const yearsToRetirement = retirementAge - currentAge;
    const monthlyRate = annualReturn / 100 / 12;

    // Future value of current savings
    const futureValueCurrent = currentSavings * Math.pow(1 + monthlyRate, yearsToRetirement * 12);

    // Future value of monthly contributions (annuity formula)
    let futureValueContributions = 0;
    if (monthlyRate > 0) {
      futureValueContributions =
        monthlyContribution *
        ((Math.pow(1 + monthlyRate, yearsToRetirement * 12) - 1) / monthlyRate);
    } else {
      futureValueContributions = monthlyContribution * yearsToRetirement * 12;
    }

    const retirementSavings = futureValueCurrent + futureValueContributions;
    const annualWithdrawal = retirementSavings * (withdrawalRate / 100);
    const yearsInRetirement =
      withdrawalRate > 0 ? Math.floor(retirementSavings / annualWithdrawal) : 30;
    const shortfall = yearsInRetirement < 30 ? (30 - yearsInRetirement) * annualWithdrawal : 0;
    const yearsOfRunway =
      annualWithdrawal > 0 ? Math.floor(retirementSavings / annualWithdrawal) : 999;

    res.json({
      currentAge,
      retirementAge,
      yearsToRetirement,
      retirementSavings: Math.round(retirementSavings * 100) / 100,
      annualWithdrawal: Math.round(annualWithdrawal * 100) / 100,
      yearsInRetirement,
      yearsOfRunway,
      shortfall: Math.round(shortfall * 100) / 100,
      monthlyContribution,
      annualReturn,
      withdrawalRate,
      country,
    });

  }));

  // ── Amortization Schedule ────────────────────────────────────────────
  router.get('/api/calculators/loans/amortization', apiRateLimiter, asyncHandler((req, res) => {
    const principal = parseFloat(req.query.principal);
    const rate = parseFloat(req.query.rate);
    const term = parseFloat(req.query.term);

    if (isNaN(principal) || principal <= 0)
      return res.status(400).json({ error: 'Principal must be positive' });
    if (isNaN(rate) || rate < 0)
      return res.status(400).json({ error: 'Rate must be non-negative' });
    if (isNaN(term) || term < 1 || !Number.isInteger(term))
      return res.status(400).json({ error: 'Term must be a positive integer' });

    const monthlyRate = rate / 100 / 12;
    const termMonths = term; // term is already in months for amortization
    const monthlyPayment =
      rate === 0
        ? principal / termMonths
        : (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
          (Math.pow(1 + monthlyRate, termMonths) - 1);

    let balance = principal;
    const schedule = [];
    const startDate = new Date();

    for (let i = 1; i <= termMonths; i++) {
      const interest = balance * monthlyRate;
      const principalPayment = monthlyPayment - interest;
      balance = Math.max(0, balance - principalPayment);

      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      schedule.push({
        month: i,
        payment: Math.round(monthlyPayment * 100) / 100,
        principal: Math.round(principalPayment * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        balance: Math.round(balance * 100) / 100,
        date: d.toISOString().split('T')[0],
      });
    }

    res.json({
      schedule,
      principal,
      rate,
      termYears: term,
      termMonths,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    });

  }));

  // ── Currency Converter ───────────────────────────────────────────────
  const FIXED_RATES = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.36,
    AUD: 1.53,
    JPY: 149.5,
    CHF: 0.89,
    CNY: 7.24,
    INR: 83.1,
    MXN: 17.2,
    BRL: 5.1,
    KRW: 1320,
    SEK: 10.5,
    NOK: 10.7,
    NZD: 1.65,
  };

  router.get('/api/calculators/currency', apiRateLimiter, asyncHandler((req, res) => {
    const from = (req.query.from || '').toUpperCase();
    const to = (req.query.to || '').toUpperCase();
    const amount = parseFloat(req.query.amount);

    if (!FIXED_RATES[from] || !FIXED_RATES[to])
      return res.status(400).json({ error: 'Unsupported currency code' });
    if (isNaN(amount) || amount <= 0)
      return res.status(400).json({ error: 'Amount must be a positive number' });

    const rate = FIXED_RATES[to] / FIXED_RATES[from];
    const convertedAmount = amount * rate;

    res.json({
      amount,
      from,
      to,
      rate: Math.round(rate * 10000) / 10000,
      convertedAmount: Math.round(convertedAmount * 100) / 100,
    });

  }));

  // ── Unit Converter ───────────────────────────────────────────────────
  const UNIT_CONVERSIONS = {
    // Distance
    'miles:kilometers': (v) => v * 1.60934,
    'kilometers:miles': (v) => v / 1.60934,
    'meters:feet': (v) => v * 3.28084,
    'feet:meters': (v) => v / 3.28084,
    // Weight
    'pounds:kilograms': (v) => v * 0.453592,
    'kilograms:pounds': (v) => v / 0.453592,
    // Temperature
    'celsius:fahrenheit': (v) => (v * 9) / 5 + 32,
    'fahrenheit:celsius': (v) => ((v - 32) * 5) / 9,
    // Volume
    'gallons:liters': (v) => v * 3.78541,
    'liters:gallons': (v) => v / 3.78541,
    // Area
    'square_miles:acres': (v) => v * 640,
    'acres:square_miles': (v) => v / 640,
  };

  router.get('/api/calculators/units', apiRateLimiter, asyncHandler((req, res) => {
    const value = parseFloat(req.query.value);
    const from = (req.query.from || '').toLowerCase();
    const to = (req.query.to || '').toLowerCase();

    if (isNaN(value)) return res.status(400).json({ error: 'Value must be a number' });

    const key = `${from}:${to}`;
    const converter = UNIT_CONVERSIONS[key];

    if (!converter)
      return res.status(400).json({ error: `Unsupported unit conversion: ${from} to ${to}` });

    const result = converter(value);

    res.json({
      value,
      from,
      to,
      result: Math.round(result * 10000) / 10000,
    });

  }));

  // ── Emergency Fund Calculator (legacy) ──────────────────────────────
  router.get('/api/calculator/emergency-fund', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

    const expenseRows = req.repos.transactions.all(
      `SELECT amount, date FROM transactions
       WHERE profile_id = ? AND type = 'expense' AND date >= ?`,
      pid, dateStr
    );

    const monthlyTotals = {};
    for (const r of expenseRows) {
      const m = r.date.substring(0, 7);
      monthlyTotals[m] = (monthlyTotals[m] || 0) + Math.abs(r.amount);
    }
    const monthsWithData = Object.keys(monthlyTotals).length;
    const avgMonthlyExpenses =
      monthsWithData > 0
        ? Object.values(monthlyTotals).reduce((a, b) => a + b, 0) / monthsWithData
        : 0;

    const accounts = req.repos.accounts.all(
      'SELECT name, type, balance FROM accounts WHERE profile_id = ?',
      pid
    );

    const totalEmergencyFund = accounts
      .filter((a) => a.type === 'savings')
      .reduce((s, a) => s + a.balance, 0);

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
      coverage,
      monthsOfCoverage:
        avgMonthlyExpenses > 0 ? Math.round(totalEmergencyFund / avgMonthlyExpenses) : 999,
    });

  }));

  router.post('/api/calculator/compound-interest', apiRateLimiter, asyncHandler((req, res) => {
    const { principal, monthlyContribution, annualRate, years, compoundFrequency } = req.body;

    if (!principal || principal < 0)
      return res.status(400).json({ error: 'Valid principal is required' });
    if (isNaN(parseFloat(annualRate)))
      return res.status(400).json({ error: 'Valid annual rate is required' });

    const P = parseFloat(principal);
    const r = parseFloat(annualRate) / 100;
    const n = compoundFrequency || 12;
    const t = parseFloat(years) || 10;
    const PMT = parseFloat(monthlyContribution) || 0;

    const futureValuePrincipal = P * Math.pow(1 + r / n, n * t);

    let futureValueContributions = 0;
    if (PMT > 0 && r > 0) {
      const monthlyRate = r / 12;
      futureValueContributions = PMT * ((Math.pow(1 + monthlyRate, t * 12) - 1) / monthlyRate);
    } else if (PMT > 0) {
      futureValueContributions = PMT * t * 12;
    }

    const totalFutureValue = futureValuePrincipal + futureValueContributions;
    const totalContributions = P + PMT * t * 12;
    const interestEarned = totalFutureValue - totalContributions;

    res.json({
      futureValue: Math.round(totalFutureValue * 100) / 100,
      totalContributions: Math.round(totalContributions * 100) / 100,
      interestEarned: Math.round(interestEarned * 100) / 100,
      principal: P,
      monthlyContribution: PMT,
      annualRate: parseFloat(annualRate),
      years: t,
      compoundFrequency: n,
    });

  }));

  return router;
};
