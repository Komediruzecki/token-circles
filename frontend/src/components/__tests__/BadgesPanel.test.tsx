import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'solid-js'

vi.mock('../../core/achievementsStore', () => ({
  unlocks: () => [
    { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
  ],
  streak: () => 2,
  panelOpen: () => true,
  closeBadgesPanel: vi.fn(),
  openBadgesPanel: vi.fn(),
}))

import BadgesPanel from '../BadgesPanel'
import StreakChip, { streakLabel } from '../StreakChip'

let host: HTMLDivElement
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

describe('BadgesPanel', () => {
  it('lists fifteen badges in three bands, lights the earned one and names the next step', () => {
    const c = mount(() => <BadgesPanel />)
    expect(c.querySelectorAll('[data-band]')).toHaveLength(15)
    expect(c.querySelectorAll('[data-lit="true"]')).toHaveLength(1)
    expect(c.textContent).toContain('Next: First import')
    expect(c.textContent).toContain('Next: One month')
    expect(c.textContent).toContain('Next: Half a year, 4 more tracked months')
    expect(c.textContent).toContain('Earned July 2026')
    expect(c.textContent).toContain('Nothing leaves this device')
    expect(c.querySelectorAll('button').length).toBeGreaterThanOrEqual(2) // close + one share
  })
})

describe('StreakChip', () => {
  it('pluralises the live streak', () => {
    const c = mount(() => <StreakChip />)
    expect(c.textContent).toContain('2 months tracked')
    expect(streakLabel(0)).toBe('Start a streak')
    expect(streakLabel(1)).toBe('1 month tracked')
  })
})
