/**
 * The quick entries' "try again" controls, for keyboard and screen-reader users.
 *
 * A retry control goes away, or turns inactive, the moment it is used: the list is loading again.
 * A focused control that leaves the page, or turns disabled, drops focus to the page itself, and a
 * keyboard or screen-reader user starts again from the top. The orb's category states were nodes
 * inserted with their text already in them (role="status"), which a screen reader does not
 * announce. And the command bar's retry was named "retry", with nothing to say what it retries.
 *
 * The lists here are stand-ins whose state the test sets; the real ones are covered with the real
 * App in src/__tests__/quickEntryOffersActiveProfile.test.tsx.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandBar } from '../CommandBar'
import { GuidedOrbit } from '../GuidedOrbit'
import type { QuickEntryList, QuickEntryListStatus } from '../../core/quickEntryLists'
import type { Account, Category } from '../../types/models'

/** A list whose state the test sets. A reload starts a read, so it is loading again. */
function standIn<T>(status: QuickEntryListStatus, items: T[]) {
  const [state, setState] = createSignal(status)
  const reload = vi.fn(() => setState('loading'))
  const list: QuickEntryList<T> = {
    items: () => (state() === 'ready' ? items : []),
    status: state,
    profileId: () => 1,
    isCurrent: () => state() === 'ready',
    reload,
  }
  return { list, setState, reload }
}

const GROCERIES = {
  id: 11,
  name: 'Groceries',
  type: 'expense',
  color: '#22c55e',
  profile_id: 1,
} as unknown as Category
const MAIN = { id: 31, name: 'Main', type: 'giro', profile_id: 1 } as unknown as Account

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.setItem('currentProfileId', '1')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.clear()
})

// ---- The Guided Orbit -------------------------------------------------------------------------

function mountOrb(categories: QuickEntryList<Category>, accounts: QuickEntryList<Account>) {
  dispose = render(
    () => (
      <GuidedOrbit
        isOpen={() => true}
        onClose={() => {}}
        categories={categories}
        accounts={accounts}
        onSave={() => {}}
      />
    ),
    host
  )
}

const orbButton = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
  )

async function toCategoryStep() {
  orbButton('5')!.click()
  orbButton('Next')!.click()
  await flush()
}

const categoryStatus = () =>
  host.querySelector<HTMLElement>('[data-test-id="orbit-categories-status"]')

describe('the orb', () => {
  it('announces the category states from a live region that was on the page before them', async () => {
    const cats = standIn<Category>('loading', [])
    mountOrb(cats.list, standIn<Account>('ready', [MAIN]).list)

    // Step 1: the region is there already, empty.
    const region = categoryStatus()
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.textContent).toBe('')

    await toCategoryStep()
    expect(categoryStatus()).toBe(region)
    expect(region!.textContent).toContain('Loading your categories…')
    expect(host.querySelector('[role="status"], [role="alert"]')).toBeNull()

    cats.setState('error')
    await flush()
    expect(categoryStatus()).toBe(region)
    expect(region!.textContent).toContain("Your categories didn't load.")
  })

  it('keeps focus in the orb when its "Try again" is pressed from the keyboard', async () => {
    const cats = standIn<Category>('error', [])
    mountOrb(cats.list, standIn<Account>('ready', [MAIN]).list)
    await toCategoryStep()
    const retry = orbButton('Try again')!

    retry.focus()
    retry.click()
    await flush()

    expect(cats.reload).toHaveBeenCalledTimes(1)
    expect(retry.isConnected).toBe(false)
    expect(document.activeElement).toBe(categoryStatus())
  })

  it('keeps focus on the account row while its accounts read again', async () => {
    const accts = standIn<Account>('error', [])
    mountOrb(standIn<Category>('ready', [GROCERIES]).list, accts.list)
    await toCategoryStep()
    host.querySelector<HTMLElement>('[data-test-id="orbit-category"]')!.click()
    await flush()
    const row = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Account')
    )!

    row.focus()
    row.click()
    await flush()

    expect(accts.reload).toHaveBeenCalledTimes(1)
    // A disabled control drops focus to the page: this one says it is inactive instead.
    expect(row.disabled).toBe(false)
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(row)
  })
})

// ---- The command bar --------------------------------------------------------------------------

describe('the command bar', () => {
  it('names its retry, and leaves focus on the category picker once it has gone', async () => {
    const cats = standIn<Category>('error', [])
    dispose = render(
      () => (
        <CommandBar
          isOpen={() => true}
          onClose={() => {}}
          categories={cats.list}
          accounts={standIn<Account>('ready', [MAIN]).list}
          onSave={() => {}}
        />
      ),
      host
    )
    // The bar focuses its input once it opens.
    await new Promise((r) => setTimeout(r, 80))
    const retry = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry loading categories"]'
    )
    expect(retry).not.toBeNull()

    retry!.focus()
    retry!.click()
    await flush()

    expect(cats.reload).toHaveBeenCalledTimes(1)
    expect(retry!.isConnected).toBe(false)
    expect(document.activeElement).toBe(host.querySelector('select[aria-label="Category"]'))
  })
})
