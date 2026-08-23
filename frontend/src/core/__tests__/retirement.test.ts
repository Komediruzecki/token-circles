/**
 * Tests for the shared retirement model.
 *
 * Two groups matter more than the rest:
 *
 *   - The closed-form checks. Compound growth and annuity future value have exact formulas,
 *     so the loop is compared against arithmetic rather than against a snapshot of itself.
 *     These are what the code this replaces would have failed: it accumulated interest in a
 *     side bucket that never compounded.
 *
 *   - The spreadsheet fixtures. Rows lifted from the sheet the app is meant to agree with,
 *     including one that reproduces a rate bug in it, so "the app and the sheet disagree"
 *     always has a decided answer.
 */
import { describe, expect, it } from 'vitest'
import {
  addMonths,
  blendedReturnPct,
  MAX_HORIZON_MONTHS,
  monthlyRate,
  monthOrdinal,
  projectRetirement,
  projectScenarios,
  realAnnualReturnPct,
  targetFromSpend,
  yearsOfWithdrawals,
} from '../../../../shared/retirement'
import type { RetirementInput } from '../../../../shared/retirement'

/** Input with everything switched off, so a test only turns on what it is about. */
function baseInput(overrides: Partial<RetirementInput> = {}): RetirementInput {
  return {
    startMonth: '2026-01',
    netWorth: 0,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    annualReturnPct: 0,
    annualInflationPct: 0,
    safeWithdrawalRatePct: 4,
    lifestyles: [],
    horizonMonths: 12,
    ...overrides,
  }
}

describe('month arithmetic', () => {
  it('adds months across year boundaries', () => {
    expect(addMonths('2026-01', 0)).toBe('2026-01')
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', 12)).toBe('2027-01')
    expect(addMonths('2026-03', -5)).toBe('2025-10')
  })

  it('orders months as integers', () => {
    expect(monthOrdinal('2027-01') - monthOrdinal('2026-01')).toBe(12)
    expect(monthOrdinal('2026-12') - monthOrdinal('2026-11')).toBe(1)
  })
})

describe('rate conversion', () => {
  it('produces a monthly rate that compounds back to the annual one', () => {
    for (const annual of [3.5, 5.78, 8.1, 12]) {
      const m = monthlyRate(annual)
      expect(Math.pow(1 + m, 12) - 1).toBeCloseTo(annual / 100, 12)
    }
  })

  it('is not the annual rate divided by twelve', () => {
    // Dividing overstates the monthly rate; compounded over a year it comes out ~0.3pp high
    // at 8.1%, and the gap grows with the rate.
    const divided = 8.1 / 100 / 12
    expect(monthlyRate(8.1)).toBeLessThan(divided)
    expect(Math.pow(1 + divided, 12) - 1).toBeGreaterThan(0.081)
  })

  it('nets inflation out with Fisher rather than subtraction', () => {
    expect(realAnnualReturnPct(8.1, 3.5)).toBeCloseTo(4.4444, 3)
    expect(realAnnualReturnPct(8.1, 3.5)).not.toBeCloseTo(8.1 - 3.5, 3)
    expect(realAnnualReturnPct(5, 5)).toBeCloseTo(0, 12)
  })
})

describe('blended return', () => {
  it('reproduces the allocation from the spreadsheet config', () => {
    // 10% bonds, 0% gold, 70% equity, 20% cash. Cash carries no nominal return and loses
    // the inflation rate, which is why the blend lands below the equity number.
    const blended = blendedReturnPct(
      [
        { label: 'Bonds', weightPct: 10, annualReturnPct: 8.1 },
        { label: 'Gold', weightPct: 0, annualReturnPct: 2.4 },
        { label: 'Equity', weightPct: 70, annualReturnPct: 8.1 },
        { label: 'Cash', weightPct: 20, annualReturnPct: 0, erodesWithInflation: true },
      ],
      3.5
    )
    expect(blended).toBeCloseTo(5.78, 10)
  })

  it('weights that sum to 100 with one asset return that asset', () => {
    expect(
      blendedReturnPct([{ label: 'All equity', weightPct: 100, annualReturnPct: 7 }], 3)
    ).toBeCloseTo(7, 10)
  })
})

describe('target from spend', () => {
  it('is 25x annual spend at a 4% withdrawal rate', () => {
    expect(targetFromSpend(2000, 4)).toBeCloseTo(2000 * 12 * 25, 6)
  })

  it('follows the spreadsheet at a 3.5% withdrawal rate', () => {
    expect(targetFromSpend(2000, 3.5)).toBeCloseTo(685714.2857, 3)
  })
})

