import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of the retirement-GOALS CRUD from backend/routes/retirement.js +
// backend/repositories/retirementGoalsRepo.js. The projection / FIRE calculator
// endpoints (calculateRetirementProjection, /api/calculator/retire) are pure
// math, ported faithfully at the bottom of this file.
export const retirementGoalsRoutes = new Hono<AppEnv>()

// Retirement projection — ported verbatim from backend/utils.js
// (calculateRetirementProjection). Pure math; the `settings`/`database`/`profileId`
// args are accepted to mirror the signature but are unused by the calculation.
function calculateRetirementProjection(
  currentAge = 30,
  retirementAge = 65,
  currentSavings = 0,
  monthlyContribution = 500,
  annualReturn = 7,
  withdrawalRate = 4,
  country = 'US'
) {
  const monthsToRetirement = (retirementAge - currentAge) * 12
  const annualContribution = monthlyContribution * 12
  const countryAdjustment = country === 'US' ? 1.0 : 0.9
  const monthlyExpenses = (currentAge >= retirementAge ? 0 : 2500) * countryAdjustment
  const adjustedExpenses = country === 'US' && currentAge >= retirementAge ? 2500 : monthlyExpenses
  const annualWithdrawal = adjustedExpenses * 12

  let savings = currentSavings
  let investmentGains = 0
  let balance = savings

  for (let i = 1; i <= monthsToRetirement; i++) {
    const monthlyReturn = annualReturn / 100 / 12
    investmentGains += savings * monthlyReturn
    savings += monthlyContribution
    balance = savings + investmentGains
  }

  let retirementSavings = balance
  let yearsInRetirement = 0
  let balanceAtYearEnd = retirementSavings
  let finalBalance = retirementSavings

  while (retirementSavings > 0 && yearsInRetirement < 50) {
    retirementSavings -= annualWithdrawal
    const annualReturnReal = (annualReturn - 3) / 100
    retirementSavings *= 1 + annualReturnReal
    yearsInRetirement++
    balanceAtYearEnd = Math.max(0, retirementSavings)
    finalBalance = balanceAtYearEnd
  }

  const shortfall = balanceAtYearEnd < 0 ? Math.abs(balanceAtYearEnd) : 0
  const yearsOfRunway = Math.round(retirementSavings / (annualWithdrawal / 12))

  return {
    currentAge,
    retirementAge,
    currentSavings: Math.round(currentSavings),
    monthlyContribution: Math.round(monthlyContribution),
    annualReturn: Math.round(annualReturn),
    withdrawalRate: Math.round(withdrawalRate),
    country,
    expensesAtRetirement: Math.round(annualWithdrawal),
    retirementSavings: Math.round(retirementSavings),
    retirementAgeActual: retirementAge + yearsInRetirement,
    yearsInRetirement,
    balanceAtRetirement: Math.round(balance),
    finalBalance: Math.round(finalBalance),
    shortfall,
    yearsOfRunway,
    current_age: currentAge,
    retirement_age: retirementAge,
    current_amount: Math.round(currentSavings),
    annual_contribution: Math.round(annualContribution),
    expected_return: Math.round(annualReturn),
    withdrawal_rate: Math.round(withdrawalRate),
    years_to_retire: retirementAge - currentAge,
    projected_total: Math.round(balance),
    projected_income: Math.round(balance > 0 ? balance * 0.04 : 0),
    monthly_income_in_retirement: Math.round(balance > 0 ? (balance * 0.04) / 12 : 0),
  }
}

// List goals + the saved retirement_settings blob (aggregating read across
// profiles -> getProfileIds; settings keyed off the first profile, as upstream).
retirementGoalsRoutes.get('/api/retirement-goals', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const rows = await db.all(
    c.env.DB,
    `SELECT * FROM retirement_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`,
    ...pids
  )
  const settings = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT * FROM settings WHERE key = ? AND profile_id = ?',
    'retirement_settings',
    pids[0]
  )
  return c.json({
    goals: rows,
    settings: settings ? JSON.parse(settings.value) : {},
  })
})

retirementGoalsRoutes.post('/api/retirement-goals', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const dl = b.deadline || b.target_date || null
  if (!b.name || b.target_amount == null) throw new HttpError(400, 'Name and target amount are required')
  const res = await db.insert(c.env.DB, 'retirement_goals', {
    profile_id: pid,
    name: b.name,
    target_amount: b.target_amount,
    current_amount: b.current_amount || 0,
    deadline: dl,
    notes: b.notes || '',
    current_age: b.current_age || 30,
    retirement_age: b.retirement_age || 65,
    monthly_contribution: b.monthly_contribution || 0,
    expected_return_rate: b.expected_return_rate || 7,
  })
  return c.json({
    id: res.meta.last_row_id,
    name: b.name,
    target_amount: b.target_amount,
    current_amount: b.current_amount || 0,
    deadline: dl,
    notes: b.notes,
    profile_id: pid,
  })
})

