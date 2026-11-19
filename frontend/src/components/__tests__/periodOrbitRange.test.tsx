/**
 * The custom range opens on the range in focus, ready to adjust. All time's range starts on
 * 1970-01-01, a stand-in for "everything" and not a day anyone picked: the custom range opened on
 * it as "1970-01-01 → today", and Apply turned All time into a custom range labelled "1 Jan 1970 –
 * 19 Nov 2026". On All time it opens empty and waits for a start day.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setPeriod } from '../../core/periodStore'
import { fromPill } from '../../utils/period'
import PeriodOrbit from '../PeriodOrbit'
import type { Period } from '../../utils/period'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

/** Open the picker on a period, switch to the custom range, and read what it offers. */
function openCustomRange(p: Period) {
  setPeriod(p)
  dispose = render(() => <PeriodOrbit onClose={() => {}} />, host)
  // A custom range opens the picker on the range calendar already; anything else opens the ring.
  const toggle = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Custom range')
  )
  toggle?.click()
  const label = document.querySelector('[class*="calNavLabel"]')?.textContent?.replace(/\s+/g, ' ')
  const apply = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Apply range')
  )
  return { label: label?.trim(), applyDisabled: apply?.disabled }
}

describe('the custom range in the period picker', () => {
  it('opens empty on All time, with nothing to apply', () => {
    expect(openCustomRange(fromPill('all'))).toEqual({
      label: 'Pick a start day',
      applyDisabled: true,
    })
  })

  it('opens on a custom range it was given', () => {
    const custom: Period = {
      mode: 'range',
      year: 2026,
      from: '2026-05-04',
      to: '2026-06-01',
      preset: 'custom',
    }
    expect(openCustomRange(custom)).toEqual({
      label: '2026-05-04 → 2026-06-01',
      applyDisabled: false,
    })
  })

  it('opens on a range pill such as Last 30 days', () => {
    const last30 = fromPill('last30')
    expect(openCustomRange(last30)).toEqual({
      label: `${last30.from} → ${last30.to}`,
      applyDisabled: false,
    })
  })
})