describe('compounding', () => {
  it('grows a lump sum by the exact closed form', () => {
    const years = 30
    const p = projectRetirement(
      baseInput({ netWorth: 100000, annualReturnPct: 7, horizonMonths: years * 12 })
    )
    expect(p.finalNetWorth).toBeCloseTo(100000 * Math.pow(1.07, years), 4)
  })

  it('does not accumulate interest in a bucket that never compounds', () => {
    // The behaviour of the code this replaces: gains += balance * rate, with the gains kept
    // out of the balance. Over 30 years it lands at less than two thirds of the real answer,
    // so this is a difference no rounding tolerance can hide.
    const months = 360
    const rate = monthlyRate(7)
    const p = projectRetirement(
      baseInput({ netWorth: 100000, annualReturnPct: 7, horizonMonths: months })
    )

    const simple = 100000 + 100000 * rate * months
    expect(p.finalNetWorth).toBeGreaterThan(simple * 1.4)
    expect(p.finalNetWorth).toBeCloseTo(761225.5, 1)
    expect(simple).toBeCloseTo(303549.2, 1)
  })

  it('matches the annuity future value for level contributions', () => {
    const months = 240
    const contribution = 500
    const rate = monthlyRate(6)
    const p = projectRetirement(
      baseInput({
        monthlyIncome: contribution,
        annualReturnPct: 6,
        horizonMonths: months,
      })
    )
    // Ordinary annuity: contributions land at month end, so the last one earns nothing.
    const expected = contribution * ((Math.pow(1 + rate, months) - 1) / rate)
    expect(p.finalNetWorth).toBeCloseTo(expected, 4)
  })

  it('reports growth as everything not paid in', () => {
    const p = projectRetirement(
      baseInput({ netWorth: 10000, monthlyIncome: 200, annualReturnPct: 6, horizonMonths: 120 })
    )
    expect(p.totalSaved).toBeCloseTo(200 * 120, 6)
    expect(p.totalGrowth).toBeCloseTo(p.finalNetWorth - 10000 - p.totalSaved, 6)
    expect(p.totalGrowth).toBeGreaterThan(0)
  })

  it('leaves the opening month untouched', () => {
    const p = projectRetirement(
      baseInput({ netWorth: 50000, monthlyIncome: 1000, annualReturnPct: 7 })
    )
    expect(p.rows[0].month).toBe('2026-01')
    expect(p.rows[0].netWorth).toBe(50000)
    expect(p.rows[0].saved).toBe(0)
    expect(p.rows[1].month).toBe('2026-02')
  })
})

describe('inflation', () => {
  it('leaves real and nominal identical when it is switched off', () => {
    const p = projectRetirement(
      baseInput({ netWorth: 25000, monthlyIncome: 500, annualReturnPct: 6, horizonMonths: 60 })
    )
    for (const row of p.rows) expect(row.netWorthReal).toBeCloseTo(row.netWorth, 6)
  })

  it('discounts the nominal series by the compounded rate', () => {
    const p = projectRetirement(
      baseInput({ netWorth: 100000, annualReturnPct: 6, annualInflationPct: 3, horizonMonths: 120 })
    )
    const tenYears = p.rows[120]
    expect(tenYears.netWorth).toBeCloseTo(100000 * Math.pow(1.06, 10), 4)
    expect(tenYears.netWorthReal).toBeCloseTo(100000 * Math.pow(1.06 / 1.03, 10), 4)
    // Which is the same as growing at the Fisher real rate.
    expect(tenYears.netWorthReal).toBeCloseTo(
      100000 * Math.pow(1 + realAnnualReturnPct(6, 3) / 100, 10),
      4
    )
  })

  it('inflates expenses so a fixed income stops covering them', () => {
    const p = projectRetirement(
      baseInput({
        monthlyIncome: 3000,
        monthlyExpenses: 2000,
        annualInflationPct: 5,
        horizonMonths: 240,
      })
    )
    expect(p.rows[12].expenses).toBeCloseTo(2000 * 1.05, 6)
    expect(p.rows[120].expenses).toBeCloseTo(2000 * Math.pow(1.05, 10), 6)
    expect(p.rows[12].saved).toBeGreaterThan(0)
    expect(p.rows[240].saved).toBeLessThan(0)
  })
})

