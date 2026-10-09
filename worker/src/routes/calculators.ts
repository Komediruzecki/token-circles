import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { normalizedTransactionAmountSql } from '../transaction-amount';
import { addCalendarMonths } from '../../../shared/calendarMonths';
import * as db from '../db';
import { localToday } from '../local-date';

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

// ── Emergency Fund Calculator (legacy) ──────────────────────────────
// Reads 12 months of expense transactions + savings accounts for the active profile.
calculatorsRoutes.get('/api/calculator/emergency-fund', requireAuth, async (c) => {
  const pid = await getProfileId(c);

  // Twelve months back from today on the person's calendar, on the last day of a shorter month:
  // from 29 February, 28 February. Date#setMonth overflowed into 1 March.
  const dateStr = addCalendarMonths(localToday(c), -12);

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
    // The Emergency Fund page shows how many months the average is taken over.
    monthsWithData,
    coverage,
    monthsOfCoverage:
      avgMonthlyExpenses > 0 ? Math.round(totalEmergencyFund / avgMonthlyExpenses) : 999,
  });
});
