/**
 * The retirement plan's save rules (shared/retirementPlanSchema.ts), which both runtimes run on
 * `PUT /api/retirement/settings` and the planner runs before it sends. The route and handler tests
 * prove each runtime uses them; these pin the rules and the words themselves.
 *
 * A save used to go through `normalizeSettings`, which moved a number outside its range to the
 * nearest end, dropped a lifestyle costing nothing, rounded a third decimal away and replaced
 * anything it could not read with the default, without a word.
 */
import { describe, expect, it } from 'vitest'
import { refusalOf } from '../../../../shared/refusal'
import {
  checkRetirementPlan,
  RETIREMENT_PLAN_MESSAGES as M,
} from '../../../../shared/retirementPlanSchema'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../../../shared/retirementSettings'
import type { Checked } from '../../../../shared/refusal'

const refused = (checked: Checked<unknown>) => (checked.ok ? {} : checked.fields)
const plan = (fields: Record<string, unknown>) => ({ ...DEFAULT_SETTINGS, ...fields })

describe('a plan that fits', () => {
  it('is stored as it was sent', () => {
    expect(checkRetirementPlan(DEFAULT_SETTINGS)).toEqual({ ok: true, value: DEFAULT_SETTINGS })
  })

  it('takes the defaults for what it leaves out, as it always has', () => {
    expect(checkRetirementPlan({})).toEqual({ ok: true, value: normalizeSettings({}) })
    expect(checkRetirementPlan({ netWorth: null, birthMonth: '' })).toEqual({
      ok: true,
      value: normalizeSettings({}),
    })
  })

  it('orders the pay steps and spending periods by month, and keeps every value', () => {
    const checked = checkRetirementPlan(
      plan({
        mode: 'advanced',
        incomeSteps: [
          { fromMonth: '2030-01', monthlyAmount: 4000 },
          { fromMonth: '2028-06', monthlyAmount: '3500.50' },
        ],
        expensePeriods: [{ fromMonth: '2027-01', toMonth: '2027-01', monthlyAmount: -250 }],
      })
    )
    expect(checked.ok && checked.value.incomeSteps).toEqual([
      { fromMonth: '2028-06', monthlyAmount: 3500.5 },
      { fromMonth: '2030-01', monthlyAmount: 4000 },
    ])
    expect(checked.ok && checked.value.expensePeriods).toEqual([
      { fromMonth: '2027-01', toMonth: '2027-01', monthlyAmount: -250 },
    ])
  })

  it('passes a stored plan read back and sent unchanged, whatever an older version stored', () => {
    for (const stored of [
      {},
      { lifeExpectancyAge: 300, annualInflationPct: -4, safeWithdrawalRatePct: 0 },
      { netWorth: 'lots', annualReturnPct: 7.256, mode: 'expert', adjustForInflation: 'yes' },
      {
        lifestyles: [
          { label: '', monthlySpendToday: 0 },
          { id: 'x' },
          { id: 'x', label: 'B', monthlySpendToday: 10.555 },
        ],
        allocation: [{ label: '', weightPct: 33.3, annualReturnPct: 90 }],
        expensePeriods: [
          { fromMonth: '2027-05', toMonth: '2027-01', monthlyAmount: 5 },
          { fromMonth: 'soon' },
        ],
        incomeSteps: [{ fromMonth: '2026-01', monthlyAmount: -10 }],
      },
    ]) {
      const read = normalizeSettings(stored)
      expect(checkRetirementPlan(read)).toEqual({ ok: true, value: read })
    }
  })
})