describe('income steps and raises', () => {
  // The salary path from the spreadsheet: a base, a job change in 2027, a bigger one in
  // 2030, and a 3.5% raise every January that a step only displaces when it beats it.
  const sheetIncome = () =>
    projectRetirement(
      baseInput({
        startMonth: '2026-07',
        monthlyIncome: 3566.06,
        annualRaisePct: 3.5,
        incomeSteps: [
          { fromMonth: '2027-01', monthlyAmount: 5000 },
          { fromMonth: '2030-01', monthlyAmount: 10000 },
        ],
        horizonMonths: 12 * 6,
      })
    )

  const at = (month: string) => {
    const p = sheetIncome()
    const row = p.rows.find((r) => r.month === month)
    if (!row) throw new Error(`no row for ${month}`)
    return row.income
  }

  it('starts at the base income', () => {
    expect(at('2026-07')).toBeCloseTo(3566.06, 6)
    expect(at('2026-12')).toBeCloseTo(3566.06, 6)
  })

  it('takes a step the month it starts', () => {
    expect(at('2027-01')).toBeCloseTo(5000, 6)
    expect(at('2030-01')).toBeCloseTo(10000, 6)
  })

  it('raises in January when no step beats the current salary', () => {
    expect(at('2028-01')).toBeCloseTo(5175, 6)
    expect(at('2029-01')).toBeCloseTo(5356.125, 6)
    expect(at('2031-01')).toBeCloseTo(10350, 6)
  })

  it('holds the salary flat between raises', () => {
    expect(at('2028-06')).toBeCloseTo(at('2028-01'), 6)
    expect(at('2028-12')).toBeCloseTo(at('2028-01'), 6)
  })

  it('models a pay cut, because a step is what the user said they will earn', () => {
    // A sabbatical or a career change is a step downwards. An earlier version took a step
    // only when it beat what raises had already produced, so typing one changed nothing.
    const p = projectRetirement(
      baseInput({
        startMonth: '2026-01',
        monthlyIncome: 4000,
        annualRaisePct: 10,
        incomeSteps: [{ fromMonth: '2031-01', monthlyAmount: 2000 }],
        horizonMonths: 12 * 6,
      })
    )
    // Four Januaries land before it (2027-2030); the opening month never carries a raise,
    // and the step replaces the raise that 2031-01 would otherwise have brought.
    expect(p.rows.find((r) => r.month === '2030-12')?.income).toBeCloseTo(
      4000 * Math.pow(1.1, 4),
      6
    )
    expect(p.rows.find((r) => r.month === '2031-01')?.income).toBeCloseTo(2000, 6)
  })

  it('compounds later raises from whatever the step set', () => {
    const p = projectRetirement(
      baseInput({
        startMonth: '2026-01',
        monthlyIncome: 4000,
        annualRaisePct: 10,
        incomeSteps: [{ fromMonth: '2027-06', monthlyAmount: 2000 }],
        horizonMonths: 12 * 4,
      })
    )
    expect(p.rows.find((r) => r.month === '2027-06')?.income).toBeCloseTo(2000, 6)
    expect(p.rows.find((r) => r.month === '2028-01')?.income).toBeCloseTo(2200, 6)
    expect(p.rows.find((r) => r.month === '2029-01')?.income).toBeCloseTo(2420, 6)
  })

  it('takes a step that already started as the opening income', () => {
    const p = projectRetirement(
      baseInput({
        startMonth: '2026-06',
        monthlyIncome: 3000,
        incomeSteps: [{ fromMonth: '2026-01', monthlyAmount: 5000 }],
        horizonMonths: 6,
      })
    )
    expect(p.rows[0].income).toBeCloseTo(5000, 6)
  })

  it('lets the last step win when two share a month', () => {
    const p = projectRetirement(
      baseInput({
        monthlyIncome: 1000,
        incomeSteps: [
          { fromMonth: '2026-06', monthlyAmount: 4000 },
          { fromMonth: '2026-06', monthlyAmount: 7000 },
        ],
        horizonMonths: 12,
      })
    )
    expect(p.rows.find((r) => r.month === '2026-06')?.income).toBeCloseTo(7000, 6)
  })

  it('ignores a step whose month is still being typed', () => {
    const p = projectRetirement(
      baseInput({
        monthlyIncome: 3000,
        incomeSteps: [{ fromMonth: '2026', monthlyAmount: 9000 }],
        horizonMonths: 12,
      })
    )
    for (const row of p.rows) expect(row.income).toBeCloseTo(3000, 6)
  })

  it('applies the raise in the configured month', () => {
    const p = projectRetirement(
      baseInput({ monthlyIncome: 1000, annualRaisePct: 10, raiseMonth: 7, horizonMonths: 24 })
    )
    expect(p.rows.find((r) => r.month === '2026-06')?.income).toBeCloseTo(1000, 6)
    expect(p.rows.find((r) => r.month === '2026-07')?.income).toBeCloseTo(1100, 6)
    expect(p.rows.find((r) => r.month === '2027-07')?.income).toBeCloseTo(1210, 6)
  })
})