retirementGoalsRoutes.put('/api/retirement-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const dl = b.deadline || b.target_date || null
  const res = await db.update(
    c.env.DB,
    'retirement_goals',
    {
      name: b.name,
      target_amount: b.target_amount,
      current_amount: b.current_amount,
      deadline: dl,
      notes: b.notes || '',
      current_age: b.current_age || 30,
      retirement_age: b.retirement_age || 65,
      monthly_contribution: b.monthly_contribution || 0,
      expected_return_rate: b.expected_return_rate || 7,
    },
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

retirementGoalsRoutes.delete('/api/retirement-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.del(c.env.DB, 'retirement_goals', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

// FIRE calculator — pure-math projection (timelines, scenarios, withdrawal phase).
// Ported from backend/routes/retirement.js (POST /api/calculator/retire).
retirementGoalsRoutes.post('/api/calculator/retire', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>
  const {
    currentAge = 30,
    retirementAge = 65,
    currentSavings = 0,
    monthlyContribution = 0,
    annualReturn = 7,
    annualExpenses = 30000,
    withdrawalRate = 4,
    expensesAtRetirement = null,
    country = '',
  } = b

  // Use direct expenses at retirement if provided, otherwise apply country cost-of-living adjustment
  const colMultipliers: Record<string, number> = {
    usa: 1.0,
    europe: 0.9,
    switzerland: 1.3,
    croatia: 0.6,
    japan: 0.85,
  }
  const col = colMultipliers[country] || 1.0
  const adjustedExpenses = expensesAtRetirement !== null ? expensesAtRetirement : annualExpenses * col

  // FIRE number: how much needed to retire (25x rule, or 100 / withdrawalRate)
  const fireNumber = adjustedExpenses / (withdrawalRate / 100)

  // Project savings until retirement
  const monthsToRetirement = (retirementAge - currentAge) * 12
  if (monthsToRetirement <= 0) throw new HttpError(400, 'Retirement age must be greater than current age')
  const monthlyReturn = annualReturn / 100 / 12

  let savings = currentSavings
  const timeline: Array<{ year: number; age: number; savings: number }> = []
  for (let m = 0; m <= monthsToRetirement; m++) {
    if (m % 12 === 0) {
      timeline.push({
        year: currentAge + m / 12,
        age: Math.round(currentAge + m / 12),
        savings: Math.round(savings),
      })
    }
    savings = savings * (1 + monthlyReturn) + monthlyContribution
  }

  // FIRE date: find first month where savings >= fireNumber
  let fireMonth: number | null = null
  let fireAge: number | null = null
  savings = currentSavings
  for (let m = 1; m <= monthsToRetirement * 2; m++) {
    savings = savings * (1 + monthlyReturn) + monthlyContribution
    if (savings >= fireNumber && fireMonth === null) {
      fireMonth = m
      fireAge = currentAge + m / 12
    }
  }

  // Withdrawal phase projection (20 years)
  let retirementSavings = savings
  const withdrawalTimeline: Array<{ year: number; savings: number; balance: number }> = []
  if (fireMonth !== null) {
    const annualWithdrawal = adjustedExpenses
    for (let y = 0; y < 20; y++) {
      retirementSavings = retirementSavings * (1 + annualReturn / 100) - annualWithdrawal
      withdrawalTimeline.push({
        year: y + 1,
        savings: Math.max(0, Math.round(retirementSavings)),
        balance: Math.max(0, Math.round(retirementSavings)),
      })
    }
  }

  return c.json({
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
      { name: 'Conservative', return: 4, fireNumber: Math.round(adjustedExpenses / 0.04), fireAge: null as number | null },
      { name: 'Moderate', return: 6, fireNumber: Math.round(adjustedExpenses / 0.06), fireAge: null as number | null },
      { name: 'Optimistic', return: 8, fireNumber: Math.round(adjustedExpenses / 0.08), fireAge: null as number | null },
    ].map((s) => {
      let m = currentSavings
      let fa: number | null = null
      for (let mo = 1; mo <= monthsToRetirement * 2; mo++) {
        m = m * (1 + s.return / 100 / 12) + monthlyContribution
        if (m >= s.fireNumber && fa === null) {
          fa = currentAge + mo / 12
        }
      }
      return {
        ...s,
        fireAge: fa ? Math.round(fa * 10) / 10 : null,
        reached: fa !== null,
        savingsAtFire: Math.round(m),
        shortfall: fa === null ? s.fireNumber - Math.round(m) : 0,
      }
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
  })
})

// Retirement projection — wraps calculateRetirementProjection (ported above).
// Reads the saved retirement_goals settings blob (mirrors backend, though the
// calc itself ignores it) and the per-request overrides from the query string.
retirementGoalsRoutes.get('/api/retirement/projection', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const q = (k: string) => c.req.query(k)

  // Loaded to mirror the backend read; calculateRetirementProjection does not use it.
  await db.first(c.env.DB, 'SELECT * FROM settings WHERE key = ? AND profile_id = ?', 'retirement_goals', pid)

  const result = calculateRetirementProjection(
    parseFloat(q('currentAge') ?? q('age') ?? '30') || 30,
    parseFloat(q('retirementAge') ?? q('retire') ?? '65') || 65,
    parseFloat(q('currentSavings') ?? q('savings') ?? '0') || 0,
    parseFloat(q('monthlyContribution') ?? q('contribution') ?? '500') || 0,
    parseFloat(q('annualReturn') ?? q('return') ?? '7') || 7,
    parseFloat(q('withdrawalRate') ?? q('rate') ?? '4') || 4,
    q('country') || 'US'
  )

  return c.json(result)
})
