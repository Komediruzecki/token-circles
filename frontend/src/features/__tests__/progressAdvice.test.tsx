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

  it('closes again once dismissals leave nothing hidden, so new cards start folded', () => {
    const [list, setList] = createSignal(cards(5))
    const c = mount(() => (
      <AdviceList
        cards={list()}
        onOpen={vi.fn()}
        onDismiss={(id) => setList((l) => l.filter((x) => x.id !== id))}
      />
    ))
    toggle(c)!.click()
    expect(toggle(c)!.textContent).toBe('Show fewer')
    ;(c.querySelector('[aria-label="Dismiss: Card 5"]') as HTMLButtonElement).click()
    ;(c.querySelector('[aria-label="Dismiss: Card 4"]') as HTMLButtonElement).click()
    expect(toggle(c)).toBeNull()
    setList((l) => [...l, card(8), card(9)])
    expect(titles(c)).toEqual(['Card 1', 'Card 2', 'Card 3'])
    expect(toggle(c)!.textContent).toBe('Show 2 more')
    expect(toggle(c)!.getAttribute('aria-expanded')).toBe('false')
  })

  describe('where focus goes after a dismissal', () => {
    const live = (n: number, onEmpty = vi.fn()) => {
      const [list, setList] = createSignal(cards(n))
      const c = mount(() => (
        <AdviceList
          cards={list()}
          onOpen={vi.fn()}
          onDismiss={(id) => setList((l) => l.filter((x) => x.id !== id))}
          onEmpty={onEmpty}
        />
      ))
      return c
    }
    const dismiss = async (c: HTMLElement, title: string): Promise<void> => {
      const button = c.querySelector(`[aria-label="Dismiss: ${title}"]`) as HTMLButtonElement
      button.focus()
      button.click()
      await Promise.resolve()
    }

    it('moves to the next card', async () => {
      const c = live(5)
      await dismiss(c, 'Card 2')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Dismiss: Card 3')
    })

    it('moves to the card that moved up into the last place shown', async () => {
      const c = live(5)
      await dismiss(c, 'Card 3')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Dismiss: Card 4')
    })

    it('moves to the toggle when the last open card goes and others stay hidden', async () => {
      const c = live(5)
      toggle(c)!.click()
      await dismiss(c, 'Card 5')
      expect(titles(c)).toHaveLength(4)
      expect(document.activeElement).toBe(toggle(c))
    })

    it('moves to the card before when the last card goes and nothing is hidden', async () => {
      const c = live(2)
      await dismiss(c, 'Card 2')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Dismiss: Card 1')
    })

    it('hands focus back to the page when the last card goes', async () => {
      const onEmpty = vi.fn()
      const c = live(1, onEmpty)
      await dismiss(c, 'Card 1')
      expect(onEmpty).toHaveBeenCalled()
    })
  })

  it('sends a card link to the page it names', () => {
    const onOpen = vi.fn()
    const c = mount(() => <AdviceList cards={cards(1)} onOpen={onOpen} onDismiss={vi.fn()} />)
    ;(c.querySelector('[data-advice-card] button') as HTMLButtonElement).click()
    expect(onOpen).toHaveBeenCalledWith('budgets')
  })
})