describe('expense periods', () => {
  it('adds spend only inside the window', () => {
    const p = projectRetirement(
      baseInput({
        monthlyExpenses: 1000,
        expensePeriods: [{ fromMonth: '2026-04', toMonth: '2026-06', monthlyAmount: 500 }],
        horizonMonths: 12,
      })
    )
    expect(p.rows.find((r) => r.month === '2026-03')?.expenses).toBeCloseTo(1000, 6)
    expect(p.rows.find((r) => r.month === '2026-04')?.expenses).toBeCloseTo(1500, 6)
    expect(p.rows.find((r) => r.month === '2026-06')?.expenses).toBeCloseTo(1500, 6)
    expect(p.rows.find((r) => r.month === '2026-07')?.expenses).toBeCloseTo(1000, 6)
  })

  it('runs an open-ended period to the horizon', () => {
    const p = projectRetirement(
      baseInput({
        monthlyExpenses: 1000,
        expensePeriods: [{ fromMonth: '2026-06', monthlyAmount: 300 }],
        horizonMonths: 24,
      })
    )
    expect(p.rows[24].expenses).toBeCloseTo(1300, 6)
  })

  it('stacks overlapping periods', () => {
    const p = projectRetirement(
      baseInput({
        monthlyExpenses: 1000,
        expensePeriods: [
          { fromMonth: '2026-03', toMonth: '2026-08', monthlyAmount: 200 },
          { fromMonth: '2026-06', toMonth: '2026-12', monthlyAmount: 400 },
        ],
      })
    )
    expect(p.rows.find((r) => r.month === '2026-06')?.expenses).toBeCloseTo(1600, 6)
  })

  it('inflates planned spend along with the baseline', () => {
    const p = projectRetirement(
      baseInput({
        monthlyExpenses: 1000,
        annualInflationPct: 4,
        expensePeriods: [{ fromMonth: '2026-01', monthlyAmount: 500 }],
        horizonMonths: 12,
      })
    )
    expect(p.rows[12].expenses).toBeCloseTo(1500 * 1.04, 6)
  })
})

describe('lifestyle targets', () => {
  const withLifestyles = (netWorth: number) =>
    projectRetirement(
      baseInput({
        startMonth: '2026-01',
        birthMonth: '1994-01',
        netWorth,
        monthlyIncome: 5000,
        monthlyExpenses: 2000,
        annualReturnPct: 7,
        annualInflationPct: 3,
        annualRaisePct: 3,
        safeWithdrawalRatePct: 4,
        horizonMonths: 12 * 40,
        lifestyles: [
          { id: 'lean', label: 'Zagreb', monthlySpendToday: 1500 },
          { id: 'rich', label: 'Zurich', monthlySpendToday: 3000 },
        ],
      })
    )

  it('derives each target from its own spend', () => {
    const p = withLifestyles(50000)
    expect(p.lifestyles[0].targetToday).toBeCloseTo(1500 * 12 * 25, 6)
    expect(p.lifestyles[1].targetToday).toBeCloseTo(3000 * 12 * 25, 6)
  })

  it('crosses the cheaper lifestyle first', () => {
    const p = withLifestyles(50000)
    const lean = p.lifestyles[0].crossing
    const rich = p.lifestyles[1].crossing
    expect(lean).not.toBeNull()
    expect(rich).not.toBeNull()
    expect(lean!.index).toBeLessThan(rich!.index)
  })

  it('reports the crossing in real and nominal terms consistently', () => {
    const p = withLifestyles(50000)
    const lean = p.lifestyles[0].crossing!
    const row = p.rows[lean.index]
    expect(lean.netWorth).toBeCloseTo(row.netWorth, 6)
    // Nominal net worth clears the inflated target exactly when real clears today's target.
    expect(row.netWorth).toBeGreaterThanOrEqual(lean.targetNominal - 1e-6)
    expect(row.netWorthReal).toBeGreaterThanOrEqual(p.lifestyles[0].targetToday - 1e-6)
    // And the month before did not.
    expect(p.rows[lean.index - 1].netWorthReal).toBeLessThan(p.lifestyles[0].targetToday)
  })

  it('reports no crossing rather than guessing when the target is out of reach', () => {
    const p = projectRetirement(
      baseInput({
        netWorth: 1000,
        monthlyIncome: 1000,
        monthlyExpenses: 990,
        annualReturnPct: 1,
        horizonMonths: 120,
        lifestyles: [{ id: 'rich', label: 'Never', monthlySpendToday: 20000 }],
      })
    )
    expect(p.lifestyles[0].crossing).toBeNull()
  })

  it('labels the crossing with an age when a birth month is given', () => {
    const p = withLifestyles(400000)
    expect(p.lifestyles[0].crossing?.age).toBeGreaterThanOrEqual(32)
    expect(p.rows[0].age).toBe(32)
  })

  it('leaves the age null when no birth month is given', () => {
    const p = projectRetirement(baseInput({ netWorth: 1000 }))
    expect(p.rows[0].age).toBeNull()
  })

  it('brings retirement forward when the portfolio starts larger', () => {
    const small = withLifestyles(50000).lifestyles[0].crossing!
    const large = withLifestyles(300000).lifestyles[0].crossing!
    expect(large.index).toBeLessThan(small.index)
  })
})

