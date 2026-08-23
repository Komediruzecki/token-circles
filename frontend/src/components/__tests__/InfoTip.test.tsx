/**
 * InfoTip.
 *
 * The version this replaced used the native `title` attribute, which is hover-only —
 * unreachable on a phone — and occupied no layout only because the browser drew it. The
 * rewrite has to keep both properties: reachable by tap and by keyboard, and still
 * costing the form no vertical space, since a hint that pushed its own field out of line
 * with its neighbour is what prompted the change.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import InfoTip from '../InfoTip'

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

const mount = (text = 'Applied every January, unless a pay step beats it.') => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <InfoTip text={text} testId="tip" />, host)
  return host.querySelector<HTMLButtonElement>('[data-test-id="tip"]')!
}

const panel = () => document.querySelector<HTMLElement>('[data-test-id="tip-panel"]')

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

describe('InfoTip', () => {
  it('reveals its text on tap, which is the only gesture a phone has', () => {
    const trigger = mount()
    expect(panel()).toBeNull()

    trigger.click()
    expect(panel()!.textContent).toContain('Applied every January')
  })

  it('opens on hover for a mouse and closes again on the way out', () => {
    const trigger = mount()
    trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    expect(panel()).not.toBeNull()

    trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    expect(panel()).toBeNull()
  })

  it('ignores a touch pointer entering, so a tap does not open and immediately close', () => {
    const trigger = mount()
    // A tap fires pointerenter before click. Opening on that and toggling on the click
    // would leave the panel shut on the first tap and open on the second.
    trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }))
    expect(panel()).toBeNull()

    trigger.click()
    expect(panel()).not.toBeNull()
  })

  it('stays open when the pointer leaves after a click pinned it', () => {
    const trigger = mount()
    trigger.click()
    trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    expect(panel()).not.toBeNull()

    trigger.click()
    expect(panel()).toBeNull()
  })

  it('is named by the explanation, since some copy lives nowhere else', () => {
    // The Budgets page states its whole model in one of these. A generic name would leave
    // that reachable by sighted pointer alone.
    const trigger = mount('Zero-based budgeting: allocate every dollar to a category')
    expect(trigger.getAttribute('aria-label')).toBe(
      'Zero-based budgeting: allocate every dollar to a category'
    )
  })

  it('closes on Escape and hands focus back to the trigger', () => {
    const trigger = mount()
    trigger.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes when something else on the page is pressed', () => {
    const trigger = mount()
    trigger.click()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(panel()).toBeNull()
  })

  it('stays open when the panel itself is pressed, so text can be selected', () => {
    const trigger = mount()
    trigger.click()
    panel()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(panel()).not.toBeNull()
  })

  it('opens on keyboard focus', async () => {
    const trigger = mount()
    trigger.focus()
    await flush()
    expect(panel()).not.toBeNull()
  })

  it('describes the trigger by the panel only while the panel exists', () => {
    const trigger = mount()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-describedby')).toBeNull()

    trigger.click()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe(panel()!.id)
    expect(panel()!.getAttribute('role')).toBe('tooltip')
  })

  it('takes the text out of the document flow, so a field cannot be pushed out of line', () => {
    const trigger = mount()
    trigger.click()
    // Fixed positioning is the whole reason this replaced an inline hint: the panel is
    // painted over the page rather than occupying a row in the form, and it escapes the
    // scrolling column that would otherwise clip it. Its coordinates come from the
    // trigger's measured box, so they are set on the element itself.
    expect(window.getComputedStyle(panel()!).position).toBe('fixed')
    expect(panel()!.style.top).not.toBe('')
    expect(panel()!.style.left).not.toBe('')
  })

  it('reopens on focus after an Escape, once focus has actually left and come back', () => {
    const trigger = mount()
    trigger.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel()).toBeNull()

    trigger.blur()
    trigger.focus()
    expect(panel()).not.toBeNull()
  })

  it('follows its icon when the page scrolls, rather than being left behind', () => {
    const trigger = mount()
    trigger.click()
    const before = panel()!.style.top

    // The form scrolls; a panel pinned at its opening coordinates would drift off its
    // icon. It is repositioned from the trigger's box instead of being closed, so a tip
    // being read survives a scroll.
    trigger.getBoundingClientRect = () =>
      ({ top: 400, bottom: 424, left: 120, width: 24, height: 24 }) as DOMRect
    window.dispatchEvent(new Event('scroll'))
    expect(panel()!.style.top).not.toBe(before)
    expect(panel()!.style.top).toBe('430px')
  })

  it('ignores a scroll while it is closed', () => {
    mount()
    expect(() => window.dispatchEvent(new Event('scroll'))).not.toThrow()
    expect(panel()).toBeNull()
  })

  it('flips above the icon when there is no room below', () => {
    const trigger = mount()
    // jsdom reports a zero-height panel, so "no room below" is the only case it can
    // exercise: the panel is asked for a position at the very bottom of the window.
    trigger.getBoundingClientRect = () =>
      ({
        top: window.innerHeight - 2,
        bottom: window.innerHeight + 22,
        left: 120,
        width: 24,
        height: 24,
      }) as DOMRect
    trigger.click()
    expect(Number(panel()!.style.top.replace('px', ''))).toBeLessThanOrEqual(window.innerHeight)
  })

  it('keeps the panel inside the window at either edge', () => {
    const trigger = mount()
    trigger.getBoundingClientRect = () =>
      ({ top: 10, bottom: 34, left: -50, width: 24, height: 24 }) as DOMRect
    trigger.click()
    expect(Number(panel()!.style.left.replace('px', ''))).toBeGreaterThanOrEqual(0)
  })

  it('stops listening once it is disposed', () => {
    const trigger = mount()
    trigger.click()
    expect(panel()).not.toBeNull()
    dispose?.()
    dispose = undefined
    // The listeners are on document and window; a disposed tip must not answer them.
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      window.dispatchEvent(new Event('resize'))
    }).not.toThrow()
  })
})
