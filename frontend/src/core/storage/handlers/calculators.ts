/**
 * Calculators handlers — IndexedDB-backed implementations
 *
 * The retirement arithmetic is not implemented here: it comes from shared/retirement.ts,
 * the same module the Worker runs, so browser mode and server mode cannot drift into
 * giving different answers to the same question.
 */
import { projectRetirement } from '../../../../../shared/retirement'
import {
  buildFacts,
  deriveSettings,
  monthOf,
  normalizeSettings,
  settingsToInput,
} from '../../../../../shared/retirementSettings'
import { getDB } from '../idb'
import { adapter, getAmount, idParam, json, ok } from './helpers'
import type { CashflowRow } from '../../../../../shared/retirementSettings'

/**
 * The retirement assumptions are per profile, and the settings store has no profile
 * column — it is keyed by `key` alone — so the profile goes in the key.
 *
 * Without it every profile shared one row: opening a second profile showed the first
 * one's plan, and saving there overwrote it. Both server runtimes have always scoped
 * these by profile (`PRIMARY KEY (key, profile_id)`), so this is browser mode catching
 * up rather than a new convention.
 */
const RETIREMENT_SETTINGS_KEY = 'retirement_settings'
const settingsKeyFor = (profileId: unknown) => `${RETIREMENT_SETTINGS_KEY}:${String(profileId)}`

// Twelve months is enough to average out a bonus and a holiday without reaching back into
// a job the user has since left.
const FACT_WINDOW_MONTHS = 12

/** Browser mode stores the object; the Worker stores JSON. Accept either, so a profile
 *  restored from a server backup opens rather than silently resetting to defaults. */
function asSavedSettings(value: unknown): Record<string, unknown> {
  const asObject = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return asObject(value)
}

/**
 * The stored assumptions exactly as written, without defaults applied — deriveSettings
 * fills from which keys are present, and normalising here would claim every field was
 * already set. Same contract as the Worker's loadSavedSettings.
 *
 * A row saved before the key carried a profile is adopted by whichever profile opens the
 * page first, and the old row is removed. Leaving it in place would hand the same plan to
 * every profile that has not saved one yet, which is the behaviour being fixed.
 */
async function loadSavedRetirementSettings(): Promise<Record<string, unknown>> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const key = settingsKeyFor(pid)
  const rows = await db.getAll('settings')
  const row = rows.find((r: Record<string, unknown>) => r.key === key)
  if (row) return asSavedSettings(row.value)

  const legacy = rows.find((r: Record<string, unknown>) => r.key === RETIREMENT_SETTINGS_KEY)
  if (!legacy) return {}
  await db.put('settings', { key, value: legacy.value })
  await db.delete('settings', RETIREMENT_SETTINGS_KEY)
  return asSavedSettings(legacy.value)
}

/** What the app can observe: account balances, recent cashflow, and any age on a goal. */
async function loadRetirementFacts() {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()

  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - FACT_WINDOW_MONTHS)
  const sinceStr = since.toISOString().split('T')[0]

  const accounts = await db.getAllFromIndex('accounts', 'by_profile', pid)
  const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
  const goals = await db.getAllFromIndex('goals', 'by_profile', pid)

  const cashflow: CashflowRow[] = txns
    .filter((t: Record<string, unknown>) => (t.date as string) >= sinceStr)
    .map((t: Record<string, unknown>) => ({
      date: t.date as string,
      amount: getAmount(t),
      type: t.type as string,
    }))

  const withAge = goals.find((g: Record<string, unknown>) => Number(g.current_age) > 0)

  return buildFacts({
    accountBalances: accounts.map((a: Record<string, unknown>) => (a.balance as number) || 0),
    cashflow,
    currentAge: withAge ? Number(withAge.current_age) : null,
  })
}

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
      { name: 'Conservative', return: 4, color: '#6e9bff' },
      { name: 'Moderate', return: 6, color: '#59d2a2' },
      { name: 'Optimistic', return: 8, color: '#f0a860' },
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