describe('horizon', () => {
  it('runs to the life expectancy age when one is given', () => {
    const p = projectRetirement(
      baseInput({
        startMonth: '2026-01',
        birthMonth: '1994-06',
        lifeExpectancyAge: 90,
        horizonMonths: undefined,
      })
    )
    expect(p.rows[p.rows.length - 1].month).toBe('2084-06')
    expect(p.rows[p.rows.length - 1].age).toBe(90)
  })

  it('prefers an explicit horizon over the life expectancy', () => {
    const p = projectRetirement(
      baseInput({ birthMonth: '1994-06', lifeExpectancyAge: 90, horizonMonths: 6 })
    )
    expect(p.rows).toHaveLength(7)
  })
})

describe('scenarios', () => {
  it('runs the same plan at several return assumptions', () => {
    const input = baseInput({
      netWorth: 100000,
      monthlyIncome: 1000,
      annualReturnPct: 6,
      horizonMonths: 240,
    })
    const scenarios = projectScenarios(input, [
      { label: 'Pessimistic', annualReturnPct: 3 },
      { label: 'Expected', annualReturnPct: 6 },
      { label: 'Optimistic', annualReturnPct: 9 },
    ])
    expect(scenarios).toHaveLength(3)
    expect(scenarios[0].projection.finalNetWorth).toBeLessThan(
      scenarios[1].projection.finalNetWorth
    )
    expect(scenarios[1].projection.finalNetWorth).toBeLessThan(
      scenarios[2].projection.finalNetWorth
    )
    // The base input is not mutated.
    expect(input.annualReturnPct).toBe(6)
  })
})

describe('validation', () => {
  it('rejects a start month that is not YYYY-MM', () => {
    expect(() => projectRetirement(baseInput({ startMonth: '2026-1' }))).toThrow(/startMonth/)
    expect(() => projectRetirement(baseInput({ startMonth: '2026-13' }))).toThrow(/startMonth/)
    expect(() => projectRetirement(baseInput({ startMonth: 'July 2026' }))).toThrow(/startMonth/)
  })

  it('rejects a malformed birth month', () => {
    expect(() => projectRetirement(baseInput({ birthMonth: '1994' }))).toThrow(/birthMonth/)
  })
})

