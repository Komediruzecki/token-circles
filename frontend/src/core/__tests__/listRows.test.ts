import { describe, expect, it } from 'vitest'
import { listRows } from '../api'

/**
 * listRows normalizes list-endpoint responses across the two storage modes.
 * The server-mode /api/transactions envelope ({ rows, total }) silently broke
 * every consumer that assumed a bare array — the onboarding trigger and the
 * subscription scan both shipped with that bug while serverless tests passed.
 */
describe('listRows', () => {
  it('passes bare arrays through (serverless shape)', () => {
    expect(listRows([])).toEqual([])
    expect(listRows([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('unwraps the server paginated envelope { rows, total, limit, offset }', () => {
    expect(listRows({ rows: [], total: 0, limit: 0, offset: 0 })).toEqual([])
    expect(listRows({ rows: [{ id: 7 }], total: 1, limit: 1, offset: 0 })).toEqual([{ id: 7 }])
  })

  it('returns [] for unrecognized shapes instead of throwing', () => {
    expect(listRows(null)).toEqual([])
    expect(listRows(undefined)).toEqual([])
    expect(listRows({})).toEqual([])
    expect(listRows({ rows: 'nope' })).toEqual([])
    expect(listRows('oops')).toEqual([])
    expect(listRows(42)).toEqual([])
  })
})
