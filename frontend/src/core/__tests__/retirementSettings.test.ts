/**
 * Tests for the retirement assumptions layer.
 *
 * Normalisation is the interesting half: the settings row is JSON written by whatever
 * version of the app last saved it, so these check that an old blob, a partial blob and an
 * actively broken one all come back usable rather than taking the page down.
 */
import { describe, expect, it } from 'vitest'
import { projectRetirement } from '../../../../shared/retirement'
import {
  buildFacts,
  DEFAULT_SETTINGS,
  deriveSettings,
  effectiveReturnPct,
  MIN_MONTHS_FOR_AVERAGES,
  monthOf,
  normalizeSettings,
  round,
  settingsToInput,
} from '../../../../shared/retirementSettings'
import type { RetirementFacts } from '../../../../shared/retirementSettings'

const NO_FACTS: RetirementFacts = {
  netWorth: null,
  monthlyIncome: null,
  monthlyExpenses: null,
  monthsObserved: 0,
  currentAge: null,
}

describe('normalizeSettings', () => {
  it('turns nothing at all into the defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('not an object')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps the fields a stored blob does have', () => {
    const s = normalizeSettings({ netWorth: 66931.42, annualReturnPct: 5.78, mode: 'advanced' })
    expect(s.netWorth).toBeCloseTo(66931.42, 10)
    expect(s.annualReturnPct).toBeCloseTo(5.78, 10)
    expect(s.mode).toBe('advanced')
    // And defaults everything it does not.
    expect(s.safeWithdrawalRatePct).toBe(DEFAULT_SETTINGS.safeWithdrawalRatePct)
  })

  it('coerces numbers that were stored as strings', () => {
    const s = normalizeSettings({ netWorth: '12345.5', annualInflationPct: '3.5' })
    expect(s.netWorth).toBe(12345.5)
    expect(s.annualInflationPct).toBe(3.5)
  })

  it('falls back rather than propagating a value that is not a number', () => {
    const s = normalizeSettings({
      netWorth: 'lots',
      annualReturnPct: NaN,
      annualInflationPct: Infinity,
      lifeExpectancyAge: null,
    })
    expect(s.netWorth).toBe(DEFAULT_SETTINGS.netWorth)
    expect(s.annualReturnPct).toBe(DEFAULT_SETTINGS.annualReturnPct)
    expect(s.annualInflationPct).toBe(DEFAULT_SETTINGS.annualInflationPct)
    expect(s.lifeExpectancyAge).toBe(DEFAULT_SETTINGS.lifeExpectancyAge)
  })

  it('clamps rates into a range a projection can survive', () => {
    const s = normalizeSettings({
      annualReturnPct: 5000,
      annualInflationPct: -10,
      safeWithdrawalRatePct: 0,
      lifeExpectancyAge: 500,
    })
    expect(s.annualReturnPct).toBe(50)
    expect(s.annualInflationPct).toBe(0)
    expect(s.safeWithdrawalRatePct).toBeCloseTo(0.1, 10)
    expect(s.lifeExpectancyAge).toBe(120)
  })

  it('treats an unknown mode as simple', () => {
    expect(normalizeSettings({ mode: 'expert' }).mode).toBe('simple')
    expect(normalizeSettings({ mode: 42 }).mode).toBe('simple')
  })

  it('reads booleans stored as strings', () => {
    expect(normalizeSettings({ adjustForInflation: 'false' }).adjustForInflation).toBe(false)
    expect(normalizeSettings({ useAllocation: 'true' }).useAllocation).toBe(true)
  })

  it('leaves its own defaults untouched, so loading does not rewrite them', () => {
    expect(normalizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('hands back copies, so a caller cannot mutate the shared defaults', () => {
    const a = normalizeSettings({})
    const b = normalizeSettings({})
    a.lifestyles[0].monthlySpendToday = 99999
    a.allocation[0].weightPct = 1
    expect(b.lifestyles[0].monthlySpendToday).toBe(DEFAULT_SETTINGS.lifestyles[0].monthlySpendToday)
    expect(b.allocation[0].weightPct).toBe(DEFAULT_SETTINGS.allocation[0].weightPct)
  })

  it('is idempotent, so saving what it returns changes nothing', () => {
    const once = normalizeSettings({
      mode: 'advanced',
      netWorth: '100',
      incomeSteps: [{ fromMonth: '2030-01', monthlyAmount: '9000' }],
      lifestyles: [{ id: 'a', label: 'A', monthlySpendToday: 1500 }],
    })
    expect(normalizeSettings(once)).toEqual(once)
  })

  describe('income steps', () => {
    it('drops steps with no usable month', () => {
      const s = normalizeSettings({
        incomeSteps: [
          { fromMonth: '2030-01', monthlyAmount: 9000 },
          { fromMonth: 'sometime', monthlyAmount: 9000 },
          { monthlyAmount: 9000 },
        ],
      })
      expect(s.incomeSteps).toEqual([{ fromMonth: '2030-01', monthlyAmount: 9000 }])
    })

    it('sorts steps chronologically', () => {
      const s = normalizeSettings({
        incomeSteps: [
          { fromMonth: '2030-01', monthlyAmount: 10000 },
          { fromMonth: '2027-01', monthlyAmount: 5000 },
        ],
      })
      expect(s.incomeSteps.map((x) => x.fromMonth)).toEqual(['2027-01', '2030-01'])
    })
  })

  describe('expense periods', () => {
    it('keeps a window that ends after it starts', () => {
      const s = normalizeSettings({
        expensePeriods: [{ fromMonth: '2027-01', toMonth: '2027-06', monthlyAmount: 400 }],
      })
      expect(s.expensePeriods[0].toMonth).toBe('2027-06')
    })

    it('drops an end that falls before the start instead of keeping a dead window', () => {
      const s = normalizeSettings({
        expensePeriods: [{ fromMonth: '2027-06', toMonth: '2027-01', monthlyAmount: 400 }],
      })
      expect(s.expensePeriods[0].fromMonth).toBe('2027-06')
      expect(s.expensePeriods[0].toMonth).toBeUndefined()
    })

    it('allows a negative amount, which is a planned saving rather than a cost', () => {
      const s = normalizeSettings({
        expensePeriods: [{ fromMonth: '2027-01', monthlyAmount: -200 }],
      })
      expect(s.expensePeriods[0].monthlyAmount).toBe(-200)
    })
  })

  describe('lifestyles', () => {
    it('falls back to the default when the list is empty', () => {
      expect(normalizeSettings({ lifestyles: [] }).lifestyles).toEqual(DEFAULT_SETTINGS.lifestyles)
    })

    it('drops entries with nothing to fund', () => {
      const s = normalizeSettings({
        lifestyles: [
          { id: 'a', label: 'Zagreb', monthlySpendToday: 1500 },
          { id: 'b', label: 'Empty', monthlySpendToday: 0 },
        ],
      })
      expect(s.lifestyles).toHaveLength(1)
      expect(s.lifestyles[0].id).toBe('a')
    })

    it('makes duplicate ids unique so the UI cannot edit two rows at once', () => {
      const s = normalizeSettings({
        lifestyles: [
          { id: 'a', label: 'One', monthlySpendToday: 1000 },
          { id: 'a', label: 'Two', monthlySpendToday: 2000 },
        ],
      })
      expect(s.lifestyles).toHaveLength(2)
      expect(s.lifestyles[0].id).not.toBe(s.lifestyles[1].id)
    })

    it('names an entry that arrived without a label', () => {
      const s = normalizeSettings({ lifestyles: [{ monthlySpendToday: 1000 }] })
      expect(s.lifestyles[0].label).toBe('Lifestyle 1')
      expect(s.lifestyles[0].id).toBe('lifestyle-1')
    })
  })

  describe('allocation', () => {
    it('falls back to the default when there are no slices', () => {
      expect(normalizeSettings({ allocation: [] }).allocation).toEqual(DEFAULT_SETTINGS.allocation)
    })

    it('clamps weights to a share of a portfolio', () => {
      const s = normalizeSettings({
        allocation: [{ label: 'Equity', weightPct: 300, annualReturnPct: 8 }],
      })
      expect(s.allocation[0].weightPct).toBe(100)
    })
  })
})

describe('effectiveReturnPct', () => {
  it('uses the entered rate when the allocation is off', () => {
    const s = normalizeSettings({ annualReturnPct: 6.5, useAllocation: false })
    expect(effectiveReturnPct(s)).toBe(6.5)
  })

  it('uses the allocation when it is on', () => {
    const s = normalizeSettings({
      annualReturnPct: 6.5,
      useAllocation: true,
      annualInflationPct: 3.5,
      allocation: [
        { label: 'Bonds', weightPct: 10, annualReturnPct: 8.1 },
        { label: 'Equity', weightPct: 70, annualReturnPct: 8.1 },
        { label: 'Cash', weightPct: 20, annualReturnPct: 0, erodesWithInflation: true },
      ],
    })
    expect(effectiveReturnPct(s)).toBeCloseTo(5.78, 10)
  })
})

describe('settingsToInput', () => {
  it('maps the simple contribution onto income with nothing spent against it', () => {
    const s = normalizeSettings({ mode: 'simple', monthlyContribution: 750, monthlyExpenses: 2000 })
    const input = settingsToInput(s, '2026-08')
    expect(input.monthlyIncome).toBe(750)
    expect(input.monthlyExpenses).toBe(0)
    expect(input.startMonth).toBe('2026-08')
  })

  it('ignores raises, steps and periods in simple mode', () => {
    const s = normalizeSettings({
      mode: 'simple',
      annualRaisePct: 5,
      incomeSteps: [{ fromMonth: '2030-01', monthlyAmount: 9000 }],
      expensePeriods: [{ fromMonth: '2030-01', monthlyAmount: 500 }],
    })
    const input = settingsToInput(s, '2026-08')
    expect(input.annualRaisePct).toBe(0)
    expect(input.incomeSteps).toEqual([])
    expect(input.expensePeriods).toEqual([])
  })

  it('carries income, expenses and the plan through in advanced mode', () => {
    const s = normalizeSettings({
      mode: 'advanced',
      monthlyIncome: 4000,
      monthlyExpenses: 2500,
      annualRaisePct: 3.5,
      incomeSteps: [{ fromMonth: '2030-01', monthlyAmount: 9000 }],
    })
    const input = settingsToInput(s, '2026-08')
    expect(input.monthlyIncome).toBe(4000)
    expect(input.monthlyExpenses).toBe(2500)
    expect(input.annualRaisePct).toBe(3.5)
    expect(input.incomeSteps).toHaveLength(1)
  })

  it('zeroes inflation when the toggle is off, leaving the rate saved for when it is on', () => {
    const s = normalizeSettings({ adjustForInflation: false, annualInflationPct: 3.5 })
    expect(settingsToInput(s, '2026-08').annualInflationPct).toBe(0)
    expect(s.annualInflationPct).toBe(3.5)
  })

  it('produces a projection where switching inflation off collapses real onto nominal', () => {
    const on = normalizeSettings({
      adjustForInflation: true,
      annualInflationPct: 3,
      netWorth: 50000,
    })
    const off = normalizeSettings({
      adjustForInflation: false,
      annualInflationPct: 3,
      netWorth: 50000,
    })
    const withInflation = projectRetirement(settingsToInput(on, '2026-01'))
    const without = projectRetirement(settingsToInput(off, '2026-01'))
    expect(withInflation.rows[120].netWorthReal).toBeLessThan(withInflation.rows[120].netWorth)
    expect(without.rows[120].netWorthReal).toBeCloseTo(without.rows[120].netWorth, 6)
    // The nominal path is the same either way; only the reading of it changes.
    expect(without.rows[120].netWorth).toBeCloseTo(withInflation.rows[120].netWorth, 6)
  })

  it('omits the birth month rather than passing null into the model', () => {
    const input = settingsToInput(normalizeSettings({}), '2026-08')
    expect(input.birthMonth).toBeUndefined()
    expect(() => projectRetirement(input)).not.toThrow()
  })
})

describe('deriveSettings', () => {
  const facts = (over: Partial<RetirementFacts> = {}): RetirementFacts => ({
    ...NO_FACTS,
    ...over,
  })

  it('fills the opening balance from the account total', () => {
    const { settings, filled } = deriveSettings(
      normalizeSettings({}),
      facts({ netWorth: 66931.42 }),
      '2026-08'
    )
    expect(settings.netWorth).toBeCloseTo(66931.42, 10)
    expect(filled.map((f) => f.field)).toContain('netWorth')
  })

  it('leaves a balance the user already set alone', () => {
    const { settings, filled } = deriveSettings(
      normalizeSettings({ netWorth: 10000 }),
      facts({ netWorth: 66931.42 }),
      '2026-08'
    )
    expect(settings.netWorth).toBe(10000)
    expect(filled.map((f) => f.field)).not.toContain('netWorth')
  })

  it('fills income and spending from enough history', () => {
    const { settings, filled } = deriveSettings(
      normalizeSettings({ mode: 'advanced' }),
      facts({ monthlyIncome: 3566.06, monthlyExpenses: 2400, monthsObserved: 14 }),
      '2026-08'
    )
    expect(settings.monthlyIncome).toBeCloseTo(3566.06, 10)
    expect(settings.monthlyExpenses).toBe(2400)
    expect(filled.find((f) => f.field === 'monthlyIncome')?.source).toContain('14 months')
  })

  it('refuses to average over too little history', () => {
    const { settings, filled, missing } = deriveSettings(
      normalizeSettings({ mode: 'advanced' }),
      facts({ monthlyIncome: 3566.06, monthlyExpenses: 2400, monthsObserved: 2 }),
      '2026-08'
    )
    expect(settings.monthlyIncome).toBe(0)
    expect(settings.monthlyExpenses).toBe(0)
    expect(filled.map((f) => f.field)).not.toContain('monthlyIncome')
    expect(missing).toContain('monthlyIncome')
  })

  it('accepts exactly the minimum number of months', () => {
    const { settings } = deriveSettings(
      normalizeSettings({ mode: 'advanced' }),
      facts({
        monthlyIncome: 3000,
        monthlyExpenses: 2000,
        monthsObserved: MIN_MONTHS_FOR_AVERAGES,
      }),
      '2026-08'
    )
    expect(settings.monthlyIncome).toBe(3000)
  })

  it('derives the simple contribution from what the user actually saves', () => {
    const { settings, filled } = deriveSettings(
      normalizeSettings({}),
      facts({ monthlyIncome: 3566.06, monthlyExpenses: 2400, monthsObserved: 12 }),
      '2026-08'
    )
    expect(settings.monthlyContribution).toBeCloseTo(1166.06, 6)
    expect(filled.map((f) => f.field)).toContain('monthlyContribution')
  })

  it('does not offer a negative contribution when spending exceeds income', () => {
    const { settings } = deriveSettings(
      normalizeSettings({}),
      facts({ monthlyIncome: 2000, monthlyExpenses: 3000, monthsObserved: 12 }),
      '2026-08'
    )
    expect(settings.monthlyContribution).toBe(0)
  })

  it('sets the retirement target to what the user spends now', () => {
    const { settings, filled } = deriveSettings(
      normalizeSettings({}),
      facts({ monthlyExpenses: 2400, monthlyIncome: 3500, monthsObserved: 12 }),
      '2026-08'
    )
    expect(settings.lifestyles).toHaveLength(1)
    expect(settings.lifestyles[0].monthlySpendToday).toBe(2400)
    expect(settings.lifestyles[0].label).toBe('Current lifestyle')
    expect(filled.map((f) => f.field)).toContain('lifestyles')
  })

  it('leaves lifestyles the user has customised alone', () => {
    const saved = normalizeSettings({
      lifestyles: [
        { id: 'zg', label: 'Zagreb', monthlySpendToday: 1500 },
        { id: 'zh', label: 'Zurich', monthlySpendToday: 4000 },
      ],
    })
    const { settings } = deriveSettings(
      saved,
      facts({ monthlyExpenses: 2400, monthlyIncome: 3500, monthsObserved: 12 }),
      '2026-08'
    )
    expect(settings.lifestyles).toEqual(saved.lifestyles)
  })

  it('turns an age recorded on a goal into a birth month', () => {
    const { settings, filled } = deriveSettings(
      normalizeSettings({}),
      facts({ currentAge: 32 }),
      '2026-08'
    )
    expect(settings.birthMonth).toBe('1994-08')
    expect(filled.find((f) => f.field === 'birthMonth')?.source).toContain('32')
  })

  it('reports what it could not answer', () => {
    const { missing } = deriveSettings(normalizeSettings({}), NO_FACTS, '2026-08')
    expect(missing).toContain('netWorth')
    expect(missing).toContain('birthMonth')
    expect(missing).toContain('monthlyIncome')
  })

  it('reports nothing missing once the data covers it', () => {
    const { missing } = deriveSettings(
      normalizeSettings({}),
      facts({
        netWorth: 50000,
        monthlyIncome: 3000,
        monthlyExpenses: 2000,
        monthsObserved: 12,
        currentAge: 32,
      }),
      '2026-08'
    )
    expect(missing).toEqual([])
  })

  it('does not mutate the settings it was given', () => {
    const saved = normalizeSettings({})
    const before = JSON.stringify(saved)
    deriveSettings(saved, facts({ netWorth: 1000, currentAge: 40 }), '2026-08')
    expect(JSON.stringify(saved)).toBe(before)
  })

  it('produces settings the model accepts', () => {
    const { settings } = deriveSettings(
      normalizeSettings({}),
      facts({
        netWorth: 66931.42,
        monthlyIncome: 3566.06,
        monthlyExpenses: 2400,
        monthsObserved: 14,
        currentAge: 32,
      }),
      '2026-08'
    )
    const p = projectRetirement(settingsToInput(settings, '2026-08'))
    expect(p.rows[0].netWorth).toBeCloseTo(66931.42, 10)
    expect(p.rows[0].age).toBe(32)
    expect(p.lifestyles[0].crossing).not.toBeNull()
  })
})

describe('buildFacts', () => {
  const rows = [
    { date: '2026-01-05', amount: 3000, type: 'income' },
    { date: '2026-01-09', amount: -1200, type: 'expense' },
    { date: '2026-01-20', amount: -800, type: 'expense' },
    { date: '2026-02-05', amount: 3400, type: 'income' },
    { date: '2026-02-11', amount: -2000, type: 'expense' },
  ]

  it('totals the account balances', () => {
    const facts = buildFacts({
      accountBalances: [1000, 2500.5, -300],
      cashflow: [],
      currentAge: null,
    })
    expect(facts.netWorth).toBeCloseTo(3200.5, 6)
  })

  it('reports no net worth at all rather than zero when there are no accounts', () => {
    // Zero would read as "you have nothing"; null reads as "we do not know", which is what
    // derivation needs in order to leave the field for the user.
    expect(buildFacts({ accountBalances: [], cashflow: [], currentAge: null }).netWorth).toBeNull()
  })

  it('averages over the months that had activity, not the length of the window', () => {
    const facts = buildFacts({ accountBalances: [], cashflow: rows, currentAge: null })
    expect(facts.monthsObserved).toBe(2)
    expect(facts.monthlyIncome).toBeCloseTo(3200, 6)
    expect(facts.monthlyExpenses).toBeCloseTo(2000, 6)
  })

  it('reads expenses by size, whichever sign the import used', () => {
    const positive = buildFacts({
      accountBalances: [],
      cashflow: [{ date: '2026-01-09', amount: 1200, type: 'expense' }],
      currentAge: null,
    })
    const negative = buildFacts({
      accountBalances: [],
      cashflow: [{ date: '2026-01-09', amount: -1200, type: 'expense' }],
      currentAge: null,
    })
    expect(positive.monthlyExpenses).toBe(negative.monthlyExpenses)
  })

  it('ignores rows that are neither income nor expense', () => {
    const facts = buildFacts({
      accountBalances: [],
      cashflow: [
        ...rows,
        { date: '2026-03-01', amount: 500, type: 'transfer' },
        { date: '2026-04-01', amount: 500, type: '' },
      ],
      currentAge: null,
    })
    expect(facts.monthsObserved).toBe(2)
  })

  it('skips rows with an unusable date or amount', () => {
    const facts = buildFacts({
      accountBalances: [],
      cashflow: [
        { date: '2026-01-05', amount: 3000, type: 'income' },
        { date: '2026', amount: 3000, type: 'income' },
        { date: '2026-02-05', amount: NaN, type: 'income' },
      ],
      currentAge: null,
    })
    expect(facts.monthsObserved).toBe(1)
    expect(facts.monthlyIncome).toBeCloseTo(3000, 6)
  })

  it('reports nothing observed when there is no history', () => {
    const facts = buildFacts({ accountBalances: [100], cashflow: [], currentAge: 40 })
    expect(facts.monthlyIncome).toBeNull()
    expect(facts.monthlyExpenses).toBeNull()
    expect(facts.monthsObserved).toBe(0)
    expect(facts.currentAge).toBe(40)
  })

  it('feeds derivation directly', () => {
    const facts = buildFacts({
      accountBalances: [66931.42],
      cashflow: [
        ...rows,
        { date: '2026-03-05', amount: 3200, type: 'income' },
        { date: '2026-03-09', amount: -2100, type: 'expense' },
      ],
      currentAge: 32,
    })
    const { settings, missing } = deriveSettings(normalizeSettings({}), facts, '2026-04')
    expect(settings.netWorth).toBeCloseTo(66931.42, 6)
    expect(settings.birthMonth).toBe('1994-04')
    expect(missing).toEqual([])
  })
})

describe('monthOf', () => {
  it('formats a date as the month the projection indexes by', () => {
    expect(monthOf(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01')
    expect(monthOf(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12')
  })
})

/**
 * Every number here is bound for an `<input type="number">` with a `step`, and HTML5 marks
 * a value that is not a whole multiple of that step invalid — which blocks the whole form
 * from submitting. A number nobody typed must therefore never carry float noise.
 */
describe('rounding, so the form can actually be saved', () => {
  it('rounds to two decimals and kills -0', () => {
    expect(round(7.292500000001382)).toBeCloseTo(7.29, 10)
    expect(round(2.005)).toBeCloseTo(2.01, 10)
    expect(round(-0.0001)).toBe(0)
    expect(Object.is(round(-0.0001), -0)).toBe(false)
    expect(round(1234.5678, 0)).toBe(1235)
    expect(round(Number.NaN)).toBe(0)
    expect(round(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('cleans noise already sitting in a saved settings row', () => {
    const settings = normalizeSettings({
      monthlyContribution: 7.292500000001382,
      netWorth: 12345.678901,
      annualReturnPct: 4.444444444444445,
      lifeExpectancyAge: 87.6,
      allocation: [{ label: 'Shares', weightPct: 62.5, annualReturnPct: 7.1234 }],
    })
    expect(settings.monthlyContribution).toBeCloseTo(7.29, 10)
    expect(settings.netWorth).toBeCloseTo(12345.68, 10)
    expect(settings.annualReturnPct).toBeCloseTo(4.44, 10)
    // Age and portfolio weight have integer steps, so they round the whole way.
    expect(settings.lifeExpectancyAge).toBe(88)
    expect(settings.allocation[0].weightPct).toBe(63)
    expect(settings.allocation[0].annualReturnPct).toBeCloseTo(7.12, 10)
  })

  it('rounds the averages facts are built from', () => {
    const facts = buildFacts({
      accountBalances: [1000.005, 2000.005, 0.001],
      cashflow: [
        { date: '2026-01-05', amount: 1000, type: 'income' },
        { date: '2026-02-05', amount: 1000, type: 'income' },
        { date: '2026-03-05', amount: 1000.01, type: 'income' },
        { date: '2026-01-06', amount: 300, type: 'expense' },
        { date: '2026-02-06', amount: 300, type: 'expense' },
        { date: '2026-03-06', amount: 300, type: 'expense' },
      ],
      currentAge: null,
    })
    expect(facts.monthlyIncome).toBe(1000)
    expect(facts.monthlyExpenses).toBe(300)
    expect(facts.netWorth).toBeCloseTo(3000.01, 10)
  })

  it('rounds the contribution it derives, which is a difference of two averages', () => {
    // 3382.4925 - 3375.2 is 7.292500000001382 in binary floating point. This exact number
    // is what a real profile produced, and what the form then refused to save.
    const facts: RetirementFacts = {
      netWorth: 1000,
      monthlyIncome: 3382.4925,
      monthlyExpenses: 3375.2,
      monthsObserved: 12,
      currentAge: null,
    }
    const derived = deriveSettings({ ...DEFAULT_SETTINGS }, facts, '2026-01')
    expect(derived.settings.monthlyContribution).toBeCloseTo(7.29, 10)
    const filled = derived.filled.find((f) => f.field === 'monthlyContribution')
    expect(filled?.value).toBeCloseTo(7.29, 10)
  })
})