describe('spreadsheet fixtures', () => {
  // The sheet converts its annual rate with POW(rate, 1/12) * 0.01 — rooting the percentage
  // number itself rather than 1 + rate/100. At a configured 5.78% that is 1.157%/month,
  // which compounds to 14.81%/year: two and a half times the intended growth.
  const sheetBuggyMonthlyRate = Math.pow(5.78, 1 / 12) * 0.01
  const sheetBuggyAnnualPct = (Math.pow(1 + sheetBuggyMonthlyRate, 12) - 1) * 100

  it('decodes the spreadsheet rate bug', () => {
    expect(sheetBuggyMonthlyRate).toBeCloseTo(0.0115743, 7)
    expect(sheetBuggyAnnualPct).toBeCloseTo(14.8083, 3)
    // What the sheet meant to use.
    expect(monthlyRate(5.78)).toBeCloseTo(0.0046936, 6)
    expect(sheetBuggyMonthlyRate / monthlyRate(5.78)).toBeGreaterThan(2.4)
  })

  // Opening balance and first month's saving taken from the sheet's own rows. Inflation is
  // off here and the saving is given directly, so the fixture tests one thing: that feeding
  // the sheet's rate through this model reproduces the sheet's balance to the cent.
  const sheetRow = (annualReturnPct: number) =>
    projectRetirement(
      baseInput({
        startMonth: '2026-07',
        netWorth: 66931.42,
        monthlyIncome: 3566.06,
        monthlyExpenses: 4229.16,
        annualReturnPct,
        horizonMonths: 1,
      })
    )

  it('reproduces the sheet row exactly when given the sheet rate', () => {
    const p = sheetRow(sheetBuggyAnnualPct)
    expect(p.rows[1].saved).toBeCloseTo(-663.1, 2)
    expect(p.rows[1].netWorth).toBeCloseTo(67043.0, 2)
  })

  it('shows what that row should have been at the configured 5.78%', () => {
    const p = sheetRow(5.78)
    expect(p.rows[1].netWorth).toBeCloseTo(66582.47, 2)
    // The sheet's month-one balance is already 460 ahead of the intended one, on a single
    // month of a 66.9k portfolio. Compounded over the projection the gap is the whole plan.
    expect(sheetRow(sheetBuggyAnnualPct).rows[1].netWorth - p.rows[1].netWorth).toBeCloseTo(
      460.53,
      2
    )
  })

  it('reproduces the retirement target from the sheet config', () => {
    // 2,000/month today, inflated 62 years at 3.5%, drawn at 3.5%.
    const spendThen = 2000 * 12 * Math.pow(1.035, 62)
    expect(spendThen).toBeCloseTo(202541, 0)
    expect(spendThen / 0.035).toBeCloseTo(5786885, 0)
    // Same number the model reports, since inflating the spend and inflating the target are
    // the same operation.
    const p = projectRetirement(
      baseInput({
        annualInflationPct: 3.5,
        safeWithdrawalRatePct: 3.5,
        horizonMonths: 62 * 12,
        lifestyles: [{ id: 'target', label: 'Sheet target', monthlySpendToday: 2000 }],
      })
    )
    const target = p.lifestyles[0]
    expect(target.targetToday * Math.pow(1 + p.monthlyInflationRate, 62 * 12)).toBeCloseTo(
      5786885,
      0
    )
  })
})

describe('horizon limits', () => {
  it('caps a horizon no plan could need, so a bad input cannot allocate without bound', () => {
    const p = projectRetirement(baseInput({ horizonMonths: 5_000_000 }))
    expect(p.rows).toHaveLength(MAX_HORIZON_MONTHS + 1)
  })

  it('caps a life expectancy reached through a birth month too', () => {
    const p = projectRetirement(
      baseInput({ birthMonth: '2026-01', lifeExpectancyAge: 9000, horizonMonths: undefined })
    )
    expect(p.rows).toHaveLength(MAX_HORIZON_MONTHS + 1)
  })

  it('falls back to a fixed span when there is no birth month to count an age from', () => {
    // The caller offering "plan until age" has to say this: without a date of birth there is
    // no age to stop at, and the field cannot do anything.
    const withAge = projectRetirement(
      baseInput({ lifeExpectancyAge: 70, horizonMonths: undefined })
    )
    const withoutAge = projectRetirement(
      baseInput({ lifeExpectancyAge: undefined, horizonMonths: undefined })
    )
    expect(withAge.rows).toHaveLength(withoutAge.rows.length)
  })
})

describe('half-typed months', () => {
  it('does not apply an expense period whose start month is incomplete', () => {
    const p = projectRetirement(
      baseInput({
        monthlyExpenses: 1000,
        expensePeriods: [{ fromMonth: '2026', monthlyAmount: 500 }],
        horizonMonths: 12,
      })
    )
    // NaN fails every comparison, which used to leave the period applying from month zero.
    for (const row of p.rows) expect(row.expenses).toBeCloseTo(1000, 6)
  })

  it('treats an incomplete end month as no end rather than as an expired window', () => {
    const p = projectRetirement(
      baseInput({
        monthlyExpenses: 1000,
        expensePeriods: [{ fromMonth: '2026-03', toMonth: '2026', monthlyAmount: 500 }],
        horizonMonths: 12,
      })
    )
    expect(p.rows.find((r) => r.month === '2026-02')?.expenses).toBeCloseTo(1000, 6)
    expect(p.rows.find((r) => r.month === '2026-09')?.expenses).toBeCloseTo(1500, 6)
  })
})

