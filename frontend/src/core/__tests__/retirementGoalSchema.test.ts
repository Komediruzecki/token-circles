/**
 * The retirement goal rules both runtimes run (shared/retirementGoalSchema.ts). The route and
 * handler tests prove each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import { refusalOf } from '../../../../shared/refusal'
import {
  checkRetirementGoalCreate,
  checkRetirementGoalEdit,
  RETIREMENT_GOAL_MESSAGES as M,
} from '../../../../shared/retirementGoalSchema'
import type { Checked } from '../../../../shared/refusal'

const refused = (checked: Checked<unknown>) => (checked.ok ? {} : checked.fields)

/** What the Retirement page sends for a goal: all eight fields, the date as target_date. */
const PAGE = {
  name: 'Retire at 60',
  target_amount: 750000,
  current_amount: 42000.5,
  target_date: '2050-01-01',
  monthly_contribution: 1200,
  expected_return_rate: 6.5,
  current_age: 38,
  retirement_age: 60,
}

const STORED = {
  id: 4,
  profile_id: 1,
  name: 'Retire at 60',
  target_amount: 750000,
  current_amount: 42000.5,
  deadline: '2050-01-01',
  notes: '',
  monthly_contribution: 1200,
  expected_return_rate: 6.5,
  current_age: 38,
  retirement_age: 60,
  created_at: '2026-01-01 09:00:00',
}

describe('a new retirement goal', () => {
  it('reads what the page sends, the date as target_date, into the columns it is stored in', () => {
    expect(checkRetirementGoalCreate({ ...PAGE, name: ' Retire at 60 ' })).toEqual({
      ok: true,
      value: {
        name: 'Retire at 60',
        target_amount: 750000,
        current_amount: 42000.5,
        deadline: '2050-01-01',
        notes: '',
        current_age: 38,
        retirement_age: 60,
        monthly_contribution: 1200,
        expected_return_rate: 6.5,
      },
    })
  })

  it('keeps a 0 % return at 0 %, where it used to be saved as 7 %', () => {
    const checked = checkRetirementGoalCreate({ ...PAGE, expected_return_rate: 0 })
    expect(checked.ok && checked.value.expected_return_rate).toBe(0)
  })

  it('reads blank amounts as zero and a blank date as none, and drops keys it does not know', () => {
    const checked = checkRetirementGoalCreate({
      ...PAGE,
      current_amount: null,
      monthly_contribution: '',
      target_date: '',
      id: 7777,
      profile_id: 2,
    })
    expect(checked).toEqual({
      ok: true,
      value: expect.objectContaining({
        current_amount: 0,
        monthly_contribution: 0,
        deadline: null,
      }),
    })
    expect(checked.ok && Object.keys(checked.value)).not.toContain('profile_id')
  })

  it('reads `deadline` before `target_date`', () => {
    const checked = checkRetirementGoalCreate({ ...PAGE, deadline: '2049-12-31' })
    expect(checked.ok && checked.value.deadline).toBe('2049-12-31')
  })

  it('needs the ages and the return it used to fill in with a guess', () => {
    const { current_age: _a, retirement_age: _b, expected_return_rate: _c, ...rest } = PAGE
    expect(refused(checkRetirementGoalCreate(rest))).toEqual({
      current_age: M.currentAge,
      retirement_age: M.retirementAge,
      expected_return_rate: M.returnRate,
    })
  })

  it('says what is wrong with the name', () => {
    expect(refused(checkRetirementGoalCreate({ ...PAGE, name: '  ' }))).toEqual({ name: M.name })
    expect(refused(checkRetirementGoalCreate({ ...PAGE, name: 'n'.repeat(101) }))).toEqual({
      name: M.nameLength,
    })
    expect(checkRetirementGoalCreate({ ...PAGE, name: 'n'.repeat(100) }).ok).toBe(true)
  })

  it('says what is wrong with the target', () => {
    const target = (target_amount: unknown) =>
      refused(checkRetirementGoalCreate({ ...PAGE, target_amount }))
    expect(target(null)).toEqual({ target_amount: M.target })
    expect(target('lots')).toEqual({ target_amount: M.targetNumber })
    expect(target(0)).toEqual({ target_amount: M.targetPositive })
    expect(target(-5)).toEqual({ target_amount: M.targetPositive })
    expect(target(10.555)).toEqual({ target_amount: M.cents })
    expect(target(1e12)).toEqual({ target_amount: M.amountMax })
    expect(target('750000.50')).toEqual({})
  })

  it('says what is wrong with the other amounts, the date and the notes', () => {
    expect(
      refused(
        checkRetirementGoalCreate({
          ...PAGE,
          current_amount: -1,
          monthly_contribution: 'some',
          target_date: '2050-02-30',
          notes: 7,
        })
      )
    ).toEqual({
      current_amount: M.current,
      monthly_contribution: M.monthly,
      deadline: M.deadline,
      notes: M.notes,
    })
    expect(refused(checkRetirementGoalCreate({ ...PAGE, current_amount: 0.001 }))).toEqual({
      current_amount: M.cents,
    })
  })

  it('takes an age in whole years from 18 to 100', () => {
    const ages = (current_age: unknown, retirement_age: unknown) =>
      refused(checkRetirementGoalCreate({ ...PAGE, current_age, retirement_age }))
    expect(ages(18, 100)).toEqual({})
    expect(ages('40', '67')).toEqual({})
    expect(ages(17, 101)).toEqual({ current_age: M.currentAge, retirement_age: M.retirementAge })
    expect(ages(38.5, 'sixty')).toEqual({
      current_age: M.currentAge,
      retirement_age: M.retirementAge,
    })
  })

  it('takes a return from 0 to 20 percent', () => {
    const rate = (expected_return_rate: unknown) =>
      refused(checkRetirementGoalCreate({ ...PAGE, expected_return_rate }))
    expect(rate(20)).toEqual({})
    expect(rate('6.25')).toEqual({})
    expect(rate('')).toEqual({ expected_return_rate: M.returnRate })
    expect(rate('high')).toEqual({ expected_return_rate: M.returnNumber })
    expect(rate(-1)).toEqual({ expected_return_rate: M.returnRange })
    expect(rate(20.5)).toEqual({ expected_return_rate: M.returnRange })
  })

  it('sums every message up for a client that cannot place them', () => {
    const checked = checkRetirementGoalCreate({})
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields).error).toBe(
      [M.name, M.target, M.currentAge, M.retirementAge, M.returnRate].join(' ')
    )
  })
})

