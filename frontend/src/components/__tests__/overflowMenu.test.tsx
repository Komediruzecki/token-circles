/**
 * The "…" menu as a keyboard and a screen reader meet it (the WAI-ARIA menu button pattern): it
 * opens on the first item, arrows move through the items and wrap, Escape and Tab put focus back
 * on the trigger, and an item picked closes the menu before it runs. The menu is portalled to
 * <body>, so without this a keyboard never reached it: Tab from the trigger went on to the rest
 * of the card.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OverflowMenu from '../OverflowMenu'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const picked = vi.fn()

beforeEach(() => {
  picked.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <OverflowMenu
        label="More actions for Test boat"
        testId="test-menu"
        menuTestId="test-menu-open"
        items={[
          { label: 'First', testId: 'test-first', onSelect: () => picked('first') },
          { label: 'Second', testId: 'test-second', onSelect: () => picked('second') },
          { label: 'Third', testId: 'test-third', onSelect: () => picked('third') },
        ]}
      />
    ),
    host
  )
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const trigger = () => host.querySelector<HTMLButtonElement>('[data-test-id="test-menu"]')!
const menu = () => document.querySelector<HTMLElement>('[data-test-id="test-menu-open"]')
const item = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  )

describe('the menu button', () => {
  it('opens on the first item and names the menu it controls', () => {
    trigger().click()
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(item('test-first'))
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(menu()!.id)
  })

  it('opens from the keyboard: down on the first item, up on the last', () => {
    press(trigger(), 'ArrowDown')
    expect(document.activeElement).toBe(item('test-first'))
    press(document.activeElement!, 'Escape')
    press(trigger(), 'ArrowUp')
    expect(document.activeElement).toBe(item('test-third'))
  })

  it('moves through the items with the arrows, wrapping, and jumps with Home and End', () => {
    trigger().click()
    press(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(item('test-second'))
    press(document.activeElement!, 'ArrowDown')
    press(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(item('test-first'))
    press(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(item('test-third'))
    press(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(item('test-first'))
    press(document.activeElement!, 'End')
    expect(document.activeElement).toBe(item('test-third'))
  })

  it('closes on Escape and gives focus back to the trigger', () => {
    trigger().click()
    press(document.activeElement!, 'ArrowDown')
    press(document.activeElement!, 'Escape')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on Tab with focus back on the trigger, for the browser to move on from', () => {
    trigger().click()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(tab)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    // Not prevented: the browser's own Tab then moves on from the trigger.
    expect(tab.defaultPrevented).toBe(false)
  })

  it('closes before an item runs, with focus on the trigger', () => {
    trigger().click()
    picked.mockImplementation(() => {
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(trigger())
    })
    item('test-second')!.click()
    expect(picked).toHaveBeenCalledWith('second')
  })

  it('closes on a press outside', () => {
    trigger().click()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menu()).toBeNull()
  })
})

describe('a scroll while the menu is open', () => {
  /** Where the trigger is on screen; a scroll that moves the page moves it. */
  let top = 100
  beforeEach(() => {
    top = 100
    vi.spyOn(trigger(), 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top,
          bottom: top + 36,
          left: 300,
          right: 336,
          width: 36,
          height: 36,
          x: 300,
          y: top,
        }) as DOMRect
    )
  })

  it('closes the menu when the page moves under it', () => {
    trigger().click()
    top = 40
    window.dispatchEvent(new Event('scroll'))
    expect(menu()).toBeNull()
  })

  // Scroll events come a frame late: the one for a scroll that came with the press that opened
  // the menu arrives after it opened, with the trigger where it was. Closing on it shut the menu
  // before anyone saw it.
  it('leaves it open when nothing moved', () => {
    trigger().click()
    window.dispatchEvent(new Event('scroll'))
    expect(menu()).not.toBeNull()
  })
})

describe('where the menu opens', () => {
  /** The trigger's top on a 768 px window (jsdom's), and the menu's height once it is drawn. */
  let top = 100
  beforeEach(() => {
    top = 100
    vi.spyOn(trigger(), 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top,
          bottom: top + 36,
          left: 300,
          right: 336,
          width: 36,
          height: 36,
          x: 300,
          y: top,
        }) as DOMRect
    )
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.getAttribute('role') === 'menu' ? 160 : 0
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens under the trigger, its right edge on the trigger’s', () => {
    trigger().click()
    expect(menu()!.style.top).toBe('142px')
    expect(menu()!.style.bottom).toBe('')
    expect(menu()!.style.right).toBe(`${window.innerWidth - 336}px`)
  })

  it('opens above the trigger when the window has no room for it below', () => {
    // 600 + 36 + 6 + 160 runs past the window's 768 less its 8 px edge.
    top = 600
    trigger().click()
    expect(menu()!.style.top).toBe('')
    expect(menu()!.style.bottom).toBe(`${768 - 600 + 6}px`)
  })

  it('stays under the trigger when there is no room above it either', () => {
    // A window too short for the menu either way: under the trigger, where it starts.
    vi.stubGlobal('innerHeight', 300)
    top = 120
    trigger().click()
    expect(menu()!.style.top).toBe('162px')
    expect(menu()!.style.bottom).toBe('')
    vi.unstubAllGlobals()
  })
})
