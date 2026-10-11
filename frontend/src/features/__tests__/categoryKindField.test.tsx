/**
 * Kind and "Needed every month" in the Categories dialog, run against the real local-first router
 * on fake-indexeddb.
 *
 * Both start from the guess the app goes by when nothing is stored: the kind the name suggests (or
 * the parent's), and whether that kind is needed every month. The kind follows the name as it is
 * typed until the person picks one. A save stores what the person chose and nothing else: a guess
 * left alone is stored as no choice, so the app keeps going by the name.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import type { Component } from 'solid-js'

vi.mock('../../components/Chart', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Paid here: the page and the router are heavy imports for a loaded machine.
  await Promise.all([
    import('../Categories'),
    import('../Budgets'),
    import('../../core/storage/localApiRouter'),
  ])
}, 120_000)

const FOOD = {
  id: 1,
  profile_id: 1,
  name: 'Food',
  type: 'expense',
  color: '#59d2a2',
  icon: 'tag',
  parent_id: null,
  tax_deductible: false,
  created_at: '2026-01-01T00:00:00.000Z',
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', FOOD)
  await db.add('categories', { ...FOOD, id: 2, name: 'Bakery', parent_id: 1 })
  for (const toast of toasts()) removeToast(toast.id)
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount(page: 'categories' | 'budgets', module: string): Promise<void> {
  setPage(page)
  const { default: Page } = (await import(/* @vite-ignore */ module)) as { default: Component }
  dispose = render(() => <Page />, host)
}

async function clickWhenThere(find: () => HTMLElement | null | undefined): Promise<void> {
  let el: HTMLElement | null | undefined
  await vi.waitFor(() => {
    el = find()
    expect(el).toBeTruthy()
  })
  el!.click()
}

const addCategory = () =>
  clickWhenThere(() => host.querySelector<HTMLElement>('[data-test-id="add-category-btn"]'))

/** Opens the edit dialog of the category called `name`. */
async function editCategory(name: string): Promise<void> {
  await clickWhenThere(() => {
    const card = Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="category-name"]'))
      .find((el) => el.textContent?.trim() === name)
      ?.closest<HTMLElement>('[data-test-id="category-card"]')
    return card?.querySelector<HTMLElement>('[data-test-id="edit-category-btn"]')
  })
}

function labelled(text: string): HTMLInputElement | HTMLSelectElement {
  const label = Array.from(host.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text
  )
  if (!label) throw new Error(`no ${text} field on the page`)
  return document.getElementById(label.htmlFor) as HTMLInputElement
}

const kindField = () => host.querySelector<HTMLSelectElement>('[data-test-id="category-kind"]')
const neededBox = () => host.querySelector<HTMLInputElement>('[data-test-id="category-essential"]')

function type(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function tick(box: HTMLInputElement, checked: boolean): void {
  box.checked = checked
  box.dispatchEvent(new Event('change', { bubbles: true }))
}

function save(): void {
  labelled('Category Name')
    .closest('form')!
    .querySelector<HTMLButtonElement>('button[type="submit"]')!
    .click()
}

async function stored(name: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await (await getDB()).getAll('categories')) as Record<string, unknown>[]
  return rows.find((row) => row.name === name)
}

/** The kind and choice stored for `name`: a row from before kinds holds neither key. */
async function choice(name: string): Promise<{ kind: unknown; essential: unknown }> {
  const row = await stored(name)
  expect(row, `no category called ${name}`).toBeDefined()
  return { kind: row?.kind ?? null, essential: row?.essential ?? null }
}

describe('the Categories dialog', () => {
  it('guesses the kind from the name as it is typed, and ticks what that kind needs', async () => {
    await mount('categories', '../Categories')
    await addCategory()

    type(labelled('Category Name') as HTMLInputElement, 'Restaurant')
    expect(kindField()!.value).toBe('eating_out')
    expect(neededBox()!.checked).toBe(false)

    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    expect(kindField()!.value).toBe('housing')
    expect(neededBox()!.checked).toBe(true)
  })

  it('stores a guess left alone as no choice, so the app keeps going by the name', async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    save()

    await vi.waitFor(async () => {
      expect(await choice('Rent')).toEqual({ kind: null, essential: null })
    })
  })

  it('stores the kind picked, and a box the person changed', async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Market')
    expect(kindField()!.value).toBe('')
    expect(neededBox()!.checked).toBe(true)

    type(kindField()!, 'eating_out')
    // The box follows the kind picked until it is changed itself.
    expect(neededBox()!.checked).toBe(false)
    type(kindField()!, 'groceries')
    expect(neededBox()!.checked).toBe(true)
    tick(neededBox()!, false)
    // Picked, the kind no longer follows the name.
    type(labelled('Category Name') as HTMLInputElement, 'Market stall')
    expect(kindField()!.value).toBe('groceries')
    save()

    await vi.waitFor(async () => {
      expect(await stored('Market stall')).toMatchObject({ kind: 'groceries', essential: 0 })
    })
  })

  it("opens a category with no kind at the one it goes by, its parent's if its name says none", async () => {
    await mount('categories', '../Categories')
    await editCategory('Food')
    expect(kindField()!.value).toBe('groceries')
    expect(neededBox()!.checked).toBe(true)
    // An edit that leaves both alone stores no choice.
    type(labelled('Category Name') as HTMLInputElement, 'Food and drink')
    save()
    await vi.waitFor(async () => {
      expect(await choice('Food and drink')).toEqual({ kind: null, essential: null })
    })
  })

  it("guesses a child's kind from its parent", async () => {
    await mount('categories', '../Categories')
    await editCategory('Bakery')
    expect(kindField()!.value).toBe('groceries')
  })

  it('opens a stored kind and choice as they are, and keeps them on an edit', async () => {
    const db = await getDB()
    await db.put('categories', { ...FOOD, kind: 'eating_out', essential: 1 })
    await mount('categories', '../Categories')
    await editCategory('Food')
    expect(kindField()!.value).toBe('eating_out')
    expect(neededBox()!.checked).toBe(true)
    // A stored kind does not follow the name.
    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    expect(kindField()!.value).toBe('eating_out')
    save()
    await vi.waitFor(async () => {
      expect(await stored('Rent')).toMatchObject({ kind: 'eating_out', essential: 1 })
    })
  })

  it('shows neither for an income category, and clears both when one becomes income', async () => {
    const db = await getDB()
    await db.put('categories', { ...FOOD, kind: 'groceries', essential: 0 })
    await mount('categories', '../Categories')
    await editCategory('Food')
    type(labelled('Category Type'), 'income')
    expect(kindField()).toBeNull()
    expect(neededBox()).toBeNull()
    save()
    await vi.waitFor(async () => {
      expect(await stored('Food')).toMatchObject({ type: 'income', kind: null, essential: null })
    })
  })
})

describe('the category dialog on Budgets', () => {
  it('shows neither, and sends neither', async () => {
    await mount('budgets', '../Budgets')
    await clickWhenThere(() =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Add Category'
      )
    )
    expect(kindField()).toBeNull()
    expect(neededBox()).toBeNull()
    type(labelled('Category Name') as HTMLInputElement, 'Restaurant')
    save()
    await vi.waitFor(async () => {
      expect(await choice('Restaurant')).toEqual({ kind: null, essential: null })
    })
  })
})
