/**
 * "Reset Categories" in the Danger Zone resets a profile's categories to the defaults. Food is no
 * longer one of them: the reset renames it to Groceries with its entries and budgets, and folds a
 * Groceries the person made into it (shared/defaultCategories.ts), so the confirmation says so
 * before anyone agrees to it.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import DangerZone from '../DangerZone'

let dispose: (() => void) | undefined
let host: HTMLDivElement

function mount(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <DangerZone
        profiles={[{ id: 1, name: 'Home' }]}
        onReset={async () => {}}
        onDeleteProfile={async () => {}}
      />
    ),
    host
  )
}

const button = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)

afterEach(() => {
  dispose?.()
  host.remove()
})

describe('the categories reset in the Danger Zone', () => {
  it('says, before it runs, that Food becomes Groceries and takes in a Groceries already there', () => {
    mount()
    const open = button('Reset Categories')
    expect(open).toBeDefined()
    open!.click()
    const text = host.textContent?.replace(/\s+/g, ' ')
    expect(text).toContain('Food becomes Groceries and keeps its entries and budgets.')
    expect(text).toContain(
      'A Groceries you already have becomes part of it, and budgets for the same period are added together.'
    )
  })

  it('calls the action a reset from its title to the button that runs it', () => {
    mount()
    // The item: its title, what it does, and the button that asks first.
    const item = button('Reset Categories')!.closest('div') as HTMLElement
    const before = item.textContent!.replace(/\s+/g, ' ')
    expect(before).toContain('Reset Categories')
    expect(before).not.toMatch(/Delete/)

    button('Reset Categories')!.click()
    const confirm = button('Yes, Reset Categories')!.closest('div')!.parentElement as HTMLElement
    const asked = confirm.textContent!.replace(/\s+/g, ' ')
    expect(asked).toContain('Reset all categories for "Home"?')
    expect(asked).not.toMatch(/Delete/)
  })
})
