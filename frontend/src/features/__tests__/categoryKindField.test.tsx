/**
 * Kind and "Needed every month" in the Categories dialog, run against the real local-first router
 * on fake-indexeddb.
 *
 * The dialog shows what is stored and what the app makes of it. Kind's empty choice is "no kind
 * stored", labelled with the kind the app then goes by (the name's guess, or the parent's), and
 * "Needed every month" follows the kind shown, or that guess, until the person changes it. A save
 * stores what the person chose and nothing else, and reopening shows what was saved. An edit sends
 * a kind or a choice only when the person changed it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { essentialOf } from '../../../../shared/guidance/kinds'
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
/** The words of the Kind field's chosen option. */
const kindShown = () => kindField()!.selectedOptions[0]?.textContent?.trim()
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
  it('says the kind the name gives as it is typed, and ticks what that kind needs', async () => {
    await mount('categories', '../Categories')
    await addCategory()

    type(labelled('Category Name') as HTMLInputElement, 'Restaurant')
    expect(kindField()!.value).toBe('')
    expect(kindShown()).toBe('From the name: Eating out')
    expect(neededBox()!.checked).toBe(false)

    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    expect(kindShown()).toBe('From the name: Housing')
    expect(neededBox()!.checked).toBe(true)

    // A name that gives no kind counts as needed every month. The Kind field says only that there
    // is none yet: the words under the box say why it is ticked, once.
    type(labelled('Category Name') as HTMLInputElement, 'Market')
    expect(kindShown()).toBe('None yet')
    expect(neededBox()!.checked).toBe(true)
    const saying = [kindShown(), kindHelp(), guessLine()].filter((words) =>
      words?.toLowerCase().includes('needed every month')
    )
    expect(saying).toEqual([
      "Ticked while it has no kind. Untick it if this one isn't needed every month.",
    ])
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
    expect(kindField()!.value).toBe('')
    expect(kindShown()).toBe('From the name: Groceries')
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
    expect(kindField()!.value).toBe('')
    expect(kindShown()).toBe('From the parent: Groceries')
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

/** The Kind field's help: the hint its select is described by. */
const kindHelp = () => {
  const ids = kindField()!.getAttribute('aria-describedby') ?? ''
  return ids
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .join(' ')
}
/** What "Needed every month" is described by, as a screen reader reads it with the box. */
const neededDescription = () =>
  (neededBox()!.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .join(' ')
/** The words that say why "Needed every month" is ticked or not, if they show. */
const guessLine = () => {
  const line = host.querySelector('[data-test-id="category-essential-guess"]')
  if (!line) return null
  // Read out with the box: the last sentences of its one hint.
  const ids = neededBox()!.getAttribute('aria-describedby')?.split(' ') ?? []
  expect(ids).toHaveLength(1)
  expect(document.getElementById(ids[0])!.contains(line)).toBe(true)
  expect(neededDescription().endsWith(` ${line.textContent!.trim()}`)).toBe(true)
  return line.textContent?.trim()
}

describe('the Categories dialog says where its guesses come from', () => {
  it('says why "Needed every month" is ticked or not, following the kind', async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    expect(guessLine()).toBe(
      "Ticked to match its kind, Housing. Untick it if this one isn't needed every month."
    )
    // One hint: what the box means, then why it is ticked.
    expect(neededDescription()).toBe(
      "Spending you'd have whatever happens, like rent or groceries. Ticked to match its kind, Housing. Untick it if this one isn't needed every month."
    )
    type(labelled('Category Name') as HTMLInputElement, 'Restaurant')
    expect(guessLine()).toBe(
      'Unticked to match its kind, Eating out. Tick it if this one is needed every month.'
    )
    type(labelled('Category Name') as HTMLInputElement, 'Market')
    expect(guessLine()).toBe(
      "Ticked while it has no kind. Untick it if this one isn't needed every month."
    )
    // The kind picked is the one named.
    type(kindField()!, 'eating_out')
    expect(guessLine()).toBe(
      'Unticked to match its kind, Eating out. Tick it if this one is needed every month.'
    )
  })

  it('drops the line once the box is changed, and for a stored choice', async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    expect(guessLine()).not.toBeNull()
    tick(neededBox()!, false)
    expect(guessLine()).toBeNull()
    expect(neededDescription()).toBe(
      "Spending you'd have whatever happens, like rent or groceries."
    )
    // A kind picked after that leaves the box, and the line, as they are.
    type(kindField()!, 'groceries')
    expect(neededBox()!.checked).toBe(false)
    expect(guessLine()).toBeNull()
    dispose?.()

    const db = await getDB()
    await db.put('categories', { ...FOOD, kind: null, essential: 0 })
    await mount('categories', '../Categories')
    await editCategory('Food')
    expect(neededBox()!.checked).toBe(false)
    expect(guessLine()).toBeNull()
  })

  it('shows the line for a stored kind with no stored choice', async () => {
    const db = await getDB()
    await db.put('categories', { ...FOOD, kind: 'eating_out' })
    await mount('categories', '../Categories')
    await editCategory('Food')
    expect(guessLine()).toBe(
      'Unticked to match its kind, Eating out. Tick it if this one is needed every month.'
    )
  })

  it("says where the Kind field's empty choice comes from", async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Rent')
    expect(kindHelp()).toBe(
      "What this category holds. Until you pick one, it's guessed from the name."
    )
    type(labelled('Category Name') as HTMLInputElement, 'Market')
    expect(kindShown()).toBe('None yet')
    expect(kindHelp()).toBe(
      "What this category holds. The name doesn't suggest one, so pick the closest."
    )
    type(kindField()!, 'housing')
    expect(kindHelp()).toBe('What this category holds.')
    dispose?.()

    await mount('categories', '../Categories')
    await editCategory('Bakery')
    expect(kindShown()).toBe('From the parent: Groceries')
    expect(kindHelp()).toBe(
      'What this category holds. Until you pick one, it follows the parent category.'
    )
  })
})

