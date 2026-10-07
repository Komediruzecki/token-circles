/**
 * The category rules both runtimes run (shared/categorySchema.ts), and the refusal answer they
 * share (shared/refusal.ts). The route and handler tests prove each runtime uses them; these pin
 * the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_MESSAGES,
  categoryNameTaken,
  checkCategoryCreate,
  checkCategoryUpdate,
  clashingCategoryName,
  sameCategoryName,
} from '../../../../shared/categorySchema'
import {
  CHECK_THE_DETAILS,
  fieldErrorsOf,
  refusalOf,
  summarizeFields,
} from '../../../../shared/refusal'

describe('a new category', () => {
  it('needs only a name; every other field takes its default', () => {
    expect(checkCategoryCreate({ name: '  Coffee ' })).toEqual({
      ok: true,
      value: {
        name: 'Coffee',
        type: 'expense',
        icon: 'tag',
        color: '#6b7280',
        parent_id: null,
        tax_deductible: false,
      },
    })
  })

  it('treats blank optional fields as left out', () => {
    const checked = checkCategoryCreate({
      name: 'Coffee',
      type: ' ',
      icon: null,
      color: '',
      parent_id: '',
      tax_deductible: null,
    })
    expect(checked).toEqual(checkCategoryCreate({ name: 'Coffee' }))
  })

  it('keeps what it is given, tidied, and drops keys that are not category fields', () => {
    const checked = checkCategoryCreate({
      name: 'Salary',
      type: ' Income ',
      icon: ' briefcase ',
      color: '#22C55E',
      parentId: '7',
      tax_deductible: 1,
      id: 99,
      profile_id: 3,
    })
    expect(checked).toEqual({
      ok: true,
      value: {
        name: 'Salary',
        type: 'income',
        icon: 'briefcase',
        color: '#22C55E',
        parent_id: 7,
        tax_deductible: true,
      },
    })
  })

  it('accepts every type the app can read, including the two the forms do not offer', () => {
    for (const type of ['expense', 'income', 'transfer', 'account']) {
      expect(checkCategoryCreate({ name: 'X', type }).ok).toBe(true)
    }
  })

  it('names each field that is wrong, with the words a person reads', () => {
    expect(
      checkCategoryCreate({
        name: 'x'.repeat(101),
        type: 'savings',
        icon: 5,
        color: 'red',
        parent_id: -1,
        tax_deductible: 'maybe',
      })
    ).toEqual({
      ok: false,
      fields: {
        name: 'Keep the name to 100 characters or fewer.',
        type: 'Choose Expense or Income.',
        icon: 'Type an icon name, like utensils, or leave it blank.',
        color: "That color can't be used. Pick another one.",
        parent_id: 'Choose a parent category from the list, or leave it empty.',
        tax_deductible: 'Set tax deductible to true or false.',
      },
    })
  })

  it('refuses a missing, blank or non-text name', () => {
    for (const name of [undefined, null, '', '   ', 42]) {
      expect(checkCategoryCreate({ name })).toEqual({
        ok: false,
        fields: { name: CATEGORY_MESSAGES.name },
      })
    }
  })

  it('refuses a body that is not an object at the name', () => {
    for (const body of [null, 'Coffee', ['Coffee']]) {
      expect(fieldErrorsOf(checkCategoryCreate(body))).toEqual({ name: CATEGORY_MESSAGES.name })
    }
  })

  it('allows a name of exactly 100 characters', () => {
    expect(checkCategoryCreate({ name: 'x'.repeat(100) }).ok).toBe(true)
  })
})

describe('an edit to a category', () => {
  it('checks and returns only the fields the body names', () => {
    expect(checkCategoryUpdate({ color: '#59d2a2' })).toEqual({
      ok: true,
      value: { color: '#59d2a2' },
    })
    expect(checkCategoryUpdate({})).toEqual({ ok: true, value: {} })
  })

  it('refuses a name it blanks, and a null one', () => {
    expect(fieldErrorsOf(checkCategoryUpdate({ name: ' ' }))).toEqual({
      name: CATEGORY_MESSAGES.name,
    })
    expect(fieldErrorsOf(checkCategoryUpdate({ name: null }))).toEqual({
      name: CATEGORY_MESSAGES.name,
    })
  })

  it('gives a blank icon the default, the way a cleared icon field means it', () => {
    expect(checkCategoryUpdate({ icon: null })).toEqual({ ok: true, value: { icon: 'tag' } })
    expect(checkCategoryUpdate({ icon: '' })).toEqual({ ok: true, value: { icon: 'tag' } })
  })

  it('clears the parent only when the body says so', () => {
    expect(checkCategoryUpdate({ parent_id: null })).toEqual({
      ok: true,
      value: { parent_id: null },
    })
    expect(checkCategoryUpdate({ name: 'Food' })).toEqual({ ok: true, value: { name: 'Food' } })
  })
})

describe('a duplicate name', () => {
  const rows = [
    { id: 1, name: 'Food' },
    { id: 2, name: 'Eating out' },
  ]

  it('is the same name whatever the case and the spaces around it', () => {
    expect(sameCategoryName(' food ', 'FOOD')).toBe(true)
    expect(sameCategoryName('Food', 'Foods')).toBe(false)
    expect(clashingCategoryName(rows, 'EATING OUT')).toBe('Eating out')
    expect(clashingCategoryName(rows, 'Rent')).toBeNull()
  })

  it('leaves out the category being renamed', () => {
    expect(clashingCategoryName(rows, 'food', 1)).toBeNull()
    expect(clashingCategoryName(rows, 'food', 2)).toBe('Food')
  })

  it('is refused at the name, quoting the category that already has it', () => {
    expect(categoryNameTaken('Eating out')).toEqual({
      name: 'You already have a category called "Eating out". Choose another name.',
    })
  })
})

describe('the refusal answer', () => {
  it('summarises the field messages in order, for a client that cannot place them', () => {
    const fields = { name: 'Give the category a name.', type: 'Choose Expense or Income.' }
    expect(summarizeFields(fields)).toBe('Give the category a name. Choose Expense or Income.')
    expect(refusalOf(fields)).toEqual({
      error: 'Give the category a name. Choose Expense or Income.',
      fields,
    })
  })

  it('still says something, and sends no fields, when no field is named', () => {
    expect(refusalOf({})).toEqual({ error: CHECK_THE_DETAILS })
  })

  it('words every message without an em dash, and ends each with a full stop', () => {
    const messages = [
      ...Object.values(CATEGORY_MESSAGES),
      categoryNameTaken('Food').name,
      CHECK_THE_DETAILS,
    ]
    for (const message of messages) {
      expect(message).not.toContain('—')
      expect(message).toMatch(/\.$/)
    }
  })
})
