/**
 * The category list as the app reads it (api.getCategories), with what each category holds: its
 * kind, and whether it is needed every month (shared/guidance/kinds.ts).
 *
 * A kind this build does not have is kept as it is, not refused: a later build can add one, and
 * one unknown value must not empty the whole list, as an unknown account type once did. D1 keeps
 * the choice as 1 or 0, which reads as yes or no; a category from before kinds has neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { apiFetch } from '../apiFetch'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
})

const row = (id: number, name: string, fields: Record<string, unknown>) => ({
  id,
  name,
  color: '#aa5500',
  icon: 'tag',
  type: 'expense',
  parent_id: null,
  tax_deductible: 0,
  created_at: '2026-01-01',
  profile_id: 1,
  ...fields,
})

function answer(rows: unknown[]): void {
  apiFetchMock.mockResolvedValue(
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
}

describe('api.getCategories', () => {
  it('reads each kind and choice, keeps a kind it lacks, and loads a row from before kinds', async () => {
    answer([
      row(1, 'Groceries', { kind: 'groceries', essential: null }),
      row(2, 'Cinema', { kind: 'leisure', essential: 1 }),
      row(3, 'Takeaway', { kind: 'eating_out', essential: 0 }),
      row(4, 'Pets', { kind: 'pets', essential: null }),
      row(5, 'Old', {}),
    ])
    const categories = await api.getCategories()
    expect(categories.map((c) => [c.name, c.kind, c.essential])).toEqual([
      ['Groceries', 'groceries', null],
      ['Cinema', 'leisure', true],
      ['Takeaway', 'eating_out', false],
      ['Pets', 'pets', null],
      ['Old', undefined, undefined],
    ])
  })
})
