import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { accept, HttpError } from '../http';
import * as db from '../db';
import { localNow } from '../local-date';
import { normalizedTransactionAmountSql } from '../transaction-amount';
import { projectRetirement } from '../../../shared/retirement';
import {
  checkRetirementGoalCreate,
  checkRetirementGoalEdit,
} from '../../../shared/retirementGoalSchema';
import { checkRetirementPlan } from '../../../shared/retirementPlanSchema';
import {
  buildFacts,
  deriveSettings,
  monthOf,
  settingsToInput,
} from '../../../shared/retirementSettings';
import type { CashflowRow, RetirementSettings } from '../../../shared/retirementSettings';

// Port of the retirement-GOALS CRUD from backend/routes/retirement.js +
// backend/repositories/retirementGoalsRepo.js. The projection itself is not ported
// any more: it comes from shared/retirement.ts, which the browser-only storage layer
// runs too, so the two stop giving different answers to the same question.
export const retirementGoalsRoutes = new Hono<AppEnv>();

const SETTINGS_KEY = 'retirement_settings';

// Twelve months is enough to average out a bonus and a holiday without reaching back
// into a job the user has since left.
const FACT_WINDOW_MONTHS = 12;

/**
 * The stored row exactly as written, without defaults applied.
 *
 * deriveSettings decides what to fill from which keys are present, so normalising here
 * would tell it every field had been set and it would fill nothing. Callers that want a
 * complete object take it from deriveSettings, which normalises on the way out.
 */
async function loadSavedSettings(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const pid = await getProfileId(c);
  const row = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT value FROM settings WHERE key = ? AND profile_id = ?',
    SETTINGS_KEY,
    pid
  );
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A row that will not parse is a row written by something that is not this app.
    // Defaults are a better answer than a 500 on a page the user just opened.
    return {};
  }
}

/**
 * What the app can observe about this user: what their accounts hold, what has moved
 * through them lately, and any age they have already told a retirement goal.
 */
