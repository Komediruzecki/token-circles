/**
 * Skeleton placeholders.
 *
 * Two defects these pin down, both from the original implementation:
 *  - every block ended with `<span class="sr-only">Loading…</span>`, but no `.sr-only` rule exists
 *    anywhere in the app, so the word "Loading…" rendered as ordinary visible text right next to
 *    the placeholder that was supposed to replace it;
 *  - chart bar heights came from `20 + Math.sin(i * 1.3) * 40 + (i % 3) * 25`, which is -7.5% at
 *    i=3 — not a valid length, so that bar disappeared.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { SkeletonCard, SkeletonChart, SkeletonPage, SkeletonTable, SkeletonText } from '../Skeleton'

let host: HTMLDivElement
let dispose: () => void

afterEach(() => {
  dispose?.()
  host?.remove()
})

function mount(node: () => unknown) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(node as () => never, host)
  return host
}

describe('Skeleton placeholders', () => {
  it('renders no visible loading text', () => {
    const el = mount(() => (
      <>
        <SkeletonTable rows={3} cols={3} />
        <SkeletonCard count={2} />
        <SkeletonText lines={2} />
        <SkeletonChart />
        <SkeletonPage cards={1} rows={2} chart />
      </>
    ))
    // The accessible name carries the announcement; nothing is painted on screen.
    expect(el.textContent?.trim()).toBe('')
    expect(el.querySelector('.sr-only')).toBeNull()
  })

  it('labels each block for assistive tech without nesting live regions', () => {
    const el = mount(() => <SkeletonPage cards={2} rows={2} chart />)
    const statuses = el.querySelectorAll('[role="status"]')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.getAttribute('aria-label')).toBe('Loading page')
    // The blocks are still composed — they just don't carry their own region.
    expect(el.querySelectorAll('[data-test-id="skeleton"]').length).toBeGreaterThan(1)
  })

  it('keeps its own live region when used standalone', () => {
    const el = mount(() => <SkeletonCard count={2} />)
    const status = el.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-label')).toBe('Loading cards')
  })

  it('gives every chart bar a height that is positive and within the track', () => {
    const el = mount(() => <SkeletonChart bars={12} />)
    const bars = [...el.querySelectorAll<HTMLElement>('div[style*="height"]')]
    expect(bars).toHaveLength(12)
    for (const bar of bars) {
      const pct = Number.parseFloat(bar.style.height)
      expect(Number.isFinite(pct)).toBe(true)
      expect(pct).toBeGreaterThan(0)
      expect(pct).toBeLessThanOrEqual(100)
    }
  })

  it('renders the requested number of rows, cells and cards', () => {
    const el = mount(() => (
      <>
        <SkeletonTable rows={4} cols={3} />
        <SkeletonCard count={5} />
      </>
    ))
    const table = el.querySelector('[aria-label="Loading table"]')!
    expect(table.children).toHaveLength(4)
    expect(table.children[0]?.children).toHaveLength(3)
    expect(el.querySelector('[aria-label="Loading cards"]')?.children).toHaveLength(5)
  })

  // A Solid component body runs once. Reading `props.count` into a const at setup freezes the
  // first value, so a later change never reaches the DOM.
  it('follows a count that changes after mount', () => {
    const [count, setCount] = createSignal(2)
    const el = mount(() => <SkeletonCard count={count()} />)
    expect(el.querySelector('[aria-label="Loading cards"]')?.children).toHaveLength(2)
    setCount(6)
    expect(el.querySelector('[aria-label="Loading cards"]')?.children).toHaveLength(6)
  })

  it('renders nothing rather than throwing for a zero or negative count', () => {
    const el = mount(() => <SkeletonCard count={-3} />)
    expect(el.querySelector('[aria-label="Loading cards"]')?.children).toHaveLength(0)
  })
})
