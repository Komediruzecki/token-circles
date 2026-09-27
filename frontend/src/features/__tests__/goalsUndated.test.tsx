/**
 * A savings goal need not have a target date. D1's savings_goals.deadline is nullable, the Worker
 * stores an empty date as NULL (readDeadline in worker/src/routes/savings-goals.ts), and the
 * local-first demo seed writes its goals without one.
 *
 * The Goals page used to fill a missing date in with today's. An undated goal was shown as
 * "<today> • Due today", and its progress ring said "by <this month>". Opening it to edit put
 * today into the date field, so saving any change to it, a rename included, gave it a deadline it
 * never had. The date field was also required, so a goal could not be created, or kept, without
 * one.
 *
 * These run the real page against the real local-first router on fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { getDB } from '../../core/storage/idb'

const TODAY = new Date().toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

/** How the page prints a date, so the expectation holds in any time zone. */
const shown = (date: string) =>
  new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
const ringMonth = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

const GOALS = [
  // Exactly what the local-first demo seed writes: no date under either name.
  {
    id: 1,
    name: 'Emergency Fund',
    target_amount: 10000,
    current_amount: 4000,
    notes: 'Safety net',
  },
  // What the Worker returns for a goal saved without a date.
  {
    id: 2,
    name: 'Rainy Day',
    target_amount: 3000,
    current_amount: 0,
    deadline: null,
    notes: '',
    category_id: null,
    monthly_contribution: 0,
    tracking_start_date: null,
    created_at: '2026-04-01 09:00:00',
  },
  // Dated, as the Goals page stores one locally...
  {
    id: 3,
    name: 'New Car',
    target_amount: 5000,
    current_amount: 1000,
    target_date: '2030-06-30',
    monthly_contribution: null,
    category_id: null,
  },
  // ...and as the Worker returns one.
  {
    id: 4,
    name: 'House',
    target_amount: 50000,
    current_amount: 0,
    deadline: '2031-01-15',
    notes: '',
    category_id: null,
    monthly_contribution: 0,
    tracking_start_date: null,
    created_at: '2026-04-01 09:00:00',
  },
]

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // The first test would otherwise pay for this import inside its own timeout.
  await import('../Goals')
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  for (const goal of GOALS) await db.add('goals', { profile_id: 1, ...goal })

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

async function mountGoals(): Promise<void> {
  setPage('goals')
  const { default: Goals } = await import('../Goals')
  dispose = render(() => <Goals />, host)
  await vi.waitFor(() => {
    expect(cards()).toHaveLength(GOALS.length)
  })
}

const cards = () => Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="goal-card"]'))

function card(name: string): HTMLElement {
  const found = cards().find(
    (c) => c.querySelector('[data-test-id="goal-name"]')?.textContent?.trim() === name
  )
  if (!found) throw new Error(`no card for ${name}`)
  return found
}

const dateLine = (name: string) =>
  card(name).querySelector('[data-test-id="goal-date"]')?.textContent?.trim()

/** What the full-size ring in the Goals Progress section says under the goal's name. */
const ringLine = (name: string) =>
  host.querySelector(`p[title="${name}"]`)?.nextElementSibling?.textContent ?? ''

const input = (testId: string) =>
  host.querySelector<HTMLInputElement>(`[data-test-id="${testId}"]`)!

function type(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function openEdit(name: string): void {
  card(name).querySelector<HTMLButtonElement>('[data-test-id="goal-edit-btn"]')!.click()
}

async function submit(): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-test-id="goals-modal-submit"]')!.click()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="goals-modal"]')).toBeNull()
  })
}

/** Wait for the reloaded list to show `name` with `line` as its date line. */
async function untilDateLine(name: string, line: string): Promise<void> {
  await vi.waitFor(() => {
    expect(dateLine(name)).toBe(line)
  })
}

/** The date a stored goal carries under either name, or null for none. */
async function storedDate(id: number): Promise<unknown> {
  const row = await (await getDB()).get('goals', id)
  return row.deadline || row.target_date || null
}