/**
 * FIRE calculator. The accumulation phase is the shared model; only the drawdown loop is
 * specific to this endpoint, because withdrawals with no contributions are a different
 * phase from saving towards a target.
 */
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
      inflationRate = 0,
      expensesAtRetirement = null,
      country = '',
    } = body as Record<string, any>

    const colMultipliers: Record<string, number> = {
      usa: 1.0,
      europe: 0.9,
      switzerland: 1.3,
      croatia: 0.6,
      japan: 0.85,
    }
    const colFactor = colMultipliers[country as string] || 1.0
    const adjustedExpenses =
      expensesAtRetirement !== null ? (expensesAtRetirement as number) : annualExpenses * colFactor

    const monthsToRetirement = (retirementAge - currentAge) * 12
    if (monthsToRetirement <= 0) {
      return json({ error: 'Retirement age must be greater than current age' }, 400)
    }

    const today = monthOf(new Date())
    const accumulate = (returnPct: number) =>
      projectRetirement({
        startMonth: today,
        netWorth: currentSavings,
        monthlyIncome: monthlyContribution,
        monthlyExpenses: 0,
        annualReturnPct: returnPct,
        // Passed through rather than discarded: this used to accept an inflation rate and
        // then drop it on the floor, so the answer ignored what the caller asked for.
        annualInflationPct: inflationRate,
        // Twice the horizon, so a plan that misses the chosen retirement age still reports
        // the age it would have worked at rather than reporting nothing.
        horizonMonths: monthsToRetirement * 2,
        safeWithdrawalRatePct: withdrawalRate,
        lifestyles: [{ id: 'fire', label: 'FIRE', monthlySpendToday: adjustedExpenses / 12 }],
      })

    const projection = accumulate(annualReturn)
    const fireNumber = projection.lifestyles[0].targetToday
    const crossing = projection.lifestyles[0].crossing
    const fireMonth = crossing ? crossing.index : null
    const fireAge = crossing ? currentAge + crossing.index / 12 : null
    const savingsAtRetirement = projection.rows[monthsToRetirement].netWorth

    const timeline = projection.rows
      .filter((r) => r.index <= monthsToRetirement && r.index % 12 === 0)
      .map((r) => ({
        year: currentAge + r.index / 12,
        age: Math.round(currentAge + r.index / 12),
        savings: Math.round(r.netWorth),
      }))

    const withdrawalTimeline = []
    if (fireMonth !== null) {
      let remaining = savingsAtRetirement
      for (let y = 0; y < 20; y++) {
        remaining = remaining * (1 + annualReturn / 100) - adjustedExpenses
        withdrawalTimeline.push({
          year: y + 1,
          savings: Math.max(0, Math.round(remaining)),
          balance: Math.max(0, Math.round(remaining)),
        })
      }
    }

    const scenarios = [
      { name: 'Conservative', ret: 4 },
      { name: 'Moderate', ret: 6 },
      { name: 'Optimistic', ret: 8 },
    ].map((s) => {
      const run = accumulate(s.ret)
      const hit = run.lifestyles[0].crossing
      const fa = hit ? currentAge + hit.index / 12 : null
      return {
        name: s.name,
        return: s.ret,
        fireNumber: Math.round(run.lifestyles[0].targetToday),
        fireAge: fa ? Math.round(fa * 10) / 10 : null,
        reached: fa !== null,
        savingsAtFire: Math.round(run.finalNetWorth),
        shortfall: fa === null ? Math.round(run.lifestyles[0].targetToday - run.finalNetWorth) : 0,
      }
    })

    return json({
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
      scenarios,
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

/**
 * The projection, from the user's saved assumptions with anything they have not set filled
 * in from their own data. Same shared model the Worker runs, and the same response.
 */
export async function retirementProjection(): Promise<Response> {
  try {
    const [saved, facts] = await Promise.all([loadSavedRetirementSettings(), loadRetirementFacts()])
    const today = monthOf(new Date())
    const { settings, filled, missing } = deriveSettings(saved, facts, today)
    const projection = projectRetirement(settingsToInput(settings, today))
    return json({ settings, filled, missing, projection })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

/** The saved assumptions, with what derivation could fill and what it could not. */
export async function retirementSettingsGet(): Promise<Response> {
  try {
    const [saved, facts] = await Promise.all([loadSavedRetirementSettings(), loadRetirementFacts()])
    const today = monthOf(new Date())
    const { settings, filled, missing } = deriveSettings(saved, facts, today)
    return json({ settings, facts, filled, missing, startMonth: today })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementSettingsUpdate(body: unknown): Promise<Response> {
  try {
    // Normalised before storage, so the row can only ever hold something the model accepts.
    const settings = normalizeSettings(body)
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    await db.put('settings', { key: settingsKeyFor(pid), value: settings })
    // Re-derive and return the provenance too. Saving is what stops a field being derived,
    // so a client that only took `settings` from here went on showing "filled in from your
    // data" against figures the user had just entered by hand.
    //
    // What is stored is the normalised object, so every key is present and `filled` comes
    // back empty by construction. `missing` does not: it reports what the user's data
    // cannot answer at all, which a save does not change.
    const facts = await loadRetirementFacts()
    const derived = deriveSettings(settings, facts, monthOf(new Date()))
    return json({
      settings: derived.settings,
      filled: derived.filled,
      missing: derived.missing,
    })
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