async function loadFacts(c: Context<AppEnv>) {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');

  // The window ends today on the person's calendar.
  const since = localNow(c);
  since.setUTCMonth(since.getUTCMonth() - FACT_WINDOW_MONTHS);
  const sinceStr = since.toISOString().split('T')[0];

  const [accounts, cashflow, goal] = await Promise.all([
    db.all<{ balance: number }>(
      c.env.DB,
      `SELECT balance FROM accounts WHERE profile_id IN (${inClause})`,
      ...pids
    ),
    db.all<CashflowRow>(
      c.env.DB,
      `SELECT date, ${normalizedTransactionAmountSql()} AS amount, type FROM transactions
       WHERE profile_id IN (${inClause}) AND type IN ('income', 'expense') AND date >= ?`,
      ...pids,
      sinceStr
    ),
    db.first<{ current_age: number }>(
      c.env.DB,
      `SELECT current_age FROM retirement_goals WHERE profile_id IN (${inClause})
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      ...pids
    ),
  ]);

  return buildFacts({
    accountBalances: accounts.map((a) => a.balance),
    cashflow,
    currentAge: goal?.current_age ?? null,
  });
}

// List goals + the saved retirement_settings blob (aggregating read across
// profiles -> getProfileIds; settings keyed off the first profile, as upstream).
retirementGoalsRoutes.get('/api/retirement-goals', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const rows = await db.all(
    c.env.DB,
    // created_at has whole seconds: goals saved within one tie, and the later id is the newer.
    `SELECT * FROM retirement_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC, id DESC`,
    ...pids
  );
  const settings = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT * FROM settings WHERE key = ? AND profile_id = ?',
    'retirement_settings',
    pids[0]
  );
  return c.json({
    goals: rows,
    settings: settings ? JSON.parse(settings.value) : {},
  });
});

// A goal is checked by the rules local-first and the goal dialog run too
// (shared/retirementGoalSchema.ts): a refused body answers 400 at its fields, and nothing a
// person did not type is stored as if they had.
retirementGoalsRoutes.post('/api/retirement-goals', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const goal = accept(checkRetirementGoalCreate(await c.req.json()));
  const res = await db.insert(c.env.DB, 'retirement_goals', { ...goal, profile_id: pid });
  return c.json({
    id: res.meta.last_row_id,
    name: goal.name,
    target_amount: goal.target_amount,
    current_amount: goal.current_amount,
    deadline: goal.deadline,
    notes: goal.notes,
    profile_id: pid,
  });
});

/** The profile's goal `id`, or the 404 that says it is not there. */
async function ownGoal(c: Context<AppEnv>, pid: number): Promise<Record<string, unknown>> {
  const goal = await db.first<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM retirement_goals WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!goal) throw new HttpError(404, 'Retirement goal not found');
  return goal;
}

// An edit checks and writes only the fields whose value it changes (decision 2), so a goal an
// older version stored under other rules can still be renamed, and a field it leaves out is left
// as it is.
retirementGoalsRoutes.put('/api/retirement-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const existing = await ownGoal(c, pid);
  const fields = accept(checkRetirementGoalEdit(await c.req.json(), existing));
  if (Object.keys(fields).length > 0) {
    await db.update(
      c.env.DB,
      'retirement_goals',
      fields,
      'id = ? AND profile_id = ?',
      existing.id,
      pid
    );
  }
  return c.json({ ok: true });
});

retirementGoalsRoutes.delete('/api/retirement-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.del(
    c.env.DB,
    'retirement_goals',
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Retirement goal not found');
  return c.json({ ok: true });
});

// FIRE calculator — the accumulation phase comes from the shared model; only the
// drawdown loop below is specific to this endpoint. Ported from
// backend/routes/retirement.js (POST /api/calculator/retire).
retirementGoalsRoutes.post('/api/calculator/retire', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>;
  const {
    currentAge = 30,
    retirementAge = 65,
    currentSavings = 0,
    monthlyContribution = 0,
    annualReturn = 7,
    annualExpenses = 30000,
    withdrawalRate = 4,
    inflationRate = 0,
    expensesAtRetirement = null,
    country = '',
  } = b;

  // Use direct expenses at retirement if provided, otherwise apply country cost-of-living adjustment
  const colMultipliers: Record<string, number> = {
    usa: 1.0,
    europe: 0.9,
    switzerland: 1.3,
    croatia: 0.6,
    japan: 0.85,
  };
  const col = colMultipliers[country] || 1.0;
  const adjustedExpenses =
    expensesAtRetirement !== null ? expensesAtRetirement : annualExpenses * col;

  const monthsToRetirement = (retirementAge - currentAge) * 12;
  if (monthsToRetirement <= 0)
    throw new HttpError(400, 'Retirement age must be greater than current age');

  const today = monthOf(localNow(c));
  const accumulate = (returnPct: number, horizonMonths: number) =>
    projectRetirement({
      startMonth: today,
      netWorth: currentSavings,
      monthlyIncome: monthlyContribution,
      monthlyExpenses: 0,
      annualReturnPct: returnPct,
      // The caller's inflation rate, as local-first takes it: 0, nominal money throughout, when
      // none is sent. It used to be dropped here, so the answer ignored what was asked for.
      annualInflationPct: inflationRate,
      horizonMonths,
      safeWithdrawalRatePct: withdrawalRate,
      lifestyles: [{ id: 'fire', label: 'FIRE', monthlySpendToday: adjustedExpenses / 12 }],
    });

  // Twice the horizon, so a plan that misses the chosen retirement age still reports the
  // age it would have worked at rather than reporting nothing.
  const projection = accumulate(annualReturn, monthsToRetirement * 2);
  const fireNumber = projection.lifestyles[0].targetToday;
  const crossing = projection.lifestyles[0].crossing;
  const fireMonth = crossing ? crossing.index : null;
  const fireAge = crossing ? currentAge + crossing.index / 12 : null;
  const savingsAtRetirement = projection.rows[monthsToRetirement].netWorth;

  const timeline = projection.rows
    .filter((r) => r.index <= monthsToRetirement && r.index % 12 === 0)
    .map((r) => ({
      year: currentAge + r.index / 12,
      age: Math.round(currentAge + r.index / 12),
      savings: Math.round(r.netWorth),
    }));

  // Drawdown is a different phase from accumulation — annual withdrawals, no contributions —
  // so it stays an explicit loop here rather than being forced through the model.
  const withdrawalTimeline: Array<{ year: number; savings: number; balance: number }> = [];
  if (fireMonth !== null) {
    let remaining = savingsAtRetirement;
    for (let y = 0; y < 20; y++) {
      remaining = remaining * (1 + annualReturn / 100) - adjustedExpenses;
      withdrawalTimeline.push({
        year: y + 1,
        savings: Math.max(0, Math.round(remaining)),
        balance: Math.max(0, Math.round(remaining)),
      });
    }
  }

  return c.json({
    fireNumber: Math.round(fireNumber),
    fireAge: fireAge ? Math.round(fireAge * 10) / 10 : null,
    fireMonth,
    fireYear: fireAge ? Math.floor(fireAge) : null,
    savingsAtRetirement: Math.round(savingsAtRetirement),
    monthsToFire: fireMonth,
    currentNWAtFire: Math.round(savingsAtRetirement),
    traditionalRetirementAge: 65,
    timeline: timeline.filter((t) => t.year % 5 === 0 || t.year === currentAge),
    withdrawalTimeline,
    scenarios: [
      { name: 'Conservative', return: 4 },
      { name: 'Moderate', return: 6 },
      { name: 'Optimistic', return: 8 },
    ].map((s) => {
      const run = accumulate(s.return, monthsToRetirement * 2);
      const hit = run.lifestyles[0].crossing;
      const fa = hit ? currentAge + hit.index / 12 : null;
      return {
        ...s,
        fireNumber: Math.round(run.lifestyles[0].targetToday),
        fireAge: fa ? Math.round(fa * 10) / 10 : null,
        reached: fa !== null,
        savingsAtFire: Math.round(run.finalNetWorth),
        shortfall: fa === null ? Math.round(run.lifestyles[0].targetToday - run.finalNetWorth) : 0,
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
      inflationRate,
      country,
      expensesAtRetirement,
    },
  });
});

// The assumptions behind the projection, with anything the user has not set filled in
// from their own accounts and transactions. `filled` says what was taken and where from,
// so the page can show its working instead of passing guesses off as entered figures.
retirementGoalsRoutes.get('/api/retirement/settings', requireAuth, async (c) => {
  const [saved, facts] = await Promise.all([loadSavedSettings(c), loadFacts(c)]);
  // The projection starts in the person's month (monthOf reads the wall clock's UTC fields).
  const startMonth = monthOf(localNow(c));
  const { settings, filled, missing } = deriveSettings(saved, facts, startMonth);
  return c.json({ settings, facts, filled, missing, startMonth });
});

retirementGoalsRoutes.put('/api/retirement/settings', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  // Checked by the rules local-first and the planner run too (shared/retirementPlanSchema.ts): a
  // value outside its range is refused at its field rather than moved into it, and a plan that
  // fits is stored as normalizeSettings stores it, so the row only ever holds what the model takes.
  const settings = accept(checkRetirementPlan(await c.req.json()));
  await db.run(
    c.env.DB,
    'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)',
    SETTINGS_KEY,
    JSON.stringify(settings),
    pid
  );
  // Re-derive rather than echoing the body back. Saving is exactly what stops a field
  // being derived, so a client that only took `settings` from here kept showing "filled
  // in from your data" for figures the user had just entered by hand.
  //
  // What is stored is the normalised object, so every key is present and `filled` comes
  // back empty by construction. `missing` does not: it reports what the user's data cannot
  // answer at all, which a save does not change, so it is worth the extra read.
  const facts = await loadFacts(c);
  const derived = deriveSettings(settings, facts, monthOf(localNow(c)));
  return c.json({ settings: derived.settings, filled: derived.filled, missing: derived.missing });
});

// The projection itself. The page computes this in the browser from the same shared
// module for instant feedback while editing; this endpoint answers for anything that
// cannot, and is the reason the two can be checked against each other at all.
retirementGoalsRoutes.get('/api/retirement/projection', requireAuth, async (c) => {
  const [saved, facts] = await Promise.all([loadSavedSettings(c), loadFacts(c)]);
  const today = monthOf(localNow(c));
  const { settings, filled, missing } = deriveSettings(saved, facts, today);
  const projection = projectRetirement(settingsToInput(settings, today));
  return c.json({ settings, filled, missing, projection });
});
