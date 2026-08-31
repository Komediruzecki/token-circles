/**
 * Pure helpers behind the Subscriptions view's filter pills. One label rule shared by the pills
 * and the cards: the user's own category first, the brand's default category as fallback — the
 * old view grouped by one and labelled cards by the other, so a card could sit under a heading
 * that didn't match its own pill.
 */
import { matchBrand } from './subscriptionBrands'

export interface FilterableSubscription {
  id: number
  name: string
  due_date: string
  is_active?: number
  category?: string
  category_name?: string
  category_color?: string
}

export type SubscriptionFilter = 'all' | 'paused' | { category: string }

export function subscriptionCategoryLabel(sub: FilterableSubscription): string {
  return (
    sub.category_name || sub.category || matchBrand(sub.name, sub.category_color).defaultCategory
  )
}

const isActive = (sub: FilterableSubscription) => sub.is_active !== 0

const byDueDate = (a: FilterableSubscription, b: FilterableSubscription) =>
  a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.name.localeCompare(b.name)

/** Category pills for the ACTIVE subscriptions, largest group first, ties alphabetical. */
export function subscriptionGroupCounts(
  subs: FilterableSubscription[]
): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const sub of subs) {
    if (!isActive(sub)) continue
    const label = subscriptionCategoryLabel(sub)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * The cards a filter shows, soonest due first. 'all' and category filters cover active
 * subscriptions only — paused ones live behind their own pill.
 */
export function filterSubscriptions(
  subs: FilterableSubscription[],
  filter: SubscriptionFilter
): FilterableSubscription[] {
  if (filter === 'paused') return subs.filter((s) => !isActive(s)).sort(byDueDate)
  const active = subs.filter(isActive)
  if (filter === 'all') return active.sort(byDueDate)
  return active.filter((s) => subscriptionCategoryLabel(s) === filter.category).sort(byDueDate)
}
