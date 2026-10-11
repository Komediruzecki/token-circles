/**
 * "Delete Categories" in the Danger Zone resets a profile's categories to the defaults. Food is no
 * longer one of them: the reset renames it to Groceries and keeps its entries
 * (shared/defaultCategories.ts), so the confirmation says so before anyone agrees to it.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import DangerZone from '../DangerZone'

let dispose: (() => void) | undefined
let host: HTMLDivElement

afterEach(() => {
  dispose?.()
  host.remove()
})

describe('the categories reset in the Danger Zone', () => {
  it('says, before it runs, that Food becomes Groceries and keeps its entries', () => {
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
    const open = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete Categories'
    )
    expect(open).toBeDefined()
    open!.click()
    expect(host.textContent).toContain('Food becomes Groceries and keeps its entries.')
  })
})