/**
 * The withdrawal rate, in detail.
 *
 * Raising it brings the retirement date FORWARD, which reads as a bug and is not one: the
 * rate is a claim about how much of the pot you take each year, so claiming more means
 * needing less saved. What it also does — shorten how long the money lasts — was invisible,
 * and that is the part that made it look like a free lunch. These pin both halves together
 * so neither can be changed without the other being reconsidered.
 */
describe('withdrawal rate: a smaller target, bought with a shorter runway', () => {
  // The exact plan that prompted the question: born October 1995, 50k net worth, 7%
  // return, 2.5% inflation, lifestyles at 1k/2k/4k a month.
  const reported = (swr: number): RetirementInput => ({
    startMonth: '2026-01',
    birthMonth: '1995-10',
    netWorth: 50_000,
    monthlyIncome: 4_000,
    monthlyExpenses: 2_000,
    annualReturnPct: 7,
    annualInflationPct: 2.5,
    safeWithdrawalRatePct: swr,
    lifeExpectancyAge: 90,
    lifestyles: [
      { id: 'a', label: 'Easy', monthlySpendToday: 1_000 },
      { id: 'b', label: 'Comfortable', monthlySpendToday: 2_000 },
      { id: 'c', label: 'Generous', monthlySpendToday: 4_000 },
    ],
  })

  it('reproduces both targets the user saw, to the cent', () => {
    // 1000/mo at 4% is 25x annual spending; at 12% it is 8.33x.
    expect(targetFromSpend(1_000, 4)).toBeCloseTo(300_000, 6)
    expect(targetFromSpend(1_000, 12)).toBeCloseTo(100_000, 6)

    const at4 = projectRetirement(reported(4))
    const at12 = projectRetirement(reported(12))
    expect(at4.lifestyles[0].targetToday).toBeCloseTo(300_000, 6)
    expect(at12.lifestyles[0].targetToday).toBeCloseTo(100_000, 6)
  })

  it('reaches the smaller target sooner — the behaviour that looked wrong', () => {
    const at4 = projectRetirement(reported(4)).lifestyles[0].crossing
    const at12 = projectRetirement(reported(12)).lifestyles[0].crossing
    expect(at4).not.toBeNull()
    expect(at12).not.toBeNull()
    expect(at12!.index).toBeLessThan(at4!.index)
    // Same pot, same growth: only the finish line moved. Ages are non-null here because
    // this plan has a birth month; without one the projection reports no age at all.
    expect(typeof at4!.age).toBe('number')
    expect(typeof at12!.age).toBe('number')
    expect(at12!.age!).toBeLessThan(at4!.age!)
  })

  it('is monotonic — every increase in the rate moves the date earlier or leaves it', () => {
    let previous = Number.POSITIVE_INFINITY
    for (const swr of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20]) {
      const crossing = projectRetirement(reported(swr)).lifestyles[0].crossing
      expect(crossing).not.toBeNull()
      expect(crossing!.index).toBeLessThanOrEqual(previous)
      previous = crossing!.index
    }
  })

  it('shows what the earlier date costs: the money runs out', () => {
    const real = realAnnualReturnPct(7, 2.5)
    expect(real).toBeCloseTo(4.390243902439025, 10)
    // 4% is under the real return, so growth covers it forever. That is what "safe" means.
    expect(yearsOfWithdrawals(4, real)).toBe(Number.POSITIVE_INFINITY)
    // 12% is not. About eleven years, and then nothing.
    expect(yearsOfWithdrawals(12, real)).toBeCloseTo(10.6, 1)
  })

  it('scales the target with spending, not with the plan', () => {
    const at4 = projectRetirement(reported(4))
    expect(at4.lifestyles[1].targetToday).toBeCloseTo(600_000, 6)
    expect(at4.lifestyles[2].targetToday).toBeCloseTo(1_200_000, 6)
    // A more expensive lifestyle is always reached later, never sooner.
    const [easy, comfortable, generous] = at4.lifestyles
    expect(easy.crossing!.index).toBeLessThan(comfortable.crossing!.index)
    expect(comfortable.crossing!.index).toBeLessThan(generous.crossing!.index)
  })

  it('does not care how long you plan to live', () => {
    // The crossing is where the pot reaches the target; the horizon only decides how far
    // the chart is drawn. A shorter life expectancy must not move the date.
    const to60 = projectRetirement({ ...reported(4), lifeExpectancyAge: 60 })
    const to90 = projectRetirement({ ...reported(4), lifeExpectancyAge: 90 })
    expect(to60.lifestyles[0].crossing!.month).toBe(to90.lifestyles[0].crossing!.month)
  })
})

