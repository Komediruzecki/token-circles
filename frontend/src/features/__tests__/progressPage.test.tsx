import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'solid-js'

vi.mock('../../core/appStore', () => ({ setPage: vi.fn() }))
const thisMonth = new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)
const month = (m: string, n = 3, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    date: `${m}-0${3 + i}`,
    type: 'expense',
    amount: 60,
    category_id: 1,
    ...over,
  }))

vi.mock('../../core/achievementsStore', () => ({
  snapshot: () => ({
    transactions: [
      ...(globalThis as never as { __snap: { transactions: unknown[] } }).__snap.transactions,
    ],
    budgets: [
      {
        category_id: 1,
        amount: 100,
        period: 'monthly',
        start_date: '2020-01-01',
        end_date: null,
        created_at: '2020-01-01T00:00:00Z',
      },
    ],
    goals: [],
    importLogs: [],
    categories: [{ id: 1, name: 'Food' }],
    bills: [],
    evaluation: {
      earned: [],
      streak: 2,
      trackedMonths: [(globalThis as never as { __snap: { month: string } }).__snap.month],
    },
    today: (globalThis as never as { __snap: { today: string } }).__snap.today,
  }),
  unlocks: () => [
    { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
  ],
  streak: () => 2,
  dismissedAdvice: () => [],
  dismissAdvice: vi.fn(async () => undefined),
  restoreAdvice: vi.fn(),
}))

;(globalThis as never as { __snap: Record<string, unknown> }).__snap = {
  month: thisMonth,
  today,
  transactions: [
    ...month(thisMonth),
    { date: `${thisMonth}-19`, type: 'expense', amount: 5, category_id: null },
  ],
}

import { ACHIEVEMENTS } from '../../core/achievements/definitions'
import { dismissAdvice } from '../../core/achievementsStore'
import { setPage } from '../../core/appStore'
import Progress from '../Progress'

let host: HTMLDivElement
beforeEach(() => {
  // jsdom has no matchMedia, and the OrbitalDivider between sections asks it about
  // prefers-reduced-motion the moment it mounts.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
})
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
})
const mount = (el: () => JSX.Element): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(el, host)
  return host
}

describe('Progress page', () => {
  it('shows the record over twelve months, the badges and the year in review', () => {
    const c = mount(() => <Progress />)
    expect(c.querySelector('[data-test-id="progress-streak"]')!.textContent).toBe(
      '2 months tracked'
    )
    expect(c.querySelectorAll('[data-month-cell]')).toHaveLength(12)
    expect(c.querySelectorAll('[data-month-cell][data-tracked="true"]')).toHaveLength(1)
    // Every badge in the set, however many that is: the gallery renders all four bands. Scoped
    // past the timeline, which draws a medallion of its own for each badge already earned.
    const gallery = c.querySelector('[aria-label="Every badge"]')!
    expect(gallery.querySelectorAll('[data-band]')).toHaveLength(ACHIEVEMENTS.length)
    expect(gallery.querySelectorAll('[data-lit="true"]')).toHaveLength(1)
    // The one earned badge appears on the timeline too, dated to the month it was earned.
    const timeline = c.querySelector('[data-test-id="badge-timeline"]')!
    expect(timeline.querySelectorAll('[data-timeline-stop]')).toHaveLength(1)
    // The three section headings are the brand's orbit dividers, not plain rules.
    expect(c.querySelectorAll('path[pathLength="1"]')).toHaveLength(3)
    expect(c.textContent).toContain('Year in review')
    expect(c.textContent).toContain('Nothing leaves it')
  })

  it('builds advice from the snapshot and can dismiss a card', () => {
    const c = mount(() => <Progress />)
    const cards = [...c.querySelectorAll('[data-advice-card]')]
    expect(cards.length).toBeGreaterThan(0)
    expect(c.textContent).toContain('Food')
    ;(cards[0].querySelector('.dismiss, [aria-label^="Dismiss"]') as HTMLButtonElement).click()
    expect(vi.mocked(dismissAdvice)).toHaveBeenCalled()
  })

  it('sends a card link to the page it names', () => {
    const c = mount(() => <Progress />)
    const link = [...c.querySelectorAll('[data-advice-card] button')].find(
      (b) => b.textContent === 'Budgets'
    ) as HTMLButtonElement
    link.click()
    expect(vi.mocked(setPage)).toHaveBeenCalledWith('budgets')
  })
})
