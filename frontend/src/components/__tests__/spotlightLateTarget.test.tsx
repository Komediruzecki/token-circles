/**
 * The tour gate caught this on Settings: a step that navigates to a lazily-loaded page
 * flashed "this step's feature isn't visible" over an anchor that arrived a moment later.
 * `updatePositions` runs from a 100ms timer and from the resize/scroll handler, and it was
 * raising the banner on its own — before the step-change effect's 6s budget had run out.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  endSpotlight,
  setSpotlightActive,
  setSpotlightStep,
  setTourSteps,
} from '../../core/spotlightStore'
import Spotlight from '../Spotlight'

const MISSING_COPY = "This step's feature isn't visible"
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let host: HTMLDivElement
let dispose: (() => void) | undefined
beforeEach(() => {
  // jsdom has no scrollIntoView, and updatePositions calls it once the target resolves.
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  document.querySelector('[data-tour="late"]')?.remove()
  endSpotlight()
  setSpotlightActive(false)
  setTourSteps([])
})

const startTourOn = (selector: string): HTMLDivElement => {
  setTourSteps([
    {
      target: 'late',
      targetSelector: selector,
      title: 'A page that has not mounted yet',
      description: 'The anchor arrives with the lazy chunk.',
      placement: 'bottom',
    },
  ])
  setSpotlightStep(0)
  setSpotlightActive(true)
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <Spotlight />, host)
  return host
}

describe('Spotlight, target that has not mounted yet', () => {
  it('waits quietly instead of announcing the step is missing', async () => {
    const c = startTourOn('[data-tour="late"]')
    // Long enough for the reposition timer (100ms) and a resize pass, nowhere near the 6s
    // budget the step-change effect gives a lazy page.
    await settle(300)
    expect(c.textContent).not.toContain(MISSING_COPY)
  })

  it('picks the target up when it finally mounts, still without the banner', async () => {
    const c = startTourOn('[data-tour="late"]')
    await settle(150)
    const late = document.createElement('div')
    late.setAttribute('data-tour', 'late')
    document.body.appendChild(late)
    await settle(200)
    expect(c.textContent).not.toContain(MISSING_COPY)
    expect(c.textContent).toContain('A page that has not mounted yet')
  })
})
