/**
 * Bill request-validation contract (serverless router).
 *
 * Regressions pinned here:
 * - The Bills form (and the live worker API) send camelCase `dueDate`; the schema only
 *   accepted snake_case `due_date`, so every "Add Bill" in demo/serverless mode 400'd.
 * - `frequency: 'yearly'` (offered by the form, supported by the summary math) was
 *   rejected by the enum.
 */
import { describe, expect, it } from 'vitest'
import { billCreateSchema, billUpdateSchema } from '../validation'

const base = { name: 'Prime Annual Plan', amount: 120 }

describe('billCreateSchema', () => {
  it('accepts the form payload shape (camelCase dueDate)', () => {
    const r = billCreateSchema.safeParse({
      ...base,
      dueDate: '2026-07-15',
      frequency: 'monthly',
      type: 'subscription',
    })
    expect(r.success).toBe(true)
  })

  it('accepts the internal shape (snake_case due_date)', () => {
    const r = billCreateSchema.safeParse({ ...base, due_date: '2026-07-15' })
    expect(r.success).toBe(true)
  })

  it('rejects when no due date is provided in either form', () => {
    const r = billCreateSchema.safeParse({ ...base, frequency: 'monthly' })
    expect(r.success).toBe(false)
  })

  it.each(['daily', 'weekly', 'biweekly', 'monthly', 'yearly'])(
    'accepts frequency %s',
    (frequency) => {
      const r = billCreateSchema.safeParse({ ...base, dueDate: '2026-07-15', frequency })
      expect(r.success).toBe(true)
    }
  )

  it('still rejects malformed dates and unknown frequencies', () => {
    expect(billCreateSchema.safeParse({ ...base, dueDate: '15.07.2026' }).success).toBe(false)
    expect(
      billCreateSchema.safeParse({ ...base, dueDate: '2026-07-15', frequency: 'fortnight' }).success
    ).toBe(false)
  })
})

describe('billUpdateSchema', () => {
  it('accepts partial updates without any due date', () => {
    expect(billUpdateSchema.safeParse({ is_active: undefined, amount: 9.99 }).success).toBe(true)
  })

  it('accepts a yearly frequency change', () => {
    expect(billUpdateSchema.safeParse({ frequency: 'yearly' }).success).toBe(true)
  })
})
