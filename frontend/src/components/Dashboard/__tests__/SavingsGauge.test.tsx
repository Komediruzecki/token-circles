/**
 * Dashboard's savings gauge (design.md 2.3): the rate over the last 12 tracked months from the
 * circles' facts, the ring saying how many months it covers, the profile's own goal set here, and,
 * behind the benchmarks gate, the typical band where the person lives.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { facts, words } from '../../../core/__tests__/guidanceFixtures'
import SavingsGauge from '../SavingsGauge'
import type { Answers } from '../../../../../shared/guidance/answers'
import type { GuidanceFacts } from '../../../../../shared/guidance/facts'
import type { GuidanceView } from '../../../core/guidance'

const saves = vi.hoisted(() => ({ fail: false, calls: [] as unknown[] }))

vi.mock('../../../core/guidanceAnswers', () => ({
  saveAnswers: vi.fn(async (changes: unknown) => {
    saves.calls.push(changes)
    if (saves.fail) throw new Error('offline')
    return changes
  }),
}))
vi.mock('../../../core/guidance', () => ({ takeAnswers: vi.fn() }))

import { takeAnswers } from '../../../core/guidance'

/** The view the store would answer, as far as the gauge reads it. */
const viewOf = (f: GuidanceFacts, gate = false, answers: Answers = {}): GuidanceView =>
  ({
    profileId: 1,
    facts: f,
    words,
    gate,
    region: { region: f.region, reason: 'fallback', via: null },
    inputs: { profileId: 1, answers, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 },
  }) as unknown as GuidanceView

let host: HTMLDivElement
let dispose: (() => void) | undefined
beforeEach(() => {
  saves.fail = false
  saves.calls = []
  vi.mocked(takeAnswers).mockClear()
})
afterEach(() => {
  dispose?.()
  host?.remove()
})
const mount = (view: GuidanceView | null): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <SavingsGauge view={view} />, host)
  return host
}
const q = (c: ParentNode, sel: string): HTMLElement => c.querySelector<HTMLElement>(sel)!
const text = (c: ParentNode, id: string) => q(c, `[data-test-id="${id}"]`)?.textContent ?? null
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Type into the goal field as a person would: focused, then an input event. */
function typeGoal(c: ParentNode, value: string) {
  const field = q(c, '[data-test-id="savings-gauge-goal-input"]') as HTMLInputElement
  field.focus()
  field.value = value
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  return field
}

describe('the savings gauge', () => {
  it('reads the last 12 months from the circles, and the ring says so', () => {
    const c = mount(viewOf(facts()))
    expect(text(c, 'savings-gauge-title')).toBe('You kept 16.7% of your income')
    const ring = q(c, 'svg[role="img"]')
    expect(ring.getAttribute('aria-label')).toBe(
      'Savings rate 16.7% over the last 12 months; goal 20%'
    )
    expect(ring.textContent).toContain('12 MONTHS')
    expect(text(c, 'savings-gauge-goal')).toBe(
      'Goal: 20% until you set your own. 3.3 points to go, about €99 a month.'
    )
    expect(text(c, 'savings-gauge-set-goal')).toBe('Set a goal')
  })

  it("shows the profile's own goal, reached or not", () => {
    const reached = mount(viewOf(facts(), false, { savingsGoal: 15 }))
    expect(text(reached, 'savings-gauge-goal')).toBe(
      'Your goal: 15%. Reached, with 1.7 points to spare.'
    )
    expect(text(reached, 'savings-gauge-set-goal')).toBe('Change goal')
    expect(reached.textContent).toContain('Your goal, 15%')
    dispose?.()
    host.remove()

    const short = mount(viewOf(facts(), false, { savingsGoal: 25 }))
    expect(text(short, 'savings-gauge-goal')).toBe(
      'Your goal: 25%. 8.3 points to go, about €249 a month.'
    )
    dispose?.()
    host.remove()

    // A goal of 0 is a goal, and on the ring.
    const zero = mount(viewOf(facts(), false, { savingsGoal: 0 }))
    expect(text(zero, 'savings-gauge-goal')).toBe(
      'Your goal: 0%. Reached, with 16.7 points to spare.'
    )
    expect(q(zero, 'svg[role="img"]').getAttribute('aria-label')).toContain('goal 0%')
    expect(zero.querySelector('[data-test-id="gauge-goal"]')).not.toBeNull()
  })

  it('says what went out over what came in when cash runs below zero', () => {
    const c = mount(
      viewOf(facts({ spending: 3300, savings: { rate: -10, cash: -10, withPrincipal: -10 } }))
    )
    expect(text(c, 'savings-gauge-title')).toBe('€300 a month more out than in')
    expect(q(c, 'svg[role="img"]').textContent).toContain('-10%')
  })

  it('counts loan principal paid down as saving, and says what cash alone was', () => {
    const c = mount(
      viewOf(
        facts({ principalRepaid: 300, savings: { rate: 26.7, cash: 16.7, withPrincipal: 26.7 } })
      )
    )
    expect(text(c, 'savings-gauge-title')).toBe('You kept 26.7% of your income')
    expect(c.textContent).toContain(
      'Of your loan payments, €300 a month on average paid the debt down; that counts as saving here. Cash alone: 16.7%.'
    )
  })

  it('says it firms up at 12 months, and waits for 3', () => {
    const early = mount(
      viewOf(facts({ firm: false, months: ['2026-03', '2026-04', '2026-05', '2026-06'] }))
    )
    expect(early.textContent).toContain('Based on 4 months. It firms up at 12.')
    expect(q(early, 'svg[role="img"]').textContent).toContain('4 MONTHS')
    dispose?.()
    host.remove()

    const waiting = mount(
      viewOf(
        facts({
          averaged: false,
          months: ['2026-05', '2026-06'],
          income: null,
          spending: null,
          savings: { rate: null, cash: null, withPrincipal: null },
        })
      )
    )
    expect(text(waiting, 'savings-gauge-waiting')).toBe(
      'Your savings rate shows once 3 months are tracked.'
    )
    expect(waiting.querySelector('svg')).toBeNull()
    dispose?.()
    host.remove()

    const noIncome = mount(
      viewOf(facts({ income: 0, savings: { rate: null, cash: null, withPrincipal: null } }))
    )
    expect(text(noIncome, 'savings-gauge-waiting')).toBe(
      "No income in your last 12 months, so there's no rate to show."
    )
  })

  it('says it is working the rate out until the circles are in', () => {
    const c = mount(null)
    expect(c.textContent).toContain('Working it out from your numbers.')
  })
})