describe('what the Categories dialog shows is what it stores', () => {
  /** What the app makes of `name` as stored: the kind it goes by and the box (essentialOf). */
  async function readBack(name: string) {
    const row = await stored(name)
    expect(row, `no category called ${name}`).toBeDefined()
    return essentialOf({ ...row, type: 'expense' })
  }

  it('saves a name the guess goes by as no kind, and reopens it as it was shown', async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Coffee beans')
    // Picking a kind and then the guess again: the box follows each.
    type(kindField()!, 'housing')
    expect(neededBox()!.checked).toBe(true)
    type(kindField()!, '')
    expect(kindShown()).toBe('From the name: Eating out')
    expect(neededBox()!.checked).toBe(false)
    save()
    await vi.waitFor(async () => {
      expect(await choice('Coffee beans')).toEqual({ kind: null, essential: null })
    })
    expect(await readBack('Coffee beans')).toMatchObject({ kind: 'eating_out', essential: false })

    await editCategory('Coffee beans')
    expect(kindShown()).toBe('From the name: Eating out')
    expect(neededBox()!.checked).toBe(false)
  })

  it('stores a box the person ticked with no kind, and reopens it ticked', async () => {
    await mount('categories', '../Categories')
    await addCategory()
    type(labelled('Category Name') as HTMLInputElement, 'Coffee beans')
    tick(neededBox()!, true)
    save()
    await vi.waitFor(async () => {
      expect(await choice('Coffee beans')).toEqual({ kind: null, essential: 1 })
    })
    expect(await readBack('Coffee beans')).toMatchObject({ essential: true, via: 'chosen' })
    await editCategory('Coffee beans')
    expect(kindField()!.value).toBe('')
    expect(neededBox()!.checked).toBe(true)
  })

  it('on an edit, stores a box changed back to how it opened when the new kind says otherwise', async () => {
    const db = await getDB()
    await db.put('categories', { ...FOOD, name: 'Coffee' })
    await mount('categories', '../Categories')
    await editCategory('Coffee')
    expect(neededBox()!.checked).toBe(false)
    // Housing ticks the box; unticked, it is as it opened, but Housing alone would read ticked.
    type(kindField()!, 'housing')
    expect(neededBox()!.checked).toBe(true)
    tick(neededBox()!, false)
    save()
    await vi.waitFor(async () => {
      expect(await choice('Coffee')).toEqual({ kind: 'housing', essential: 0 })
    })
    await editCategory('Coffee')
    expect(kindField()!.value).toBe('housing')
    expect(neededBox()!.checked).toBe(false)
  })
})

describe('an edit', () => {
  it('keeps a kind only a later build knows, and the choice, when it changes the colour', async () => {
    const db = await getDB()
    await db.put('categories', { ...FOOD, kind: 'pets', essential: 1 })
    await mount('categories', '../Categories')
    await editCategory('Food')
    // This build goes by the name's guess for a kind it does not know.
    expect(kindField()!.value).toBe('')
    expect(neededBox()!.checked).toBe(true)
    const swatch = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-test-id="category-color-swatch"]')
    ).find((b) => b.title !== FOOD.color)!
    swatch.click()
    save()
    await vi.waitFor(async () => {
      expect(await stored('Food')).toMatchObject({
        color: swatch.title,
        kind: 'pets',
        essential: 1,
      })
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
