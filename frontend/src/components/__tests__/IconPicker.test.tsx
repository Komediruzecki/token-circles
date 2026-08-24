/**
 * IconPicker — the gallery behind the icon field's Browse button.
 *
 * The thing worth testing is not that a grid renders. It is that the gallery only ever offers
 * icons the app will actually honour: `tag` and `folder` are real glyphs, but they are also the
 * values stored when nobody chose anything, so a category holding one of them gets its icon from
 * the category NAME instead. Offering them would be offering a choice that silently does nothing.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { getCategorySvg, iconSvgByKey, PICKABLE_ICON_NAMES } from '../CategoryIcon'
import IconPicker from '../IconPicker'

let host: HTMLDivElement
let dispose: (() => void) | undefined

function mount(props: Partial<Parameters<typeof IconPicker>[0]> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const picked: string[] = []
  let closed = 0
  dispose = render(
    () => (
      <IconPicker
        value={props.value ?? ''}
        onPick={(n) => {
          picked.push(n)
        }}
        onClose={() => {
          closed += 1
        }}
      />
    ),
    host
  )
  return { picked, closed: () => closed }
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

const items = () => [...host.querySelectorAll('[data-test-id^="icon-picker-item-"]')]
const keyOf = (el: Element) => el.getAttribute('data-test-id')!.replace('icon-picker-item-', '')

describe('what the gallery offers', () => {
  it('lists every pickable icon', () => {
    mount()
    expect(items().map(keyOf)).toEqual([...PICKABLE_ICON_NAMES])
    expect(items().length).toBeGreaterThan(20)
  })

  it('leaves out the values that mean "nobody chose one"', () => {
    mount()
    const offered = items().map(keyOf)
    // Both are drawable — that is exactly what makes them a trap.
    expect(iconSvgByKey('tag')).toBeTruthy()
    expect(iconSvgByKey('folder')).toBeTruthy()
    expect(offered).not.toContain('tag')
    expect(offered).not.toContain('folder')
  })

  it('offers nothing the renderer would ignore', () => {
    mount()
    // The real assertion behind the previous one: for every key on offer, storing it as the
    // category's icon must actually change what is drawn, whatever the category is called.
    // A key the renderer treats as a default would draw the name's icon instead.
    for (const key of items().map(keyOf)) {
      const chosen = getCategorySvg('Groceries', 18, key) as unknown as SVGElement
      const byKey = iconSvgByKey(key, 18) as unknown as SVGElement
      expect(chosen.querySelector('path')?.getAttribute('d')).toBe(
        byKey.querySelector('path')?.getAttribute('d')
      )
    }
  })
})

describe('using it', () => {
  it('hands back the key that was clicked', () => {
    const { picked } = mount()
    const utensils = host.querySelector<HTMLButtonElement>(
      '[data-test-id="icon-picker-item-utensils"]'
    )
    utensils!.click()
    expect(picked).toEqual(['utensils'])
  })

  it('marks the icon the field already holds', () => {
    mount({ value: 'utensils' })
    const el = host.querySelector('[data-test-id="icon-picker-item-utensils"]')!
    expect(el.getAttribute('aria-pressed')).toBe('true')
    const other = host.querySelector('[data-test-id="icon-picker-item-home"]')!
    expect(other.getAttribute('aria-pressed')).toBe('false')
  })

  it('recognises the field value whatever case or padding it arrived in', () => {
    mount({ value: '  Utensils ' })
    expect(
      host.querySelector('[data-test-id="icon-picker-item-utensils"]')!.getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('filters as you type, and says so when nothing matches', () => {
    mount()
    const filter = host.querySelector<HTMLInputElement>('[data-test-id="icon-picker-filter"]')!

    filter.value = 'circle'
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    const shown = items().map(keyOf)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((k) => k.includes('circle'))).toBe(true)

    filter.value = 'zzzz'
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    expect(items()).toHaveLength(0)
    expect(host.querySelector('[data-test-id="icon-picker-empty"]')).not.toBeNull()
  })

  it('does not fight the filter field for the caret', () => {
    mount()
    const filter = host.querySelector<HTMLInputElement>('[data-test-id="icon-picker-filter"]')!
    filter.focus()
    // `value` is deliberately not bound back to the signal. If it were, this loop would end with
    // the field holding something other than what was "typed" into it.
    for (const text of ['c', 'ci', 'cir', 'circ']) {
      filter.value = text
      filter.dispatchEvent(new Event('input', { bubbles: true }))
      expect(document.activeElement).toBe(filter)
      expect(filter.value).toBe(text)
    }
  })
})

describe('dismissing it', () => {
  it('closes on the close button', () => {
    const { closed } = mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="icon-picker-close"]')!.click()
    expect(closed()).toBe(1)
  })

  it('closes on a click outside the panel, but not inside it', () => {
    const { closed } = mount()
    const overlay = host.querySelector<HTMLElement>('[data-test-id="icon-picker-overlay"]')!
    host.querySelector<HTMLElement>('[data-test-id="icon-picker-grid"]')!.click()
    expect(closed()).toBe(0)
    overlay.click()
    expect(closed()).toBe(1)
  })

  it('closes on Escape without letting the category modal see the key', () => {
    const { closed } = mount()
    let reachedDocument = 0
    // The category modal behind this one listens at the document too. If Escape reached it, the
    // half-filled form would be thrown away along with the gallery.
    const spy = () => {
      reachedDocument += 1
    }
    document.addEventListener('keydown', spy)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.removeEventListener('keydown', spy)

    expect(closed()).toBe(1)
    expect(reachedDocument).toBe(0)
  })

  it('ignores other keys', () => {
    const { closed } = mount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(closed()).toBe(0)
  })
})
