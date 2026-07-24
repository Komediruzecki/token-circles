import { describe, expect, it } from 'vitest'
import { buildBillMutationPayload } from '../billForm'

describe('buildBillMutationPayload', () => {
  it('includes the Autopay value in create and update payloads', () => {
    expect(
      buildBillMutationPayload({
        name: 'Electricity',
        amount: '42.50',
        due_date: '2026-08-15',
        category: '7',
        frequency: 'monthly',
        autopay: true,
        type: 'bill',
      })
    ).toEqual({
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
    expect(
      buildBillMutationPayload({
        name: 'Hosting',
        amount: '10',
        due_date: '2026-08-20',
        category: '',
        frequency: 'monthly',
        autopay: false,
        type: 'subscription',
      }).autopay
    ).toBe(false)
  })
})
