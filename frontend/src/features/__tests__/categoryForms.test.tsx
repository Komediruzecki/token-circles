/**
 * The four category dialogs, run against the real local-first router on fake-indexeddb.
 *
 * Categories, Budgets, and the "+ Add Category" dialogs inside the Bills and Goals forms all create
 * categories, and each answered a refused save the same way: a toast saying the save failed, with
 * the dialog still open and nothing in it marked. On local-first a blank icon was refused outright,
 * so "Failed to save category" was all anyone saw (fixed on #599). An empty name was worse in a
 * different way: the browser's own bubble, in the browser's words.
 *
 * Now the dialog checks the values with the rules both runtimes run, marks the field in its own
 * words, and puts a server's reason (a name already taken) under the same field. No failure toast.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import type { Component } from 'solid-js'

vi.mock('../../components/Chart', () => ({ default: () => null }))

interface Surface {
  page: Parameters<typeof setPage>[0]
  module: string
  /** Opens the category dialog from wherever this page offers it. */
  open: () => Promise<void>
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

const byText = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text
  )

async function clickWhenThere(find: () => HTMLElement | null | undefined): Promise<void> {
  let el: HTMLElement | null | undefined
  await vi.waitFor(() => {
    el = find()
    expect(el).toBeTruthy()
  })
  el!.click()
}

const SURFACES: Surface[] = [
  {
    page: 'categories',
    module: '../Categories',
    open: () =>
      clickWhenThere(() => host.querySelector<HTMLElement>('[data-test-id="add-category-btn"]')),
  },
  {
    page: 'budgets',
    module: '../Budgets',
    open: () => clickWhenThere(() => byText('Add Category')),
  },
  {
    page: 'bills',
    module: '../Bills',
    open: async () => {
      await clickWhenThere(() => host.querySelector<HTMLElement>('[data-test-id="add-bill-btn"]'))
      await clickWhenThere(() => byText('+ Add Category'))
    },
  },
  {
    page: 'goals',
    module: '../Goals',
    open: async () => {
      await clickWhenThere(() => host.querySelector<HTMLElement>('[data-test-id="add-goal-btn"]'))
      await clickWhenThere(() => byText('+ Add Category'))
    },
  },
]

beforeAll(async () => {
  // Paid here, not inside the first test's waitFor: the pages and the router `apiFetch` loads on
  // the first request are heavy imports, and a loaded machine made them outlast a timeout.
  await Promise.all([
    ...SURFACES.map((s) => import(/* @vite-ignore */ s.module)),
    import('../../core/storage/localApiRouter'),
  ])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: 1,
    profile_id: 1,
    name: 'Groceries',
    type: 'expense',
    color: '#59d2a2',
    icon: 'cart',
    parent_id: null,
    tax_deductible: false,
    created_at: '2026-01-01T00:00:00.000Z',
  })
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
})

async function mount(surface: Surface): Promise<void> {
  setPage(surface.page)
  const { default: Page } = (await import(/* @vite-ignore */ surface.module)) as {
    default: Component
  }
  dispose = render(() => <Page />, host)
  await surface.open()
}

/** The category dialog's name field, found by its label as a person would. */
function nameField(): HTMLInputElement {
  const label = Array.from(host.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === 'Category Name'
  )
  if (!label) throw new Error('no Category Name field on the page')
  return label.parentElement!.querySelector('input')!
}

const dialogForm = () => nameField().closest('form')!

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submitDialog(): void {
  dialogForm().querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const storedNames = async (): Promise<string[]> =>
  ((await (await getDB()).getAll('categories')) as { name: string }[]).map((c) => c.name).sort()

const errorToasts = () => toasts().filter((t) => t.type === 'error')
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe.each(SURFACES)('the category dialog on $page', (surface) => {
  it('marks an empty name in its own words, focuses it, and sends nothing', async () => {
    await mount(surface)

    submitDialog()
    await settle()

    const name = nameField()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(name)).toContain('Give the category a name.')
    expect(document.activeElement).toBe(name)
    expect(await storedNames()).toEqual(['Groceries'])
    expect(errorToasts()).toEqual([])
  })

  it('lets the message go as soon as the name is typed', async () => {
    await mount(surface)
    submitDialog()
    await settle()

    type(nameField(), 'C')

    expect(nameField().getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(nameField())).not.toContain('Give the category a name.')
  })

  it('puts a taken name under the name field, in the words the router answered with', async () => {
    await mount(surface)

    type(nameField(), ' groceries ')
    submitDialog()

    await vi.waitFor(() => {
      expect(nameField().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(nameField())).toContain(
      'You already have a category called "Groceries". Choose another name.'
    )
    expect(await storedNames()).toEqual(['Groceries'])
    expect(errorToasts()).toEqual([])
  })

  it('saves a category with no icon picked, stored with the default icon', async () => {
    await mount(surface)

    type(nameField(), 'Coffee')
    submitDialog()

    await vi.waitFor(async () => {
      expect(await storedNames()).toEqual(['Coffee', 'Groceries'])
    })
    const rows = (await (await getDB()).getAll('categories')) as { name: string; icon: string }[]
    expect(rows.find((r) => r.name === 'Coffee')?.icon).toBe('tag')
    await vi.waitFor(() => {
      expect(
        Array.from(host.querySelectorAll('label')).some(
          (l) => l.textContent?.trim() === 'Category Name'
        )
      ).toBe(false)
    })
    expect(errorToasts()).toEqual([])
    expect(successToasts()).toEqual(['Added "Coffee" to your categories.'])
  })
})
