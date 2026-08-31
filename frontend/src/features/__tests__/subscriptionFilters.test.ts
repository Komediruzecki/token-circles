import { describe, expect, it } from 'vitest'
import {
  filterSubscriptions,
  subscriptionCategoryLabel,
  subscriptionGroupCounts,
} from '../subscriptionFilters'
import type { FilterableSubscription } from '../subscriptionFilters'

const sub = (over: Partial<FilterableSubscription>): FilterableSubscription => ({
  id: 1,
  name: 'Something',
  due_date: '2026-09-15',
  is_active: 1,
  ...over,
})

const fleet: FilterableSubscription[] = [
  sub({ id: 1, name: 'Netflix', due_date: '2026-09-20' }), // brand default: Streaming
  sub({ id: 2, name: 'Spotify', due_date: '2026-09-05' }), // brand default: Music
  sub({ id: 3, name: 'Disney Plus', due_date: '2026-09-01' }), // brand default: Streaming
  sub({ id: 4, name: 'Gym', due_date: '2026-09-10', category_name: 'Health' }),
  sub({ id: 5, name: 'Old Paper', due_date: '2026-09-02', is_active: 0 }),
]

describe('subscriptionCategoryLabel', () => {
  it("prefers the user's category over the brand default", () => {
    expect(subscriptionCategoryLabel(sub({ name: 'Netflix', category_name: 'Fun' }))).toBe('Fun')
    expect(subscriptionCategoryLabel(sub({ name: 'Netflix' }))).toBe('Streaming')
  })
})

describe('subscriptionGroupCounts', () => {
  it('counts only active subscriptions, largest group first', () => {
    expect(subscriptionGroupCounts(fleet)).toEqual([
      { label: 'Streaming', count: 2 },
      { label: 'Health', count: 1 },
      { label: 'Music', count: 1 },
    ])
  })
})

describe('filterSubscriptions', () => {
  it("'all' lists active subscriptions soonest due first, never paused ones", () => {
    expect(filterSubscriptions(fleet, 'all').map((s) => s.id)).toEqual([3, 2, 4, 1])
  })

  it('a category filter narrows by the same label the pills show', () => {
    expect(filterSubscriptions(fleet, { category: 'Streaming' }).map((s) => s.id)).toEqual([3, 1])
  })

  it("'paused' lists only the inactive ones", () => {
    expect(filterSubscriptions(fleet, 'paused').map((s) => s.id)).toEqual([5])
  })
})