describe('a goal without a target date', () => {
  it('is shown as having none, not as due today', async () => {
    await mountGoals()

    for (const name of ['Emergency Fund', 'Rainy Day']) {
      expect(dateLine(name)).toBe('No target date')
      expect(dateLine(name)).not.toContain(TODAY)
    }
    expect(dateLine('New Car')?.startsWith(`${shown('2030-06-30')} • `)).toBe(true)
    expect(dateLine('New Car')).toMatch(/ • Due in \d+ days$/)
    expect(dateLine('House')?.startsWith(`${shown('2031-01-15')} • `)).toBe(true)
    expect(dateLine('House')).toMatch(/ • Due in \d+ days$/)
  })

  it('has no "by" month on its progress ring', async () => {
    await mountGoals()

    expect(ringLine('Emergency Fund')).not.toContain('· by')
    expect(ringLine('Rainy Day')).not.toContain('· by')
    expect(ringLine('New Car')).toContain(`· by ${ringMonth('2030-06-30')}`)
    expect(ringLine('House')).toContain(`· by ${ringMonth('2031-01-15')}`)
  })

  it('opens for editing with an empty date field, and stays undated when saved', async () => {
    await mountGoals()

    openEdit('Emergency Fund')
    expect(input('goals-form-date').value).toBe('')
    expect(input('goals-form-date').required).toBe(false)
    type(input('goals-form-name'), 'Emergency Fund, renamed')
    await submit()

    await untilDateLine('Emergency Fund, renamed', 'No target date')
    expect(await storedDate(1)).toBeNull()
  })

  it('can be created', async () => {
    await mountGoals()

    host.querySelector<HTMLButtonElement>('[data-test-id="add-goal-btn"]')!.click()
    expect(input('goals-form-date').required).toBe(false)
    type(input('goals-form-name'), 'Someday')
    type(input('goals-form-target'), '800')
    await submit()

    await untilDateLine('Someday', 'No target date')
    const db = await getDB()
    const created = (await db.getAll('goals')).find((g) => g.name === 'Someday')
    expect(created.deadline || created.target_date || null).toBeNull()
  })
})

describe('a goal with a target date', () => {
  it('opens for editing with its own date', async () => {
    await mountGoals()

    openEdit('New Car')
    expect(input('goals-form-date').value).toBe('2030-06-30')
  })

  it('becomes undated when its date is cleared', async () => {
    await mountGoals()

    openEdit('New Car')
    type(input('goals-form-date'), '')
    await submit()

    await untilDateLine('New Car', 'No target date')
    expect(await storedDate(3)).toBeNull()
  })
})

/**
 * Cloud mode. The page is the same code, but what matters there is the request it sends: the
 * Worker stores whatever date arrives (an empty one as NULL), so a page that fills in today's date
 * writes that date to D1 for good. These run the page against a stubbed Worker and read the bodies
 * of its writes.
 */
describe('in cloud mode', () => {
  /** What the Worker's GET /api/savings-goals returns: every goal's date under `deadline`. */
  const WORKER_ROWS = GOALS.map(({ target_date, ...g }) => ({
    profile_id: 1,
    ...g,
    deadline: (g as { deadline?: string | null }).deadline ?? target_date ?? null,
  }))

  let writes: { method: string; path: string; body: Record<string, unknown> }[]

  beforeEach(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    writes = []
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://localhost').pathname
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET') {
        writes.push({ method, path, body: JSON.parse((init?.body as string) ?? '{}') })
        return reply(method === 'POST' ? { id: 99 } : { ok: true }, method === 'POST' ? 201 : 200)
      }
      if (path === '/api/savings-goals') return reply(WORKER_ROWS)
      return reply([])
    })
  })

  const goalWrite = (method: string) =>
    writes.find((w) => w.method === method && w.path.startsWith('/api/savings-goals'))

  it('shows a goal the Worker stored without a date as undated', async () => {
    await mountGoals()

    expect(dateLine('Emergency Fund')).toBe('No target date')
    expect(dateLine('Rainy Day')).toBe('No target date')
    expect(dateLine('House')?.startsWith(`${shown('2031-01-15')} • `)).toBe(true)
  })

  it('does not send a date when an undated goal is renamed', async () => {
    await mountGoals()

    openEdit('Rainy Day')
    type(input('goals-form-name'), 'Rainy Day, renamed')
    await submit()

    const put = goalWrite('PUT')
    expect(put?.path).toBe('/api/savings-goals/2')
    expect(put?.body.name).toBe('Rainy Day, renamed')
    expect(put?.body.target_date || null).toBeNull()
  })

  it('creates a goal without a date', async () => {
    await mountGoals()

    host.querySelector<HTMLButtonElement>('[data-test-id="add-goal-btn"]')!.click()
    const label = input('goals-form-date').parentElement!.querySelector('label')!
    expect(label.textContent).toBe('Target Date (optional)')
    type(input('goals-form-name'), 'Someday')
    type(input('goals-form-target'), '800')
    await submit()

    const post = goalWrite('POST')
    expect(post?.body.name).toBe('Someday')
    expect(post?.body.target_date || null).toBeNull()
  })

  it('sends an empty date when a date is cleared', async () => {
    await mountGoals()

    openEdit('House')
    expect(input('goals-form-date').value).toBe('2031-01-15')
    type(input('goals-form-date'), '')
    await submit()

    const put = goalWrite('PUT')
    expect(put?.path).toBe('/api/savings-goals/4')
    expect(put?.body.target_date).toBe('')
  })
})
