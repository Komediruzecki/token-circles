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
})
