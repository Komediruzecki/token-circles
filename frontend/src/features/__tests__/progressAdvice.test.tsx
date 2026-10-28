/**
 * The "Worth a look" list on Progress. A long history can hold many cards, so the list shows the
 * first three and a button inside the list's own container shows the rest.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdviceList, { ADVICE_SHOWN } from '../ProgressAdvice'
import type { JSX } from 'solid-js'
import type { AdviceCard } from '../../core/achievements/advice'

const card = (n: number): AdviceCard => ({
  id: `card-${n}`,
  kind: 'budget-drift',
  tone: 'warn',
  title: `Card ${n}`,
  detail: `Detail ${n}`,
  figure: String(n),
  link: { page: 'budgets', label: 'Budgets' },
  weight: 100 - n,
})
const cards = (n: number): AdviceCard[] => Array.from({ length: n }, (_, i) => card(i + 1))

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
const titles = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('[data-advice-card]')].map(
    (li) => li.querySelector('[data-advice-title]')!.textContent!
  )
const toggle = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector('[data-test-id="advice-toggle"]')

describe('Worth a look list', () => {
  it('shows three cards and a button for the rest', () => {
    expect(ADVICE_SHOWN).toBe(3)
    const c = mount(() => <AdviceList cards={cards(7)} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(titles(c)).toEqual(['Card 1', 'Card 2', 'Card 3'])
    const button = toggle(c)!
    expect(button.textContent).toBe('Show 4 more')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // The button names the list it opens, and sits in the same container as that list.
    const list = c.querySelector(`#${button.getAttribute('aria-controls')}`)!
    expect(list.tagName).toBe('UL')
    expect(list.parentElement).toBe(button.parentElement)
  })

  it('opens to every card and closes again', () => {
    const c = mount(() => <AdviceList cards={cards(5)} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    toggle(c)!.click()
    expect(titles(c)).toHaveLength(5)
    expect(toggle(c)!.textContent).toBe('Show fewer')
    expect(toggle(c)!.getAttribute('aria-expanded')).toBe('true')
    toggle(c)!.click()
    expect(titles(c)).toHaveLength(3)
    expect(toggle(c)!.getAttribute('aria-expanded')).toBe('false')
  })

  it('has no button when three cards or fewer are left', () => {
    const c = mount(() => <AdviceList cards={cards(3)} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(titles(c)).toHaveLength(3)
    expect(toggle(c)).toBeNull()
  })

  it('moves the next card up when one is dismissed', () => {
    const [list, setList] = createSignal(cards(5))
    const onDismiss = vi.fn((id: string) => setList((l) => l.filter((x) => x.id !== id)))
    const c = mount(() => <AdviceList cards={list()} onOpen={vi.fn()} onDismiss={onDismiss} />)
    ;(c.querySelector('[aria-label="Dismiss: Card 2"]') as HTMLButtonElement).click()
    expect(onDismiss).toHaveBeenCalledWith('card-2')
    expect(titles(c)).toEqual(['Card 1', 'Card 3', 'Card 4'])
    expect(toggle(c)!.textContent).toBe('Show 1 more')
    ;(c.querySelector('[aria-label="Dismiss: Card 1"]') as HTMLButtonElement).click()
    expect(titles(c)).toEqual(['Card 3', 'Card 4', 'Card 5'])
    expect(toggle(c)).toBeNull()
  })

  it('sends a card link to the page it names', () => {
    const onOpen = vi.fn()
    const c = mount(() => <AdviceList cards={cards(1)} onOpen={onOpen} onDismiss={vi.fn()} />)
    ;(c.querySelector('[data-advice-card] button') as HTMLButtonElement).click()
    expect(onOpen).toHaveBeenCalledWith('budgets')
  })
})
