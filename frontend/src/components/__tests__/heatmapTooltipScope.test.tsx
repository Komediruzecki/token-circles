/**
 * The heatmap's tooltip renders at the end of the page, outside the deck that re-grounds Analytics
 * in graphite. It took its colours from where it rendered, so over the deck it painted Orbit's navy
 * floating pair instead of the deck's (19 Nov). It now carries the theme scope its chart sits in, as
 * InfoTip's panel does, in a wrapper that draws no box of its own.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import D3HeatmapChart from '../D3HeatmapChart'

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
})

const mountIn = (scope?: string) => {
  // The chart re-renders on resize; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  if (scope) host.className = scope
  document.body.appendChild(host)
  dispose = render(
    () => <D3HeatmapChart data={new Map([['2026-03-14', 12.5]])} year={2026} type="expense" />,
    host
  )
  const tooltip = document.getElementById('heatmap-tooltip')
  expect(tooltip, 'the chart made no tooltip').not.toBeNull()
  return tooltip!
}

const wrappers = () =>
  [...document.body.children].filter((el) => (el as HTMLElement).style.display === 'contents')

describe("the heatmap's tooltip", () => {
  it("wears the deck's scope, so on Analytics it paints the deck's own pair", () => {
    const tooltip = mountIn('instrument-deck')
    expect(host!.contains(tooltip)).toBe(false)
    const scope = tooltip.closest('.instrument-deck')
    expect(scope).not.toBeNull()
    expect(scope).not.toBe(host)
    // The scope carries tokens only, so the deck's background and radius never paint around it.
    expect((scope as HTMLElement).style.display).toBe('contents')
  })

  it('takes no scope when its chart sits in none', () => {
    expect(mountIn().closest('.instrument-deck')).toBeNull()
  })

  it('leaves nothing behind when the chart goes', () => {
    mountIn('instrument-deck')
    dispose!()
    dispose = undefined
    expect(document.getElementById('heatmap-tooltip')).toBeNull()
    expect(wrappers()).toEqual([])
  })
})
