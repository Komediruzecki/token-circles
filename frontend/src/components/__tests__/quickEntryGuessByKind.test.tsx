/**
 * The Command Bar guesses a category by its kind (core/entry/parseEntry.ts): "coffee" lands in
 * whatever category holds eating out, whatever it is called. The bar hands the parser each
 * category's kind and parent, without which a profile on the new defaults (no Food) got no guess
 * for coffee, lunch or groceries, and Save stayed disabled until a category was picked.
 *
 * Its placeholder's examples each get a category on the default categories.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEntry } from '../../core/entry/parseEntry'
import { DEFAULT_CATEGORIES } from '../../core/storage/idb'
import { CommandBar } from '../CommandBar'
import type { QuickEntryList } from '../../core/quickEntryLists'
import type { Account, Category } from '../../types/models'

const createTransaction = vi.fn()

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: () => {},
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

const category = (over: Partial<Category>) =>
  ({ type: 'expense', color: '#22c55e', profile_id: 1, parent_id: null, ...over }) as Category

const EVERYDAY = { id: 41, name: 'Everyday', type: 'giro', profile_id: 1 } as unknown as Account

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  createTransaction.mockReset()
  createTransaction.mockResolvedValue({ id: 1 })
  localStorage.setItem('currentProfileId', '1')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
})

function open(categories: Category[]): HTMLInputElement {
  dispose = render(
    () => (
      <CommandBar
        isOpen={() => true}
        onClose={() => {}}
        categories={current(categories)}
        accounts={current([EVERYDAY])}
        onSave={() => {}}
      />
    ),
    host
  )
  return host.querySelector<HTMLInputElement>('input[aria-label="Quick entry"]')!
}

async function enter(input: HTMLInputElement, text: string): Promise<void> {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flush()
  await flush()
}

describe('the Command Bar', () => {
  it('files coffee under the category that holds eating out, whatever its name', async () => {
    const input = open([
      category({ id: 11, name: 'Namirnice', kind: 'groceries' }),
      category({ id: 12, name: 'Kafići', kind: 'eating_out' }),
    ])
    await enter(input, 'coffee 4.50')
    expect(createTransaction).toHaveBeenCalledTimes(1)
    expect(createTransaction.mock.calls[0][0]).toMatchObject({ amount: 4.5, category_id: 12 })
  })

  it("files groceries under a child that goes by its parent's kind", async () => {
    const input = open([
      category({ id: 21, name: 'Wochenmarkt', kind: null, parent_id: 22 }),
      category({ id: 22, name: 'Einkauf', kind: 'groceries' }),
    ])
    await enter(input, 'grocery 18')
    expect(createTransaction.mock.calls[0][0]).toMatchObject({ category_id: 21 })
  })

  it('has a placeholder whose examples each get a category on the defaults', () => {
    const input = open([])
    const examples = [...input.placeholder.matchAll(/“([^”]+)”/g)].map((m) => m[1])
    expect(examples.length).toBeGreaterThan(1)
    const defaults = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: i + 1, parent_id: null }))
    for (const example of examples) {
      expect(parseEntry(example, { categories: defaults }).categoryGuess, example).not.toBeNull()
    }
  })
})
