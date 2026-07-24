import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import { normalizedTransactionAmountSql } from '../transaction-amount';
import * as db from '../db';

// Port of backend/routes/calculators.js. Every endpoint here is pure math except
// the emergency-fund calc, which reads transactions + accounts for the active
// profile. The Express version rate-limited these and left most unauthenticated;
// the Worker convention is requireAuth on every data route, so all of them gate.
export const calculatorsRoutes = new Hono<AppEnv>();

// Compound-interest projection (pure math). Mirrors the serverless handler
// (frontend/src/core/storage/handlers/calculators.ts) so server and client modes return the
// same shape. Path is singular '/api/calculator/...' to match what the client posts.
calculatorsRoutes.post('/api/calculator/compound-interest', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, number>;
  const {
    principal = 0,
    monthlyContribution = 0,
    annualReturn = 7,
    years = 10,
    compoundsPerYear = 12,
  } = body;
  const rate = annualReturn / 100;
  const n = compoundsPerYear;

  const projection: { year: number; balance: number; contributions: number; interest: number }[] =
    [];
  let balance = principal;
  let totalContributions = principal;
  for (let y = 0; y <= years; y++) {
    projection.push({
      year: y,
      balance: Math.round(balance),
      contributions: Math.round(totalContributions),
      interest: Math.round(balance - totalContributions),
    });
    for (let p = 0; p < n; p++) balance = balance * (1 + rate / n) + monthlyContribution;
    totalContributions += monthlyContribution * 12;
  }

  const scenarios = [
    { name: 'Conservative', return: 4, color: '#6e9bff' },
    { name: 'Moderate', return: 6, color: '#59d2a2' },
    { name: 'Optimistic', return: 8, color: '#f0a860' },
  ].map((s) => {
    const r = s.return / 100;
    let bal = principal;
    let contrib = principal;
    for (let y = 0; y <= years; y++) {
      if (y > 0) {
        for (let p = 0; p < n; p++) bal = bal * (1 + r / n) + monthlyContribution;
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

  const last = projection[projection.length - 1];
  return c.json({
    projection,
    principal,
    monthlyContribution,
    annualReturn,
    years,
    finalBalance: last.balance,
    totalContributions: last.contributions,
    totalInterest: last.interest,
    scenarios,
  });
});

// Monthly payment for a principal at an annual rate over a number of months.
// Ported verbatim from backend/models/loanCalculator.js (calcMonthlyPayment).
function calcMonthlyPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * (r * Math.pow(1 + r, months))) / (Math.pow(1 + r, months) - 1);
}

// ── Loan Payment Calculator ──────────────────────────────────────────
calculatorsRoutes.get('/api/calculators/loans', requireAuth, async (c) => {
  const principal = parseFloat(c.req.query('principal') ?? '');
  const rate = parseFloat(c.req.query('rate') ?? '');
  const term = parseFloat(c.req.query('term') ?? '');

  if (isNaN(principal) || principal <= 0)
    throw new HttpError(400, 'Principal must be a positive number');
  if (isNaN(rate) || rate < 0) throw new HttpError(400, 'Rate must be a non-negative number');
  if (isNaN(term) || term < 1 || !Number.isInteger(term))
    throw new HttpError(400, 'Term must be a positive integer');

  const monthlyPayment = calcMonthlyPayment(principal, rate, term);
  const totalPayment = monthlyPayment * term;
  const totalInterest = totalPayment - principal;

  return c.json({
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    totalPayment: Math.round(totalPayment * 100) / 100,
    totalInterest: Math.round(totalInterest * 100) / 100,
    principal,
    rate,
    termMonths: term,
  });
});

// ── Mortgage Calculator ──────────────────────────────────────────────
calculatorsRoutes.get('/api/calculators/mortgages', requireAuth, async (c) => {
  const principal = parseFloat(c.req.query('principal') ?? '');
  const rate = parseFloat(c.req.query('rate') ?? '');
  const term = parseFloat(c.req.query('term') ?? '');
  const downPayment = parseFloat(c.req.query('downPayment') ?? '') || 0;
  const downPaymentPercent = parseFloat(c.req.query('downPaymentPercent') ?? '') || 0;
  const propertyTax = parseFloat(c.req.query('propertyTax') ?? '') || 0;
  const monthlyInsurance = parseFloat(c.req.query('monthlyInsurance') ?? '') || 0;
  const noPmi = c.req.query('noPmi') === 'true';

  if (isNaN(principal) || principal <= 0)
    throw new HttpError(400, 'Principal must be a positive number');
  if (isNaN(rate) || rate < 0) throw new HttpError(400, 'Rate must be non-negative');
  if (isNaN(term) || term < 1) throw new HttpError(400, 'Term must be a positive integer');

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

  return c.json({
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
});

// ── Savings Goal Calculator ──────────────────────────────────────────
calculatorsRoutes.get('/api/calculators/savings', requireAuth, async (c) => {
  const goalAmount = parseFloat(c.req.query('goalAmount') ?? '');
  const currentAmount = parseFloat(c.req.query('currentAmount') ?? '');
  const monthlyContribution = parseFloat(c.req.query('monthlyContribution') ?? '');
  const annualRate = parseFloat(c.req.query('annualRate') ?? '');

  if (isNaN(goalAmount) || goalAmount <= 0)
    throw new HttpError(400, 'Goal amount must be positive');
  if (isNaN(currentAmount)) throw new HttpError(400, 'Current amount is required');
  if (isNaN(monthlyContribution)) throw new HttpError(400, 'Monthly contribution is required');
  if (monthlyContribution < 0)
    throw new HttpError(400, 'Monthly contribution must be non-negative');
  if (isNaN(annualRate) || annualRate < 0)
    throw new HttpError(400, 'Annual rate must be non-negative');

  if (currentAmount >= goalAmount) {
    return c.json({
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
    return c.json({
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

  return c.json({
    monthsToGoal: months,
    yearsToGoal: Math.round((months / 12) * 10) / 10,
    goalAmount,
    currentAmount,
    monthlyContribution,
    annualRate,
    finalBalance: Math.round(balance * 100) / 100,
    status: 'on_track',
  });
});

// ── Retirement Calculator ────────────────────────────────────────────
calculatorsRoutes.get('/api/calculators/retirement', requireAuth, async (c) => {
  const currentAge = parseInt(c.req.query('currentAge') ?? '');
  const retirementAge = parseInt(c.req.query('retirementAge') ?? '');
  const currentSavings = parseFloat(c.req.query('currentSavings') ?? '');
  const monthlyContribution = parseFloat(c.req.query('monthlyContribution') ?? '');
  const annualReturn = parseFloat(c.req.query('annualReturn') ?? '');
  const withdrawalRate = parseFloat(c.req.query('withdrawalRate') ?? '');
  const country = (c.req.query('country') || 'US').toUpperCase();

  if (
    isNaN(currentAge) ||
    isNaN(retirementAge) ||
    isNaN(currentSavings) ||
    isNaN(monthlyContribution) ||
    isNaN(annualReturn) ||
    isNaN(withdrawalRate)
  )
    throw new HttpError(400, 'All numeric parameters are required');
  if (monthlyContribution < 0)
    throw new HttpError(400, 'Monthly contribution must be non-negative');
  if (retirementAge <= currentAge)
    throw new HttpError(400, 'Retirement age must be greater than current age');
  if (!['US', 'CA', 'GB', 'AU', 'DE', 'FR'].includes(country))
    throw new HttpError(400, 'Unsupported country code');

  const yearsToRetirement = retirementAge - currentAge;
  const monthlyRate = annualReturn / 100 / 12;

  // Future value of current savings
  const futureValueCurrent = currentSavings * Math.pow(1 + monthlyRate, yearsToRetirement * 12);

  // Future value of monthly contributions (annuity formula)
  let futureValueContributions = 0;
  if (monthlyRate > 0) {
    futureValueContributions =
      monthlyContribution * ((Math.pow(1 + monthlyRate, yearsToRetirement * 12) - 1) / monthlyRate);
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

  return c.json({
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
});

// ── Amortization Schedule ────────────────────────────────────────────
calculatorsRoutes.get('/api/calculators/loans/amortization', requireAuth, async (c) => {
  const principal = parseFloat(c.req.query('principal') ?? '');
  const rate = parseFloat(c.req.query('rate') ?? '');
  const term = parseFloat(c.req.query('term') ?? '');

  if (isNaN(principal) || principal <= 0) throw new HttpError(400, 'Principal must be positive');
  if (isNaN(rate) || rate < 0) throw new HttpError(400, 'Rate must be non-negative');
  if (isNaN(term) || term < 1 || !Number.isInteger(term))
    throw new HttpError(400, 'Term must be a positive integer');

  const monthlyRate = rate / 100 / 12;
  const termMonths = term; // term is already in months for amortization
  const monthlyPayment =
    rate === 0
      ? principal / termMonths
      : (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
        (Math.pow(1 + monthlyRate, termMonths) - 1);

  let balance = principal;
  const schedule: Array<Record<string, unknown>> = [];
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

  return c.json({
    schedule,
    principal,
    rate,
    termYears: term,
    termMonths,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
  });
});

// ── Currency Converter ───────────────────────────────────────────────
const FIXED_RATES: Record<string, number> = {
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

calculatorsRoutes.get('/api/calculators/currency', requireAuth, async (c) => {
  const from = (c.req.query('from') || '').toUpperCase();
  const to = (c.req.query('to') || '').toUpperCase();
  const amount = parseFloat(c.req.query('amount') ?? '');

  if (!FIXED_RATES[from] || !FIXED_RATES[to]) throw new HttpError(400, 'Unsupported currency code');
  if (isNaN(amount) || amount <= 0) throw new HttpError(400, 'Amount must be a positive number');

  const rate = FIXED_RATES[to] / FIXED_RATES[from];
  const convertedAmount = amount * rate;

  return c.json({
    amount,
    from,
    to,
    rate: Math.round(rate * 10000) / 10000,
    convertedAmount: Math.round(convertedAmount * 100) / 100,
  });
});

// ── Unit Converter ───────────────────────────────────────────────────
const UNIT_CONVERSIONS: Record<string, (v: number) => number> = {
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

calculatorsRoutes.get('/api/calculators/units', requireAuth, async (c) => {
  const value = parseFloat(c.req.query('value') ?? '');
  const from = (c.req.query('from') || '').toLowerCase();
  const to = (c.req.query('to') || '').toLowerCase();

  if (isNaN(value)) throw new HttpError(400, 'Value must be a number');

  const key = `${from}:${to}`;
  const converter = UNIT_CONVERSIONS[key];

  if (!converter) throw new HttpError(400, `Unsupported unit conversion: ${from} to ${to}`);

  const result = converter(value);

  return c.json({
    value,
    from,
    to,
    result: Math.round(result * 10000) / 10000,
  });
});

// ── Emergency Fund Calculator (legacy) ──────────────────────────────
// Reads 12 months of expense transactions + savings accounts for the active profile.
calculatorsRoutes.get('/api/calculator/emergency-fund', requireAuth, async (c) => {
  const pid = await getProfileId(c);

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

  const amountSql = normalizedTransactionAmountSql();
  const expenseRows = await db.all<{ amount: number; date: string }>(
    c.env.DB,
    `SELECT ${amountSql} AS amount, date FROM transactions
     WHERE profile_id = ? AND type = 'expense' AND date >= ?`,
    pid,
    dateStr
  );

  const monthlyTotals: Record<string, number> = {};
  for (const r of expenseRows) {
    const m = r.date.substring(0, 7);
    monthlyTotals[m] = (monthlyTotals[m] || 0) + Math.abs(r.amount);
  }
  const monthsWithData = Object.keys(monthlyTotals).length;
  const avgMonthlyExpenses =
    monthsWithData > 0
      ? Object.values(monthlyTotals).reduce((a, b) => a + b, 0) / monthsWithData
      : 0;

  const accounts = await db.all<{ name: string; type: string; balance: number }>(
    c.env.DB,
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
  ].map((cv) => {
    const required = avgMonthlyExpenses * cv.months;
    const current = totalEmergencyFund;
    return {
      months: cv.months,
      label: cv.label,
      required: Math.round(required),
      current: Math.round(current),
      coveragePct: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 0,
      status: current >= required ? 'complete' : current >= required * 0.5 ? 'partial' : 'low',
    };
  });

  return c.json({
    avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
    totalEmergencyFund: Math.round(totalEmergencyFund),
    coverage,
    monthsOfCoverage:
      avgMonthlyExpenses > 0 ? Math.round(totalEmergencyFund / avgMonthlyExpenses) : 999,
  });
});

// ── Compound Interest Calculator ─────────────────────────────────────
calculatorsRoutes.post('/api/calculator/compound-interest', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>;
  const { principal, monthlyContribution, annualRate, years, compoundFrequency } = b;

  if (!principal || principal < 0) throw new HttpError(400, 'Valid principal is required');
  if (isNaN(parseFloat(annualRate))) throw new HttpError(400, 'Valid annual rate is required');

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

  return c.json({
    futureValue: Math.round(totalFutureValue * 100) / 100,
    totalContributions: Math.round(totalContributions * 100) / 100,
    interestEarned: Math.round(interestEarned * 100) / 100,
    principal: P,
    monthlyContribution: PMT,
    annualRate: parseFloat(annualRate),
    years: t,
    compoundFrequency: n,
  });
});
