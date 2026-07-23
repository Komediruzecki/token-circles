import { describe, expect, it } from 'vitest'
import { validateBody } from '../validation'

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

  it('rejects missing required fields', async () => {
    const result = validateBody('POST', '/api/transactions', {
      type: 'expense',
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
    const data = await result!.json()
    expect(data.error).toBe('Validation failed')
    expect(data.details.length).toBeGreaterThan(0)
  })

  it('rejects invalid transaction type', () => {
    const result = validateBody('POST', '/api/transactions', {
      type: 'invalid',
      amount: 100,
      description: 'Test',
      date: '2026-05-13',
      category_id: 1,
    })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(400)
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