describe('a plan with a value that does not fit', () => {
  it('says what is wrong with each number, where it used to move it into range', () => {
    expect(
      refused(
        checkRetirementPlan(
          plan({
            lifeExpectancyAge: 30,
            netWorth: 1e13,
            monthlyContribution: 'lots',
            monthlyIncome: -5,
            monthlyExpenses: -1,
            annualRaisePct: 101,
            annualReturnPct: 60,
            annualInflationPct: -1,
            safeWithdrawalRatePct: 0,
          })
        )
      )
    ).toEqual({
      lifeExpectancyAge: M.lifeExpectancyAge,
      netWorth: M.netWorth,
      monthlyContribution: M.monthlyContribution,
      monthlyIncome: M.monthlyIncome,
      monthlyExpenses: M.monthlyExpenses,
      annualRaisePct: M.annualRaisePct,
      annualReturnPct: M.annualReturnPct,
      annualInflationPct: M.annualInflationPct,
      safeWithdrawalRatePct: M.safeWithdrawalRatePct,
    })
  })

  it('refuses a third decimal, a part age and a blank number, where they were rounded or zeroed', () => {
    expect(
      refused(
        checkRetirementPlan(
          plan({
            netWorth: 1000.555,
            annualInflationPct: 2.125,
            lifeExpectancyAge: 85.5,
            safeWithdrawalRatePct: '',
          })
        )
      )
    ).toEqual({
      netWorth: M.cents,
      annualInflationPct: M.cents,
      lifeExpectancyAge: M.lifeExpectancyAge,
      safeWithdrawalRatePct: M.safeWithdrawalRatePct,
    })
    expect(
      checkRetirementPlan(plan({ safeWithdrawalRatePct: 20, lifeExpectancyAge: '120' })).ok
    ).toBe(true)
    expect(refused(checkRetirementPlan(plan({ safeWithdrawalRatePct: 20.01 })))).toEqual({
      safeWithdrawalRatePct: M.safeWithdrawalRatePct,
    })
  })

  it('refuses a mode, a switch or a birth month it cannot read', () => {
    expect(
      refused(
        checkRetirementPlan(
          plan({
            mode: 'expert',
            adjustForInflation: 'yes',
            useAllocation: 1,
            birthMonth: '1990-13',
          })
        )
      )
    ).toEqual({
      mode: M.mode,
      adjustForInflation: M.flag,
      useAllocation: M.flag,
      birthMonth: M.birthMonth,
    })
    expect(
      checkRetirementPlan(plan({ adjustForInflation: 'false', birthMonth: '1986-04' })).ok
    ).toBe(true)
  })

  it('marks a pay step and a spending period at the field of their row', () => {
    expect(
      refused(
        checkRetirementPlan(
          plan({
            incomeSteps: [
              { fromMonth: '2030-01', monthlyAmount: 4000 },
              { fromMonth: '', monthlyAmount: -1 },
            ],
            expensePeriods: [
              { fromMonth: '2027-05', toMonth: '2027-01', monthlyAmount: 'x' },
              { fromMonth: '2027-05', toMonth: '', monthlyAmount: -300 },
            ],
          })
        )
      )
    ).toEqual({
      'incomeSteps.1.fromMonth': M.stepMonth,
      'incomeSteps.1.monthlyAmount': M.stepAmount,
      'expensePeriods.0.toMonth': M.periodEnd,
      'expensePeriods.0.monthlyAmount': M.periodAmount,
    })
  })

  it('marks an asset and a lifestyle at the field of their row', () => {
    expect(
      refused(
        checkRetirementPlan(
          plan({
            allocation: [
              { label: 'Equity', weightPct: 70, annualReturnPct: 8 },
              { label: ' ', weightPct: 30.5, annualReturnPct: 70, erodesWithInflation: 'no' },
            ],
            lifestyles: [
              { id: 'a', label: 'Modest', monthlySpendToday: 1500 },
              { id: 'b', label: '', monthlySpendToday: 0 },
            ],
          })
        )
      )
    ).toEqual({
      'allocation.1.label': M.assetName,
      'allocation.1.weightPct': M.assetWeight,
      'allocation.1.annualReturnPct': M.assetReturn,
      'allocation.1.erodesWithInflation': M.flag,
      'lifestyles.1.label': M.lifestyleName,
      'lifestyles.1.monthlySpendToday': M.lifestyleSpend,
    })
  })

  it('says a list that is not one is not', () => {
    expect(refused(checkRetirementPlan(plan({ lifestyles: 'Modest', incomeSteps: {} })))).toEqual({
      lifestyles: M.list,
      incomeSteps: M.list,
    })
  })

  it('sums every message up for a client that cannot place them', () => {
    const checked = checkRetirementPlan(plan({ lifeExpectancyAge: 30, annualInflationPct: -1 }))
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields).error).toBe(`${M.lifeExpectancyAge} ${M.annualInflationPct}`)
  })
})