describe('the goal', () => {
  it('saves a goal to the profile and hands it to the circles', async () => {
    const c = mount(viewOf(facts()))
    q(c, '[data-test-id="savings-gauge-set-goal"]').click()
    const field = typeGoal(c, '15')
    field.closest('form')!.requestSubmit()
    await vi.waitFor(() => {
      expect(saves.calls).toEqual([{ savingsGoal: 15 }])
    })
    expect(takeAnswers).toHaveBeenCalledWith(1, { savingsGoal: 15 })
    await vi.waitFor(() => {
      expect(c.querySelector('[data-test-id="savings-gauge-goal-input"]')).toBeNull()
    })
  })

  it('refuses a goal outside 0 to 100, and an empty one', async () => {
    const c = mount(viewOf(facts()))
    q(c, '[data-test-id="savings-gauge-set-goal"]').click()
    const field = typeGoal(c, '120')
    field.closest('form')!.requestSubmit()
    await tick()
    expect(text(c, 'savings-gauge-problem')).toBe('Enter a goal from 0 to 100%.')
    typeGoal(c, '')
    field.closest('form')!.requestSubmit()
    await tick()
    expect(text(c, 'savings-gauge-problem')).toBe('Enter a goal from 0 to 100%.')
    expect(saves.calls).toEqual([])
  })

  it('says when the goal did not save, and keeps the field open', async () => {
    saves.fail = true
    const c = mount(viewOf(facts(), false, { savingsGoal: 15 }))
    q(c, '[data-test-id="savings-gauge-set-goal"]').click()
    const field = q(c, '[data-test-id="savings-gauge-goal-input"]') as HTMLInputElement
    expect(field.value).toBe('15')
    typeGoal(c, '18')
    field.closest('form')!.requestSubmit()
    await vi.waitFor(() => {
      expect(text(c, 'savings-gauge-problem')).toBe("Couldn't save your goal. Try again.")
    })
    expect(c.querySelector('[data-test-id="savings-gauge-goal-input"]')).not.toBeNull()
  })
})

describe('behind the benchmarks gate', () => {
  it('draws the typical band, says the sentence for it and which region, and aims for it', async () => {
    const c = mount(viewOf(facts(), true))
    await vi.waitFor(() => {
      expect(c.querySelector('[data-test-id="gauge-band"]')).not.toBeNull()
    })
    expect(q(c, 'svg[role="img"]').getAttribute('aria-label')).toBe(
      'Savings rate 16.7% over the last 12 months; typical range 9.3% to 19.3%'
    )
    // The legend says the band, once: the goal line doesn't say it again.
    expect(c.textContent!.split('Typical in the EU: 9.3% to 19.3%')).toHaveLength(2)
    expect(text(c, 'savings-gauge-compare')).toMatch(/^Close to the EU average of /)
    expect(text(c, 'savings-gauge-goal')).toBe('No goal of your own yet.')
    expect(text(c, 'savings-gauge-set-goal')).toBe('Set a goal')
    // The band is the target: no goal on the ring.
    expect(c.querySelector('[data-test-id="gauge-goal"]')).toBeNull()
    expect(text(c, 'savings-gauge-region')).toBe(
      'Compared with the EU average, as nothing yet says where you live. Change'
    )
  })

  it("keeps the person's own goal as the goal", async () => {
    const c = mount(viewOf(facts(), true, { savingsGoal: 15 }))
    await vi.waitFor(() => {
      expect(c.querySelector('[data-test-id="gauge-band"]')).not.toBeNull()
    })
    expect(text(c, 'savings-gauge-goal')).toBe('Your goal: 15%. Reached, with 1.7 points to spare.')
  })

  it('shows none of it while the gate is closed, and aims for 20%', async () => {
    const c = mount(viewOf(facts(), false))
    await tick()
    await tick()
    expect(c.querySelector('[data-test-id="gauge-band"]')).toBeNull()
    expect(c.querySelector('[data-test-id="savings-gauge-compare"]')).toBeNull()
    expect(c.querySelector('[data-test-id="savings-gauge-region"]')).toBeNull()
    expect(c.textContent).not.toContain('Typical')
    expect(text(c, 'savings-gauge-goal')).toMatch(/^Goal: 20% until you set your own\./)
  })
})
