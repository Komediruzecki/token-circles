import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { BILL_MESSAGES } from '../../../../shared/billSchema'
import { BUDGET_MESSAGES } from '../../../../shared/budgetSchema'
import { GOAL_MESSAGES } from '../../../../shared/goalSchema'
import { LOAN_MESSAGES } from '../../../../shared/loanSchema'
import { TRANSACTION_MESSAGES } from '../../../../shared/transactionSchema'
import { validateBody, zodCheck } from '../validation'

describe('validation - validateBody', () => {
  it('passes valid transaction create body', () => {
    const result = validateBody('POST', '/api/transactions', {
      type: 'expense',
      amount: 42.5,
      description: 'Coffee',
      date: '2026-05-13',
      category_id: 1,
    })
    expect(result).toBeNull()
  })

  it('answers a transaction body in the Worker’s rules and words (shared/transactionSchema.ts)', async () => {
    // Only the amount: a blank description, date or category is the Worker's default, not a
    // refusal, as an import or an API client sends them.
    const result = validateBody('POST', '/api/transactions', {
      type: 'expense',
      currency: 'euro',
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
    // The Worker's answer: a sentence per field, and the summary that joins them. No zod text.
    const data = await result!.json()
    expect(data).toEqual({
      error: `${TRANSACTION_MESSAGES.amount} ${TRANSACTION_MESSAGES.currency}`,
      fields: { amount: TRANSACTION_MESSAGES.amount, currency: TRANSACTION_MESSAGES.currency },
    })
  })

  it('rejects invalid transaction type', async () => {
    const result = validateBody('POST', '/api/transactions', {
      type: 'invalid',
      amount: 100,
      description: 'Test',
      date: '2026-05-13',
      category_id: 1,
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
    expect((await result!.json()).fields).toEqual({ type: TRANSACTION_MESSAGES.type })
  })

  it('has no rule for a transaction edit: its handler checks it against the stored row', () => {
    // What the form sends back from a row an import stored: refused on a create, kept on an edit.
    expect(
      validateBody('PUT', '/api/transactions/7', { date: '2026-1-5', amount: 12.345 })
    ).toBeNull()
  })

  it('returns null for routes without schema', () => {
    const result = validateBody('GET', '/api/health', null)
    expect(result).toBeNull()
  })

  it('returns null for GET requests (no body)', () => {
    const result = validateBody('GET', '/api/transactions', null)
    expect(result).toBeNull()
  })

  it('validates category create body', () => {
    const result = validateBody('POST', '/api/categories', {
      name: 'Food',
      type: 'expense',
      color: '#FF0000',
    })
    expect(result).toBeNull()
  })

  it('rejects invalid category color format', () => {
    const result = validateBody('POST', '/api/categories', {
      name: 'Food',
      type: 'expense',
      color: 'red',
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
  })

  it('validates budget create body', () => {
    const result = validateBody('POST', '/api/budgets', {
      category_id: 1,
      amount: 500,
      period: 'monthly',
      start_date: '2026-05-01',
    })
    expect(result).toBeNull()
  })

  it('validates account create body', () => {
    const result = validateBody('POST', '/api/accounts', {
      name: 'Checking',
      type: 'giro',
    })
    expect(result).toBeNull()
  })

  it('accepts any three-letter ISO-style account currency', () => {
    expect(
      validateBody('POST', '/api/accounts', {
        name: 'Swiss account',
        type: 'giro',
        currency: 'CHF',
      })
    ).toBeNull()
  })

  it('rejects a malformed account currency', () => {
    expect(
      validateBody('POST', '/api/accounts', {
        name: 'Broken account',
        type: 'giro',
        currency: 'EURO',
      })
    ).not.toBeNull()
  })

  it('answers a budget, a bill, a savings goal and a loan in the Worker’s rules and words (shared/)', async () => {
    const fieldsOf = async (path: string, body: unknown) =>
      (await validateBody('POST', path, body)!.json()).fields
    expect(await fieldsOf('/api/budgets', { category_id: 1, amount: -5 })).toEqual({
      amount: BUDGET_MESSAGES.amountNegative,
    })
    expect(await fieldsOf('/api/bills', { name: 'Rent', amount: 900 })).toEqual({
      due_date: BILL_MESSAGES.dueDate,
    })
    expect(await fieldsOf('/api/savings-goals', { name: 'Car', target_amount: 0 })).toEqual({
      target_amount: GOAL_MESSAGES.targetPositive,
    })
    const loan = { name: 'Car', principal: 15000, term_months: 60, start_date: '2026-01-15' }
    expect(await fieldsOf('/api/loans', loan)).toEqual({ interest_rate: LOAN_MESSAGES.rate })
  })

  it('validates bill create body', () => {
    const result = validateBody('POST', '/api/bills', {
      name: 'Netflix',
      amount: 14.99,
      due_date: '2026-06-01',
    })
    expect(result).toBeNull()
  })

  it('validates loan create body', () => {
    const result = validateBody('POST', '/api/loans', {
      name: 'Mortgage',
      principal: 200000,
      interest_rate: 3.5,
      start_date: '2024-01-15',
      term_months: 360,
    })
    expect(result).toBeNull()
  })

  it('validates goal create body', () => {
    const result = validateBody('POST', '/api/savings-goals', {
      name: 'Vacation',
      target_amount: 5000,
    })
    expect(result).toBeNull()
  })

  it('validates recurring create body', () => {
    const result = validateBody('POST', '/api/recurring', {
      description: 'Rent',
      amount: 1200,
      type: 'expense',
      frequency: 'monthly',
      next_date: '2026-06-01',
    })
    expect(result).toBeNull()
  })

  it('checks a new recurring rule by the shared rules, and leaves an edit to its handler', async () => {
    expect(
      await fieldsOf('/api/recurring', {
        description: 'Rent',
        amount: 900,
        frequency: 'fortnightly',
        next_date: '2026-06-01',
        category_id: 0,
      })
    ).toEqual({
      frequency: 'Choose Daily, Weekly, Monthly or Yearly.',
      category_id: 'Choose a category from the list, or leave it blank.',
    })
    // An edit that sends one field is checked against the stored rule (checkRecurringEdit).
    expect(validateBody('PUT', '/api/recurring/4', { notes: 'Flat 5' })).toBeNull()
  })

  it('validates tag create body', () => {
    const result = validateBody('POST', '/api/tags', {
      name: 'groceries',
    })
    expect(result).toBeNull()
  })

  it('rejects tag with invalid color', () => {
    const result = validateBody('POST', '/api/tags', {
      name: 'groceries',
      color: 'blue',
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
  })

  it('validates portfolio holding create body', () => {
    const result = validateBody('POST', '/api/portfolio/holdings', {
      ticker: 'AAPL',
      shares: 10,
      purchase_price: 150,
      purchase_date: '2024-01-15',
    })
    expect(result).toBeNull()
  })

  it('validates settings update body with passthrough', () => {
    const result = validateBody('PUT', '/api/settings', {
      local_currency: 'USD',
      unknown_key: 'ignored',
    })
    expect(result).toBeNull()
  })

  it('rejects settings with invalid theme value', () => {
    const result = validateBody('PUT', '/api/settings', {
      theme: 'blue',
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
  })

  it('validates profile create body', () => {
    const result = validateBody('POST', '/api/profiles', {
      name: 'My Profile',
    })
    expect(result).toBeNull()
  })

  it('rejects profile with empty name', () => {
    const result = validateBody('POST', '/api/profiles', {
      name: '',
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
  })

  it('returns null for unmapped POST route with numeric ID', () => {
    const result = validateBody('POST', '/api/calculator/compound-interest', { principal: 1000 })
    expect(result).toBeNull()
  })

  it('strips numeric IDs to find matching schema', () => {
    const result = validateBody('POST', '/api/transactions/123', {
      type: 'expense',
      amount: 50,
      description: 'Test',
      date: '2026-05-13',
      category_id: 1,
    })
    // URL /api/transactions/123 should match schema key 'POST:/api/transactions'
    expect(result).toBeNull()
  })
})

/** The field messages of a POST the body checks refuse. */
async function fieldsOf(path: string, body: unknown): Promise<Record<string, string>> {
  const result = validateBody('POST', path, body)
  expect(result?.status).toBe(400)
  return (await result!.json()).fields
}

describe('validation - the shared checks', () => {
  it('checks a housing expense at /api/housing, the path the Housing page posts to', async () => {
    expect(await fieldsOf('/api/housing', { property_name: '', monthly_amount: 0 })).toEqual({
      property_name: 'Name the property or the payment.',
      monthly_amount: 'Enter an amount more than zero.',
    })
    expect(
      validateBody('POST', '/api/housing', { property_name: 'Flat', monthly_amount: 850.5 })
    ).toBeNull()
    // The path the old zod schema was registered under is called by nothing.
    expect(validateBody('POST', '/api/housings', {})).toBeNull()
  })

  it('checks a new holding, and leaves an edit to its handler', async () => {
    expect(
      await fieldsOf('/api/portfolio/holdings', {
        ticker: 'SAMPL',
        shares: 10,
        purchase_price: 100,
        purchase_date: '1 May',
      })
    ).toEqual({ purchase_date: 'Enter a real date, written like 2026-02-10.' })
    // An edit that sends one field is checked against the stored holding (checkHoldingEdit).
    expect(validateBody('PUT', '/api/portfolio/holdings/4', { notes: 'Paused' })).toBeNull()
  })
})

describe('validation - a zod refusal in plain words', () => {
  // No write local-first serves is checked by a zod schema now: counterparties, the last, are only
  // read here, and the router answers a write to them 405 before any check. A zod schema put back
  // in the map is still answered in plain words, never zod's.
  const counterparty = z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['individual', 'business']).optional(),
  })

  it("says which field to check, not zod's words for what is wrong with it", () => {
    expect(zodCheck(counterparty, { name: '', type: 'company' })).toEqual({
      ok: false,
      fields: { name: 'Check the name.', type: 'Check the type.' },
    })
  })

  it("passes on a refine's own message, which is written for people", () => {
    const trip = z
      .object({ from: z.string(), to: z.string() })
      .refine((t) => t.to >= t.from, { message: 'End the trip after it starts.', path: ['to'] })
    expect(zodCheck(trip, { from: '2026-03-02', to: '2026-03-01' })).toEqual({
      ok: false,
      fields: { to: 'End the trip after it starts.' },
    })
  })

  it('names no field for a body that is not an object, for the summary to cover', () => {
    expect(zodCheck(counterparty, 'not json')).toEqual({ ok: false, fields: {} })
  })

  it('leaves a write to counterparties to the router, which refuses it before any check', () => {
    expect(validateBody('POST', '/api/counterparties', { name: '' })).toBeNull()
    expect(validateBody('PUT', '/api/counterparties/3', { name: '' })).toBeNull()
  })

  it('names a too-long name, and a wrong kind of value, by the field', async () => {
    expect(await fieldsOf('/api/tags', { name: 'x'.repeat(51), color: 5 })).toEqual({
      name: 'Keep the name to 50 characters or fewer.',
      color: "That color can't be used. Pick another one.",
    })
  })
})
