/**
 * What the quick entries say when a save finds a list that is no longer the active profile's.
 *
 * A save files the entry under the active profile as it is now, and refuses a category or an
 * account of any other: a switch made in another tab leaves the lists open here belonging to the
 * profile before it. Each quick entry checks before it saves, reads again, and says what to do.
 * It used to say "That category isn't in this profile anymore. Pick one again." when only the
 * accounts were out of date, and threw away the category the person had picked.
 *
 * The lists here are stand-ins whose state the test sets.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandBar } from '../CommandBar'
import { GuidedOrbit } from '../GuidedOrbit'
import type { QuickEntryList, QuickEntryListStatus } from '../../core/quickEntryLists'
import type { Account, Category } from '../../types/models'

const toast = vi.fn()
const createTransaction = vi.fn(async (body: Record<string, unknown>) => ({ id: 1, ...body }))

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: (...args: unknown[]) => toast(...args),
  api: { createTransaction: (body: Record<string, unknown>) => createTransaction(body) },
}))

/** A list whose state the test sets, current for the active profile or not. */
function standIn<T>(items: T[], current = true, status: QuickEntryListStatus = 'ready') {
  const [state, setState] = createSignal(status)
  const reload = vi.fn(() => setState('loading'))
  const list: QuickEntryList<T> = {
    items: () => (state() === 'ready' ? items : []),
    status: state,
    profileId: () => (current ? 1 : 2),
    isCurrent: () => state() === 'ready' && current,
    reload,
  }
  return { list, reload }
}

const GROCERIES = {
  id: 11,
  name: 'Groceries',
  type: 'expense',
  color: '#22c55e',
  profile_id: 1,
} as unknown as Category
const JOINT = { id: 41, name: 'Joint', type: 'giro', profile_id: 2 } as unknown as Account

const ACCOUNT_LINE =
  "That account isn't in this profile anymore. Check the account and add it again."
const CATEGORY_LINE = "That category isn't in this profile anymore. Pick one again."

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  toast.mockClear()
  createTransaction.mockClear()
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

const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
  )

async function orbAtConfirm(
  categories: QuickEntryList<Category>,
  accounts: QuickEntryList<Account>
) {
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
  button('5')!.click()
  button('Next')!.click()
  await flush()
  host.querySelector<HTMLElement>('[data-test-id="orbit-category"]')!.click()
  await flush()
}

const addButton = () =>
  Array.from(host.querySelectorAll('button')).find((b) => /^Add /.test(b.textContent?.trim() ?? ''))

describe('the orb, when only its accounts are out of date', () => {
  it('says so about the account, keeps the category, and stays on the confirm step', async () => {
    const cats = standIn([GROCERIES])
    const accts = standIn([JOINT], false)
    await orbAtConfirm(cats.list, accts.list)

    addButton()!.click()
    await flush()

    expect(createTransaction).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(ACCOUNT_LINE, 'error')
    expect(accts.reload).toHaveBeenCalledTimes(1)
    expect(cats.reload).not.toHaveBeenCalled()
    expect(addButton()).toBeDefined()
    expect(host.textContent).toContain('Groceries')
  })

  it('still asks for the category again when the categories are out of date', async () => {
    const cats = standIn([GROCERIES], false)
    const accts = standIn([JOINT], false)
    await orbAtConfirm(cats.list, accts.list)

    addButton()!.click()
    await flush()

    expect(createTransaction).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(CATEGORY_LINE, 'error')
  })

  it('says the accounts did not load in a full sentence', async () => {
    await orbAtConfirm(standIn([GROCERIES]).list, standIn<Account>([], true, 'error').list)

    expect(host.textContent).toContain("Didn't load. Tap to try again.")
  })
})

describe('the command bar, when only its accounts are out of date', () => {
  it('says so about the account, and keeps the category', async () => {
    const cats = standIn([GROCERIES])
    const accts = standIn([JOINT], false)
    dispose = render(
      () => (
        <CommandBar
          isOpen={() => true}
          onClose={() => {}}
          categories={cats.list}
          accounts={accts.list}
          onSave={() => {}}
        />
      ),
      host
    )
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Quick entry"]')!
    input.value = 'coffee 5 groceries'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()

    expect(createTransaction).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(ACCOUNT_LINE, 'error')
    expect(accts.reload).toHaveBeenCalledTimes(1)
    expect(cats.reload).not.toHaveBeenCalled()
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Category"]')!
    expect(select.options[select.selectedIndex]?.textContent).toBe('Groceries')
  })
})