describe('how long the money lasts', () => {
  it('is forever exactly when growth covers the draw', () => {
    expect(yearsOfWithdrawals(4, 4)).toBe(Number.POSITIVE_INFINITY)
    expect(yearsOfWithdrawals(3.99, 4)).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isFinite(yearsOfWithdrawals(4.01, 4))).toBe(true)
  })

  it('is 1/rate when the pot does not grow at all', () => {
    expect(yearsOfWithdrawals(4, 0)).toBeCloseTo(25, 10)
    expect(yearsOfWithdrawals(10, 0)).toBeCloseTo(10, 10)
    expect(yearsOfWithdrawals(100, 0)).toBeCloseTo(1, 10)
  })

  it('shortens as the draw rises and lengthens as the return rises', () => {
    const real = 4.39
    let previous = Number.POSITIVE_INFINITY
    for (const swr of [5, 6, 8, 12, 20, 50, 100]) {
      const years = yearsOfWithdrawals(swr, real)
      expect(years).toBeLessThan(previous)
      previous = years
    }
    expect(yearsOfWithdrawals(8, 6)).toBeGreaterThan(yearsOfWithdrawals(8, 2))
  })

  it('handles a return that loses to inflation', () => {
    // A negative real return drains the pot faster than no growth would.
    expect(yearsOfWithdrawals(4, -2)).toBeLessThan(yearsOfWithdrawals(4, 0))
    expect(yearsOfWithdrawals(4, -2)).toBeGreaterThan(0)
  })

  it('degrades sanely at the edges rather than returning NaN', () => {
    expect(yearsOfWithdrawals(0, 5)).toBe(Number.POSITIVE_INFINITY)
    expect(yearsOfWithdrawals(-1, 5)).toBe(Number.POSITIVE_INFINITY)
    // Everything lost every year leaves nothing to draw a second time.
    expect(yearsOfWithdrawals(50, -100)).toBe(0)
    expect(yearsOfWithdrawals(50, -150)).toBe(0)
    for (const [swr, real] of [
      [4, 4.39],
      [12, 4.39],
      [0.01, 0.01],
      [100, 99],
    ]) {
      expect(Number.isNaN(yearsOfWithdrawals(swr, real))).toBe(false)
    }
  })

  it('draws the whole pot in the first year at 100%', () => {
    expect(yearsOfWithdrawals(100, 0)).toBeCloseTo(1, 10)
  })
})

describe('targets at the edges', () => {
  it('treats a zero or negative rate as an unreachable target rather than dividing by it', () => {
    expect(targetFromSpend(2_000, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(targetFromSpend(2_000, -4)).toBe(Number.POSITIVE_INFINITY)
  })

  it('needs nothing saved to fund nothing', () => {
    expect(targetFromSpend(0, 4)).toBe(0)
  })

  it('reports no crossing rather than a wrong one when the target is out of reach', () => {
    const result = projectRetirement({
      startMonth: '2026-01',
      netWorth: 0,
      monthlyIncome: 100,
      monthlyExpenses: 0,
      annualReturnPct: 0,
      annualInflationPct: 0,
      safeWithdrawalRatePct: 4,
      horizonMonths: 12,
      lifestyles: [{ id: 'x', label: 'Unreachable', monthlySpendToday: 10_000 }],
    })
    expect(result.lifestyles[0].crossing).toBeNull()
  })

  it('crosses at month zero when the pot is already big enough', () => {
    const result = projectRetirement({
      startMonth: '2026-01',
      netWorth: 1_000_000,
      monthlyIncome: 0,
      monthlyExpenses: 0,
      annualReturnPct: 0,
      annualInflationPct: 0,
      safeWithdrawalRatePct: 4,
      horizonMonths: 12,
      lifestyles: [{ id: 'x', label: 'Already there', monthlySpendToday: 1_000 }],
    })
    expect(result.lifestyles[0].crossing?.index).toBe(0)
  })
})
