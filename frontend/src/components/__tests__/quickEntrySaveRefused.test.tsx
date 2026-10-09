/**
 * What the quick entries say when a save fails.
 *
 * Both toasted "Failed to save entry" for every failure, so an entry the API refused, an amount
 * with three decimals say, gave no hint of what to change. They now say the API's own words, and
 * a plain sentence for a failure that has none (plainMessage in core/apiError.ts).
 *
 * The lists here are stand-ins that are current for the active profile.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRANSACTION_MESSAGES } from '../../../../shared/transactionSchema'
import { ApiError } from '../../core/apiError'
import { CommandBar } from '../CommandBar'
import { GuidedOrbit } from '../GuidedOrbit'
import type { QuickEntryList } from '../../core/quickEntryLists'
import type { Account, Category } from '../../types/models'

const toast = vi.fn()
const createTransaction = vi.fn()

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: (...args: unknown[]) => toast(...args),
  api: { createTransaction: (body: Record<string, unknown>) => createTransaction(body) },
}))

function current<T>(items: T[]): QuickEntryList<T> {
  const [state] = createSignal<'ready'>('ready')
  return {
    items: () => items,
    status: state,
    profileId: () => 1,
    isCurrent: () => true,
    reload: () => {},
  }
}

const GROCERIES = {
  id: 11,
  name: 'Groceries',
  type: 'expense',
  color: '#22c55e',
  profile_id: 1,
} as unknown as Category
const EVERYDAY = { id: 41, name: 'Everyday', type: 'giro', profile_id: 1 } as unknown as Account

const REFUSED = new ApiError(400, TRANSACTION_MESSAGES.amountCents, {
  amount: TRANSACTION_MESSAGES.amountCents,
})
const FALLBACK = "Couldn't save the entry. Try again."

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  toast.mockClear()
  createTransaction.mockReset()
  localStorage.setItem('currentProfileId', '1')
  host = document.createElement('div')
  document.body.appendChild(host)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
})

const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
  )

async function saveFromTheCommandBar(): Promise<void> {
  dispose = render(
    () => (
      <CommandBar
        isOpen={() => true}
        onClose={() => {}}
        categories={current([GROCERIES])}
        accounts={current([EVERYDAY])}
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
  await flush()
}

async function saveFromTheOrb(): Promise<void> {
  dispose = render(
    () => (
      <GuidedOrbit
        isOpen={() => true}
        onClose={() => {}}
        categories={current([GROCERIES])}
        accounts={current([EVERYDAY])}
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
  Array.from(host.querySelectorAll('button'))
    .find((b) => /^Add /.test(b.textContent?.trim() ?? ''))!
    .click()
  await flush()
  await flush()
}

describe.each([
  ['the command bar', saveFromTheCommandBar],
  ['the orb', saveFromTheOrb],
])('%s, when a save fails', (_name, save) => {
  it("says the API's words for a refused entry", async () => {
    createTransaction.mockRejectedValue(REFUSED)
    await save()

    expect(createTransaction).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(TRANSACTION_MESSAGES.amountCents, 'error')
  })

  it('says a plain sentence for a failure with no words of its own', async () => {
    createTransaction.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'id')")
    )
    await save()

    expect(createTransaction).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(FALLBACK, 'error')
  })
})
