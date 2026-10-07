/**
 * The recurring list shows the newest answer, and a failed reload after a profile switch clears
 * the previous profile's rules rather than leave them on screen as if they were current.
 *
 * The list reloads on every recurring write, category write, profile switch and resume, so its
 * answers can land out of order: an older one shown last put back rules a later write had changed.
 * And a failed reload kept whatever was on screen, so after a switch the section went on listing
 * the previous profile's rules, which the profile switched to cannot edit (an edit answers 404).
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import { __resetDataVersionsForTest, invalidateEntity } from '../../core/dataVersions'
import RecurringSection from '../RecurringSection'

type Rule = {
  id: number
  description: string
  amount: number
  type: string
  frequency: string
  day_of_month: number | null
  next_date: string
  category_id: number | null
  account_id: number | null
  transfer_account_id: number | null
  notes: string | null
}

const rule = (id: number, description: string): Rule => ({
  id,
  description,
  amount: 50,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-11-01',
  category_id: null,
  account_id: null,
  transfer_account_id: null,
  notes: null,
})

/** The server's rules. Mutable, so a write made elsewhere is visible to the next read. */
let serverRules: Rule[] = []
const getRecurring = vi.fn(async () => serverRules.map((r) => ({ ...r })))

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: vi.fn(),
  api: { getRecurring: () => getRecurring() },
}))

/** A request that answers when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  __resetDataVersionsForTest()
  localStorage.setItem('currentProfileId', '1')
  serverRules = [rule(1, 'Rent')]
  getRecurring.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  localStorage.clear()
})

/** The section lives on the Transactions page, and loads only while that page is visible. */
async function mountSection() {
  setPage('transactions')
  dispose = render(() => <RecurringSection categories={[]} accounts={[]} />, host)
  await settle()
  // The rows render in the expanded section.
  host.querySelector<HTMLElement>('[class*="sectionHeader"]')!.click()
  await settle()
}

const shows = (description: string) => host.textContent?.includes(description) ?? false

describe('the recurring list', () => {
  it('shows the newest answer when two reloads cross, not the one that lands last', async () => {
    await mountSection()
    const slow = deferred<Rule[]>()
    getRecurring.mockImplementationOnce(() => slow.promise)
    invalidateEntity('recurring')
    await flush()
    // A rule added meanwhile, and the reload after it answering at once.
    serverRules = [...serverRules, rule(2, 'Gym')]
    invalidateEntity('recurring')
    await settle()
    // The slow one lands last, with the list from before the add.
    slow.resolve([rule(1, 'Rent')])
    await settle()

    expect(getRecurring).toHaveBeenCalledTimes(3)
    expect(shows('Gym')).toBe(true)
  })

  it('keeps the rules on screen when a reload within the profile fails', async () => {
    await mountSection()
    getRecurring.mockRejectedValueOnce(new Error('network down'))
    invalidateEntity('recurring')
    await settle()

    expect(getRecurring).toHaveBeenCalledTimes(2)
    expect(shows('Rent')).toBe(true)
  })

  it('drops the previous profile’s rules when the reload after a switch fails', async () => {
    await mountSection()
    expect(shows('Rent')).toBe(true)

    getRecurring.mockRejectedValueOnce(new Error('network down'))
    localStorage.setItem('currentProfileId', '2')
    bumpProfileVersion()
    await settle()

    expect(getRecurring).toHaveBeenCalledTimes(2)
    expect(shows('Rent')).toBe(false)
  })
})
