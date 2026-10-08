import { describe, expect, it } from 'vitest'
import { billBody } from '../billForm'

const values = {
  name: 'Electricity',
  amount: '42.50',
  due_date: '2026-08-15',
  category_id: '7',
  frequency: 'monthly',
  autopay: true,
  type: 'bill' as const,
}

describe('billBody', () => {
  it('sends the category by its id, the due date as dueDate, and the autopay value', () => {
    expect(billBody(values)).toEqual({
      name: 'Electricity',
      amount: 42.5,
      dueDate: '2026-08-15',
      category_id: 7,
      frequency: 'monthly',
      autopay: true,
      type: 'bill',
    })
  })

  it('preserves an explicit disabled Autopay value', () => {
    expect(billBody({ ...values, autopay: false, type: 'subscription' }).autopay).toBe(false)
  })

  it('sends no category as null, so an edit can clear one', () => {
    expect(billBody({ ...values, category_id: '' }).category_id).toBeNull()
  })

  it('reads a comma for the cents, and sends what it cannot read as typed, for the check to name', () => {
    expect(billBody({ ...values, amount: '12,50' }).amount).toBe(12.5)
    expect(billBody({ ...values, amount: 'twelve' }).amount).toBe('twelve')
    expect(billBody({ ...values, amount: ' ' }).amount).toBeNull()
  })
})
