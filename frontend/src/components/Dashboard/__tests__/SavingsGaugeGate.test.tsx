/**
 * The savings gauge never fetches the cards chunk (and benchmarks.json with it) while the
 * benchmarks gate is closed, as in the production build. A file of its own: once a test has loaded
 * the chunk, the module cache would hide a second load.
 */
import { render } from 'solid-js/web'
import { describe, expect, it, vi } from 'vitest'
import { facts, words } from '../../../core/__tests__/guidanceFixtures'
import SavingsGauge from '../SavingsGauge'
import type { GuidanceView } from '../../../core/guidance'

const chunk = vi.hoisted(() => ({ loads: 0 }))

vi.mock('../../../../../shared/guidance/cards', async (importOriginal) => {
  chunk.loads++
  return importOriginal()
})
vi.mock('../../../core/guidanceAnswers', () => ({ saveAnswers: vi.fn() }))
vi.mock('../../../core/guidance', () => ({ takeAnswers: vi.fn() }))

const view = (gate: boolean): GuidanceView =>
  ({
    profileId: 1,
    facts: facts(),
    words,
    gate,
    region: { region: 'EU27', reason: 'fallback', via: null },
    inputs: { profileId: 1, answers: {}, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 },
  }) as unknown as GuidanceView

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the savings gauge and the cards chunk', () => {
  it('never loads it while the gate is closed, and loads it once it is open', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const closed = render(() => <SavingsGauge view={view(false)} />, host)
    await tick()
    await tick()
    expect(chunk.loads).toBe(0)
    closed()

    const open = render(() => <SavingsGauge view={view(true)} />, host)
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="gauge-band"]')).not.toBeNull()
    })
    expect(chunk.loads).toBe(1)
    open()
    host.remove()
  })
})
