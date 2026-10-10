/**
 * The Housing page's "Add Housing Expense" dialog, run against the real local-first router on
 * fake-indexeddb.
 *
 * A refused save said "Failed to save housing expense" in a toast with nothing in the dialog
 * marked, the browser's own bubbles said the rest, and a due day that was not a number became the
 * 1st without a word. Now the dialog checks the values with the rules both runtimes run
 * (shared/housingSchema.ts) and marks the field in their words.
 *
 * Nothing about a housing expense is the runtime's alone to know (no link to another row, no name
 * that must be unique), so the one refusal the runtime makes that the dialog does not is a newer
 * runtime's: that case answers as the router would, with its words, through `apiPost`.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOUSING_MESSAGES as M } from '../../../../shared/housingSchema'
import { refusalOf } from '../../../../shared/refusal'
import { ApiError } from '../../core/apiError'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { localMonth } from '../../utils/period'
import type { apiPost as ApiPost } from '../../core/api'

/** Set to a refusal to have the next POST answer it, as a newer runtime would. */
const next = vi.hoisted(() => ({ refusal: null as null | Record<string, string> }))

vi.mock('../../core/api', async (importOriginal) => {
  const actual = await importOriginal<{ apiPost: typeof ApiPost }>()
  return {
    ...actual,
    apiPost: (url: string, body?: unknown) => {
      const fields = next.refusal
      next.refusal = null
      if (fields) return Promise.reject(new ApiError(400, refusalOf(fields).error, fields))
      return actual.apiPost(url, body)
    },
  }
})

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Housing'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  next.refusal = null
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  for (const toast of toasts()) removeToast(toast.id)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  setPage('housing')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

async function openDialog(): Promise<void> {
  const { default: Housing } = await import('../Housing')
  dispose = render(() => <Housing />, host)
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="housing-empty"]')).not.toBeNull()
  })
  host.querySelector<HTMLButtonElement>('[data-test-id="add-housing-btn"]')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

const dialog = () => host.querySelector<HTMLElement>('[data-test-id="housing-modal"]')

/** The control under the label that starts with `text`, as a person finds it. */
function field(text: string): HTMLInputElement {
  const label = Array.from(dialog()!.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field`)
  return label.parentElement!.querySelector<HTMLInputElement>('input, select, textarea')!
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submit(): void {
  dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function housings(): Promise<Row[]> {
  return (await (await getDB()).getAll('housings')) as Row[]
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('adding a housing expense', () => {
  it('marks a blank name and amount in their words, focuses the name, and sends nothing', async () => {
    await openDialog()

    submit()
    await settle()

    const name = field('Property / Description')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(name)).toBe(M.name)
    expect(describedBy(field('Monthly Amount'))).toBe(M.amount)
    expect(document.activeElement).toBe(name)
    expect(await housings()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount of zero and a due day that is not one, under each', async () => {
    await openDialog()
    type(field('Property / Description'), 'Flat')
    type(field('Monthly Amount'), '0')
    type(field('Due Day'), '40')

    submit()
    await settle()

    expect(describedBy(field('Monthly Amount'))).toBe(M.amountPositive)
    expect(describedBy(field('Due Day'))).toBe(M.dueDay)
    expect(document.activeElement).toBe(field('Monthly Amount'))
    expect(await housings()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('takes the mark away once the field is fixed', async () => {
    await openDialog()
    submit()
    await settle()

    type(field('Property / Description'), 'Flat')

    expect(field('Property / Description').getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(field('Monthly Amount'))).toBe(M.amount)
  })

  it('adds an expense with a comma for the cents, due this month, says so, and closes', async () => {
    await openDialog()
    expect(field('Due Month').value).toBe(String(Number(localMonth().slice(5, 7))))
    type(field('Property / Description'), 'Flat on the corner')
    type(field('Monthly Amount'), '850,50')
    type(field('Due Day'), '5')

    submit()

    await vi.waitFor(async () => {
      expect(await housings()).toEqual([
        expect.objectContaining({
          name: 'Flat on the corner',
          type: 'rent',
          monthly_amount: 850.5,
          due_date: `${localMonth().slice(5, 7)}-05`,
          autopay: 0,
        }),
      ])
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "Flat on the corner" to your housing costs.'])
    expect(failureToasts()).toEqual([])
  })

  it("marks a field the runtime refuses, in the runtime's words, and keeps the dialog open", async () => {
    await openDialog()
    type(field('Property / Description'), 'Flat')
    type(field('Monthly Amount'), '850')
    next.refusal = { monthly_amount: M.amountMax }

    submit()

    await vi.waitFor(() => {
      expect(describedBy(field('Monthly Amount'))).toBe(M.amountMax)
    })
    expect(field('Monthly Amount').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Monthly Amount'))
    expect(dialog()).not.toBeNull()
    expect(await housings()).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})
