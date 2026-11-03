/**
 * An entry without a category, as every count of them reads it (shared/uncategorised.ts): circle
 * 1, Getting started and Your next step, the Transactions filter they link to, and the day-7 mail
 * (worker/src/weekOne.ts, in SQL; worker/test/week-one-mails.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { isUncategorised } from '../../../../shared/uncategorised'

const has = (id: number) => id === 7

describe('an entry without a category', () => {
  it('is one with none, income as well as spending', () => {
    expect(isUncategorised({ type: 'expense', category_id: null }, has)).toBe(true)
    expect(isUncategorised({ type: 'income', category_id: null }, has)).toBe(true)
    expect(isUncategorised({ type: 'expense' }, has)).toBe(true)
  })

  it('is one filed under a category the profile no longer has', () => {
    // Before #384 (July 2026), deleting a category left its entries pointing at it.
    expect(isUncategorised({ type: 'expense', category_id: 42 }, has)).toBe(true)
  })

  it('is not one filed under a category the profile has', () => {
    expect(isUncategorised({ type: 'expense', category_id: 7 }, has)).toBe(false)
  })

  it('is never a transfer, which takes no category', () => {
    expect(isUncategorised({ type: 'transfer', category_id: null }, has)).toBe(false)
    expect(isUncategorised({ type: 'transfer', category_id: 42 }, has)).toBe(false)
  })
})
