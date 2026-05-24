/**
 * Calculators handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, getAmount, idParam, json, ok } from './helpers'

export async function compoundInterest(body: unknown): Promise<Response> {
  try {
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const {
      principal = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      years = 10,
      compoundsPerYear = 12,
    } = body as Record<string, number>

    const rate = annualReturn / 100
    const n = compoundsPerYear

    const projection = []
    let balance = principal
    let totalContributions = principal

    for (let y = 0; y <= years; y++) {
      projection.push({
        year: y,
        balance: Math.round(balance),
        contributions: Math.round(totalContributions),
        interest: Math.round(balance - totalContributions),
      })

      const yearlyContribution = monthlyContribution * 12
      for (let p = 0; p < n; p++) {
        balance = balance * (1 + rate / n) + monthlyContribution
      }
      totalContributions += yearlyContribution
    }

    const scenarios = [
      { name: 'Conservative', return: 4, color: '#3b82f6' },
      { name: 'Moderate', return: 6, color: '#10b981' },
      { name: 'Optimistic', return: 8, color: '#8b5cf6' },
    ].map((s) => {
      const r = s.return / 100
      let bal = principal
      let contrib = principal
      for (let y = 0; y <= years; y++) {
        if (y > 0) {
          for (let p = 0; p < n; p++) {
            bal = bal * (1 + r / n) + monthlyContribution
          }
          contrib += monthlyContribution * 12
        }
      }
      return {
        name: s.name,
        return: s.return,
        color: s.color,
        finalBalance: Math.round(bal),
        totalContributions: Math.round(contrib),
        interest: Math.round(bal - contrib),
      }
    })

    return json({
      projection,
      principal,
      monthlyContribution,
      annualReturn,
      years,
      finalBalance: projection[projection.length - 1].balance,
      totalContributions: projection[projection.length - 1].contributions,
      totalInterest: projection[projection.length - 1].interest,
      scenarios,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementCalculate(body: unknown): Promise<Response> {
  try {
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const {
      currentAge = 30,
      retirementAge = 65,
      currentSavings = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      annualExpenses = 30000,
      withdrawalRate = 4,
      inflationRate: _inflationRate = 2,
      expensesAtRetirement = null,
      country = '',
    } = body as Record<string, unknown>

    const colMultipliers: Record<string, number> = {
      usa: 1.0,
      europe: 0.9,
      switzerland: 1.3,
      croatia: 0.6,
      japan: 0.85,
    }
    const colFactor = colMultipliers[country as string] || 1.0
    const adjustedExpenses =
      expensesAtRetirement !== null
        ? (expensesAtRetirement as number)
        : (annualExpenses as number) * colFactor

    const fireNumber = adjustedExpenses / ((withdrawalRate as number) / 100)

    const monthsToRetirement = ((retirementAge as number) - (currentAge as number)) * 12
    if (monthsToRetirement <= 0) {
      return json({ error: 'Retirement age must be greater than current age' }, 400)
    }
    const monthlyReturn = (annualReturn as number) / 100 / 12

    let savings = currentSavings as number
    const timeline = []
    for (let m = 0; m <= monthsToRetirement; m++) {
      if (m % 12 === 0) {
        timeline.push({
          year: (currentAge as number) + m / 12,
          age: Math.round((currentAge as number) + m / 12),
          savings: Math.round(savings),
        })
      }
      savings = savings * (1 + monthlyReturn) + (monthlyContribution as number)
    }

    let fireMonth: number | null = null
    let fireAge: number | null = null
    savings = currentSavings as number
    for (let m = 1; m <= monthsToRetirement * 2; m++) {
      savings = savings * (1 + monthlyReturn) + (monthlyContribution as number)
      if (savings >= fireNumber && fireMonth === null) {
        fireMonth = m
        fireAge = (currentAge as number) + m / 12
      }
    }

    let retirementSavings = savings
    const withdrawalTimeline = []
    if (fireMonth !== null) {
      for (let y = 0; y < 20; y++) {
        retirementSavings =
          retirementSavings * (1 + (annualReturn as number) / 100) - adjustedExpenses
        withdrawalTimeline.push({
          year: y + 1,
          savings: Math.max(0, Math.round(retirementSavings)),
          balance: Math.max(0, Math.round(retirementSavings)),
        })
      }
    }

    const scenarios = [
      {
        name: 'Conservative',
        ret: 4,
        fireNumber: Math.round(adjustedExpenses / 0.04),
        fireAge: null as number | null,
      },
      {
        name: 'Moderate',
        ret: 6,
        fireNumber: Math.round(adjustedExpenses / 0.06),
        fireAge: null as number | null,
      },
      {
        name: 'Optimistic',
        ret: 8,
        fireNumber: Math.round(adjustedExpenses / 0.08),
        fireAge: null as number | null,
      },
    ].map((s) => {
      let m = currentSavings as number
      let fa: number | null = null
      for (let mo = 1; mo <= monthsToRetirement * 2; mo++) {
        m = m * (1 + s.ret / 100 / 12) + (monthlyContribution as number)
        if (m >= s.fireNumber && fa === null) {
          fa = (currentAge as number) + mo / 12
        }
      }
      return {
        name: s.name,
        return: s.ret,
        fireNumber: s.fireNumber,
        fireAge: fa ? Math.round(fa * 10) / 10 : null,
        reached: fa !== null,
        savingsAtFire: Math.round(m),
        shortfall: fa === null ? s.fireNumber - Math.round(m) : 0,
      }
    })

    return json({
      fireNumber: Math.round(fireNumber),
      fireAge: fireAge ? Math.round(fireAge * 10) / 10 : null,
      fireMonth,
      fireYear: fireAge ? Math.floor(fireAge) : null,
      savingsAtRetirement: Math.round(savings),
      monthsToFire: fireMonth,
      currentNWAtFire: Math.round(savings),
      traditionalRetirementAge: 65,
      timeline: timeline.filter(
        (t: Record<string, number>) => t.year % 5 === 0 || t.year === currentAge
      ),
      withdrawalTimeline,
      scenarios,
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
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function emergencyFund(): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
    const dateStr = twelveMonthsAgo.toISOString().split('T')[0]

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) => t.type === 'expense' && (t.date as string) >= dateStr
    )

    const monthlyTotals: Record<string, number> = {}
    for (const r of txns) {
      const m = (r.date as string).substring(0, 7)
      monthlyTotals[m] = (monthlyTotals[m] || 0) + Math.abs(getAmount(r))
    }
    const monthsWithData = Object.keys(monthlyTotals).length
    const avgMonthlyExpenses =
      monthsWithData > 0
        ? Object.values(monthlyTotals).reduce((a, b) => a + b, 0) / monthsWithData
        : 0

    const accounts = await db.getAllFromIndex('accounts', 'by_profile', pid)
    const totalEmergencyFund = accounts
      .filter((a: Record<string, unknown>) => a.type === 'savings')
      .reduce((s: number, a: Record<string, unknown>) => s + ((a.balance as number) || 0), 0)

    const totalBalance = accounts.reduce(
      (s: number, a: Record<string, unknown>) => s + ((a.balance as number) || 0),
      0
    )

    const coverage = [
      { months: 3, label: 'Starter', ratio: 3 },
      { months: 6, label: 'Standard', ratio: 6 },
      { months: 12, label: 'Conservative', ratio: 12 },
    ].map((c) => {
      const required = avgMonthlyExpenses * c.months
      const current = totalEmergencyFund
      return {
        months: c.months,
        label: c.label,
        required: Math.round(required),
        current: Math.round(current),
        coveragePct: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 0,
        status: current >= required ? 'complete' : current >= required * 0.5 ? 'partial' : 'low',
      }
    })

    return json({
      avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
      totalEmergencyFund: Math.round(totalEmergencyFund),
      totalBalance: Math.round(totalBalance),
      monthsWithData,
      coverage,
      accounts: accounts.filter((a: Record<string, unknown>) => a.type === 'savings'),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementProjection(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()

    const settingsRows = await db.getAll('settings')
    const settingsRow = settingsRows.find(
      (s: Record<string, unknown>) => s.key === 'retirement_goals'
    )
    const settings = settingsRow ? settingsRow.value : null

    const currentAge = parseFloat(query.get('currentAge') || query.get('age') || '30') || 30
    const retirementAge =
      parseFloat(query.get('retirementAge') || query.get('retire') || '65') || 65
    const currentSavings =
      parseFloat(query.get('currentSavings') || query.get('savings') || '0') || 0
    const monthlyContribution =
      parseFloat(query.get('monthlyContribution') || query.get('contribution') || '500') || 0
    const annualReturn = parseFloat(query.get('annualReturn') || query.get('return') || '7') || 7
    const withdrawalRate = parseFloat(query.get('withdrawalRate') || query.get('rate') || '4') || 4
    const country = query.get('country') || 'US'

    const result = calculateRetirementProjection(
      currentAge,
      retirementAge,
      currentSavings,
      monthlyContribution,
      annualReturn,
      withdrawalRate,
      country,
      settings
    )

    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementGoals(): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const db = await getDB()

    const settingsRows = await db.getAll('settings')
    const settingsRow = settingsRows.find(
      (s: Record<string, unknown>) => s.key === 'retirement_goals'
    )
    const settings = settingsRow ? settingsRow.value : null

    const goals = await db.getAllFromIndex('goals', 'by_profile', pid)

    return json({
      settings,
      goals,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementGoalCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid goal data' }, 400)
  const goal = body as Record<string, unknown>
  goal.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createGoal(goal as unknown as Parameters<typeof adapter.createGoal>[0])
  return json({ id, ...goal }, 201)
}

export async function retirementGoalUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateGoal(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function retirementGoalDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteGoal(idParam(params))
  return ok()
}

function calculateRetirementProjection(
  currentAge: number,
  retirementAge: number,
  currentSavings: number,
  monthlyContribution: number,
  annualReturn: number,
  withdrawalRate: number,
  country: string,
  _settings: unknown
): Record<string, unknown> {
  const monthsToRetirement = (retirementAge - currentAge) * 12

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

  while (retirementSavings > 0 && yearsInRetirement < 50) {
    retirementSavings -= annualWithdrawal
    const annualReturnReal = (annualReturn - 3) / 100
    retirementSavings *= 1 + annualReturnReal
    yearsInRetirement++
  }

  const shortfall = retirementSavings < 0 ? Math.abs(retirementSavings) : 0
  const yearsOfRunway = Math.round(retirementSavings / (annualWithdrawal / 12))

  const projectedTotal = Math.round(balance)
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
    finalBalance: Math.max(0, Math.round(retirementSavings)),
    shortfall,
    yearsOfRunway,
    // Frontend-compatible field names
    current_age: currentAge,
    retirement_age: retirementAge,
    current_amount: Math.round(currentSavings),
    annual_contribution: Math.round(monthlyContribution * 12),
    expected_return: Math.round(annualReturn),
    withdrawal_rate: Math.round(withdrawalRate),
    years_to_retire: retirementAge - currentAge,
    projected_total: projectedTotal,
    projected_income: Math.round(projectedTotal > 0 ? projectedTotal * 0.04 : 0),
    monthly_income_in_retirement: Math.round(projectedTotal > 0 ? (projectedTotal * 0.04) / 12 : 0),
  }
}