describe('an edit of a retirement goal', () => {
  it('changes only what it sends', () => {
    expect(checkRetirementGoalEdit({ name: 'Retire at 58', retirement_age: 58 }, STORED)).toEqual({
      ok: true,
      value: { name: 'Retire at 58', retirement_age: 58 },
    })
  })

  it('writes nothing the page sends back unchanged, the amounts as text included', () => {
    expect(
      checkRetirementGoalEdit(
        { ...PAGE, current_amount: '42000.50', expected_return_rate: '6.5', current_age: '38' },
        STORED
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('moves the date, and a cleared date leaves none', () => {
    expect(checkRetirementGoalEdit({ ...PAGE, target_date: '2048-06-30' }, STORED)).toEqual({
      ok: true,
      value: { deadline: '2048-06-30' },
    })
    expect(checkRetirementGoalEdit({ ...PAGE, target_date: '' }, STORED)).toEqual({
      ok: true,
      value: { deadline: null },
    })
  })

  it('changes a return to 0 % as 0 %', () => {
    expect(checkRetirementGoalEdit({ ...PAGE, expected_return_rate: 0 }, STORED)).toEqual({
      ok: true,
      value: { expected_return_rate: 0 },
    })
  })

  it('leaves alone what an older version stored, while it is sent back as it was', () => {
    const old = {
      ...STORED,
      name: 'n'.repeat(120),
      target_amount: 0,
      current_age: 0,
      retirement_age: null,
      expected_return_rate: 35,
      deadline: null,
    }
    const back = {
      ...PAGE,
      name: 'n'.repeat(120),
      target_amount: 0,
      current_age: 0,
      retirement_age: null,
      expected_return_rate: 35,
      target_date: '',
    }
    expect(checkRetirementGoalEdit({ ...back, current_amount: 50000 }, old)).toEqual({
      ok: true,
      value: { current_amount: 50000 },
    })
    expect(refused(checkRetirementGoalEdit({ ...back, retirement_age: 140 }, old))).toEqual({
      retirement_age: M.retirementAge,
    })
  })

  it('says what is wrong with what it changes', () => {
    expect(
      refused(checkRetirementGoalEdit({ ...PAGE, name: '', expected_return_rate: 25 }, STORED))
    ).toEqual({ name: M.name, expected_return_rate: M.returnRange })
  })
})
