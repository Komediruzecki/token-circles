/**
 * The savings goal rules both runtimes run (shared/goalSchema.ts). The route and handler tests
 * prove each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  addToSaved,
  checkContribution,
  checkGoalCreate,
  checkGoalEdit,
  GOAL_MESSAGES as M,
} from '../../../../shared/goalSchema'
import { refusalOf } from '../../../../shared/refusal'
import type { Checked } from '../../../../shared/refusal'

const refused = (checked: Checked<unknown>) => (checked.ok ? {} : checked.fields)
const DEFAULTS = { today: '2026-10-08' }

describe('a new goal', () => {
  it('needs a name and a target; the rest take their defaults', () => {
    expect(checkGoalCreate({ name: 'Holiday', target_amount: 1200 }, DEFAULTS)).toEqual({
      ok: true,
      value: {
        name: 'Holiday',
        target_amount: 1200,
        current_amount: 0,
        deadline: null,
        notes: '',
        category_id: null,
        monthly_contribution: 0,
        tracking_start_date: '2026-10-08',
      },
    })
  })

  it('reads what the Goals form sends: the date as target_date, a blank monthly amount as null', () => {
    expect(
      checkGoalCreate(
        {
          name: ' Holiday ',
          target_amount: '1200.50',
          target_date: '2027-06-30',
          monthly_contribution: null,
          category_id: '9',
          tracking_start_date: '2026-09-01',
          spent: 3,
        },
        DEFAULTS
      )
    ).toEqual({
      ok: true,
      value: {
        name: 'Holiday',
        target_amount: 1200.5,
        current_amount: 0,
        deadline: '2027-06-30',
        notes: '',
        category_id: 9,
        monthly_contribution: 0,
        tracking_start_date: '2026-09-01',
      },
    })
  })

  it('reads `deadline` before `target_date`', () => {
    const checked = checkGoalCreate(
      { name: 'Car', target_amount: 5, deadline: '2027-01-01', target_date: '2028-01-01' },
      DEFAULTS
    )
    expect(checked.ok && checked.value.deadline).toBe('2027-01-01')
  })

  it('says what is wrong with the name', () => {
    expect(refused(checkGoalCreate({ name: '  ', target_amount: 5 }, DEFAULTS))).toEqual({
      name: M.name,
    })
    expect(refused(checkGoalCreate({ name: 'x'.repeat(101), target_amount: 5 }, DEFAULTS))).toEqual(
      { name: M.nameLength }
    )
  })

  it('says what is wrong with the target', () => {
    const target = (value: unknown) =>
      refused(checkGoalCreate({ name: 'Car', target_amount: value }, DEFAULTS)).target_amount
    expect(target(undefined)).toBe(M.target)
    expect(target('')).toBe(M.target)
    expect(target('lots')).toBe(M.targetNumber)
    expect(target(0)).toBe(M.targetPositive)
    expect(target(-100)).toBe(M.targetPositive)
    expect(target(99.999)).toBe(M.cents)
    expect(target(1e12)).toBe(M.amountMax)
  })

  it('says what is wrong with the other amounts, the dates, the category and the notes', () => {
    expect(
      refused(
        checkGoalCreate(
          {
            name: 'Car',
            target_amount: 5,
            current_amount: -1,
            monthly_contribution: 'some',
            deadline: '2026-02-30',
            tracking_start_date: 'today',
            category_id: 'food',
            notes: 12,
          },
          DEFAULTS
        )
      )
    ).toEqual({
      current_amount: M.current,
      monthly_contribution: M.monthly,
      deadline: M.deadline,
      tracking_start_date: M.trackingStart,
      category_id: M.category,
      notes: M.notes,
    })
  })

  it('sums every message up for a client that cannot place them', () => {
    expect(refusalOf(refused(checkGoalCreate({}, DEFAULTS)))).toEqual({
      error: `${M.name} ${M.target}`,
      fields: { name: M.name, target_amount: M.target },
    })
  })
})

describe('an edit of a goal', () => {
  const STORED = {
    id: 3,
    name: 'Car',
    target_amount: 5000,
    current_amount: 1000,
    deadline: '2030-06-30',
    notes: '',
    category_id: null,
    monthly_contribution: 0,
    tracking_start_date: null,
  }

  it('changes only what it sends', () => {
    expect(checkGoalEdit({ name: 'New car' }, STORED)).toEqual({
      ok: true,
      value: { name: 'New car' },
    })
  })

  it('writes nothing the Goals form sends back unchanged', () => {
    expect(
      checkGoalEdit(
        {
          name: 'Car',
          target_amount: 5000,
          target_date: '2030-06-30',
          monthly_contribution: null,
          category_id: null,
        },
        STORED
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('reads a local row that keeps its date as target_date', () => {
    const local = { ...STORED, deadline: undefined, target_date: '2030-06-30' }
    expect(checkGoalEdit({ target_date: '2030-06-30' }, local)).toEqual({ ok: true, value: {} })
    expect(checkGoalEdit({ target_date: '' }, local)).toEqual({
      ok: true,
      value: { deadline: null },
    })
  })

  it('leaves alone what an older version stored, while it is sent back as it was', () => {
    const old = { ...STORED, target_amount: 0, name: 'n'.repeat(120) }
    expect(
      checkGoalEdit({ name: 'n'.repeat(120), target_amount: 0, target_date: '2031-01-01' }, old)
    ).toEqual({ ok: true, value: { deadline: '2031-01-01' } })
    expect(refused(checkGoalEdit({ target_amount: -1 }, old))).toEqual({
      target_amount: M.targetPositive,
    })
  })

  it('reads a blank monthly amount as zero and a blank tracking date as none', () => {
    expect(
      checkGoalEdit(
        { monthly_contribution: '', tracking_start_date: '' },
        { ...STORED, monthly_contribution: 50, tracking_start_date: '2026-01-01' }
      )
    ).toEqual({ ok: true, value: { monthly_contribution: 0, tracking_start_date: null } })
  })
})

describe('a contribution', () => {
  it('is an amount more than zero, at most two decimal places', () => {
    expect(checkContribution({ amount: '50.25' })).toEqual({ ok: true, value: { amount: 50.25 } })
    const amount = (value: unknown) => refused(checkContribution({ amount: value })).amount
    expect(amount(undefined)).toBe(M.contribution)
    expect(amount('fifty')).toBe(M.contributionNumber)
    expect(amount(0)).toBe(M.contributionPositive)
    expect(amount(-5)).toBe(M.contributionPositive)
    expect(amount(1.005)).toBe(M.cents)
  })

  it('adds to what is saved, to the cent', () => {
    expect(addToSaved(100, 50)).toBe(150)
    expect(String(addToSaved(0.1, 0.2))).toBe('0.3')
    // A local row an older version stored as text, and one with nothing saved.
    expect(addToSaved('100', 50)).toBe(150)
    expect(addToSaved(null, 50)).toBe(50)
  })
})
