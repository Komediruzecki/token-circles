/**
 * The Tags page's name and colour form, run against the real local-first router on
 * fake-indexeddb.
 *
 * An empty name used to return without a word, and a refused save (a name another tag has)
 * toasted whatever the runtime said, with nothing in the form marked. Now the form checks the
 * values with the rules both runtimes run (shared/tagSchema.ts) and marks the field in their
 * words, and a name the runtime refuses is marked the same way. An edit checks only what it
 * changes, so a tag saved under older rules can still be edited.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSTELLATION } from '../../../../shared/palette'
import { TAG_MESSAGES as M } from '../../../../shared/tagSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

vi.mock('../../components/Chart', () => ({ default: () => null }))

const TRIP = 1
const OLD = 2 // a name over 50 characters and the colour "red", stored before the rules
const LONG_NAME = 'Weekend trips to the coast with the family '.repeat(2).trim()

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Tags'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.add('tags', { id: TRIP, profile_id: 1, name: 'Trip', color: '#22aa66' } as never)
  await db.add('tags', { id: OLD, profile_id: 1, name: LONG_NAME, color: 'red' } as never)
  for (const toast of toasts()) removeToast(toast.id)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  setPage('tags')
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

async function mountPage(): Promise<void> {
  const { default: Tags } = await import('../Tags')
  dispose = render(() => <Tags />, host)
  await vi.waitFor(() => {
    expect(host.querySelector(`[data-test-id="tag-card-${TRIP}"]`)).not.toBeNull()
  })
}

const form = () => host.querySelector<HTMLFormElement>('[data-test-id="tag-form"]')

function button(text: string, within: HTMLElement = host): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text
  )
  if (!found) throw new Error(`no ${text} button`)
  return found
}

async function openNew(): Promise<void> {
  button('+ New tag').click()
  await vi.waitFor(() => {
    expect(form()).not.toBeNull()
  })
}

async function openEdit(id: number): Promise<void> {
  const card = host.querySelector<HTMLElement>(`[data-test-id="tag-card-${id}"]`)!
  button('Edit', card).click()
  await vi.waitFor(() => {
    expect(form()).not.toBeNull()
  })
}

/** The control under the label that starts with `text`, as a person finds it. */
function field(text: string): HTMLInputElement {
  const label = Array.from(form()!.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field`)
  return label.parentElement!.querySelector<HTMLInputElement>('input')!
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submit(): void {
  form()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function tags(): Promise<Row[]> {
  return (await (await getDB()).getAll('tags')) as Row[]
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('creating a tag', () => {
  it('marks an empty name in its words, focuses it, and sends nothing', async () => {
    await mountPage()
    await openNew()

    submit()
    await settle()

    const name = field('Tag name')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(name)).toBe(M.name)
    expect(document.activeElement).toBe(name)
    expect(await tags()).toHaveLength(2)
    expect(failureToasts()).toEqual([])
  })

  it('takes the mark away once the name is given', async () => {
    await mountPage()
    await openNew()
    submit()
    await settle()

    type(field('Tag name'), 'Groceries')

    expect(field('Tag name').getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(field('Tag name'))).toBe('')
  })

  it('marks a name another tag has in another case, as the runtime refuses it, and keeps the form open', async () => {
    await mountPage()
    await openNew()
    type(field('Tag name'), 'trip')

    submit()

    const taken = 'You already have a tag called "Trip". Choose another name.'
    await vi.waitFor(() => {
      expect(describedBy(field('Tag name'))).toBe(taken)
    })
    expect(field('Tag name').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Tag name'))
    expect(form()).not.toBeNull()
    expect(await tags()).toHaveLength(2)
    expect(failureToasts()).toEqual([])
  })

  it('adds a tag in the colour the form starts on, says so, closes and selects it', async () => {
    await mountPage()
    await openNew()
    type(field('Tag name'), ' Groceries ')

    submit()

    await vi.waitFor(async () => {
      // Two tags already: the palette's third, the colour a tag sent without one gets.
      expect((await tags()).find((t) => t.name === 'Groceries')).toMatchObject({
        color: CONSTELLATION[2],
      })
    })
    await vi.waitFor(() => {
      expect(form()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "Groceries" to your tags.'])
    expect(failureToasts()).toEqual([])
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Rules for Groceries')
    })
  })
})

describe('editing a tag', () => {
  it('saves a new name and colour, and names it in the toast', async () => {
    await mountPage()
    await openEdit(TRIP)
    expect(field('Tag name').value).toBe('Trip')
    type(field('Tag name'), 'Holiday')
    form()!
      .querySelector<HTMLButtonElement>(`[aria-label="Use color ${CONSTELLATION[3]}"]`)!
      .click()

    submit()

    await vi.waitFor(async () => {
      expect(await (await getDB()).get('tags', TRIP)).toMatchObject({
        name: 'Holiday',
        color: CONSTELLATION[3],
      })
    })
    await vi.waitFor(() => {
      expect(form()).toBeNull()
    })
    expect(successToasts()).toEqual(['Saved your changes to "Holiday".'])
  })

  it('marks a name the edit empties, and saves nothing', async () => {
    await mountPage()
    await openEdit(TRIP)
    type(field('Tag name'), '  ')

    submit()
    await settle()

    expect(describedBy(field('Tag name'))).toBe(M.name)
    expect(document.activeElement).toBe(field('Tag name'))
    expect(await (await getDB()).get('tags', TRIP)).toMatchObject({ name: 'Trip' })
    expect(failureToasts()).toEqual([])
  })

  it('recolours a tag kept under older rules, checking only what changed', async () => {
    await mountPage()
    await openEdit(OLD)
    expect(field('Tag name').value).toBe(LONG_NAME)
    form()!
      .querySelector<HTMLButtonElement>(`[aria-label="Use color ${CONSTELLATION[1]}"]`)!
      .click()

    submit()

    await vi.waitFor(async () => {
      expect(await (await getDB()).get('tags', OLD)).toMatchObject({
        name: LONG_NAME,
        color: CONSTELLATION[1],
      })
    })
    expect(failureToasts()).toEqual([])
  })
})
