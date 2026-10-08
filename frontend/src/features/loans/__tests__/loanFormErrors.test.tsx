/**
 * The Loans dialog, run against the real local-first router on fake-indexeddb.
 *
 * Every refused save said "The loan was not saved. Check your connection and try again." in a
 * toast, whatever was wrong, with nothing in the dialog marked. A rate period with no first payment
 * was dropped from the save without a word, and an empty rate was sent as 0 %.
 *
 * Now the dialog checks the values with the rules both runtimes run (shared/loanSchema.ts) and
 * marks the field in its own words, a rate period's under the field of its row, and a field the
 * runtime refuses is marked the same way. An edit checks only what it changes, so a loan saved
 * under older rules can still be edited.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loanForm } from '../../../../../shared/contract/scenarios/loans'
import {
  LOAN_MESSAGES as M,
  periodEndMessage,
  periodStartMessage,
} from '../../../../../shared/loanSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'
import { BLANK_LOAN, loanBody } from '../loanForm'

const CAR = 1
const OLD = 2
const LONG_NAME = 'Family loan for the flat, '.repeat(6).trim()

type Row = Record<string, any>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../../Loans'), import('../../../core/storage/localApiRouter')])
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
  const loan = (id: number, values: Row) =>
    db.add('loans', {
      id,
      profile_id: 1,
      name: 'Car',
      principal: 15000,
      interest_rate: 4.5,
      start_date: '2026-01-15',
      term_months: 60,
      created_at: `2026-01-0${id}T00:00:00.000Z`,
      rate_periods: [{ id: 1, rate: 6, start_month: 13, end_month: 24 }],
      prepayments: [],
      ...values,
    } as never)
  await loan(CAR, {})
  // Stored under no rules at all: a name over 100 characters, a third decimal, a time after the
  // date, and a rate period from payment 0 at 300 %.
  await loan(OLD, {
    name: LONG_NAME,
    principal: 15000.555,
    start_date: '2026-01-15 00:00:00',
    rate_periods: [{ id: 1, rate: 300, start_month: 0, end_month: 0 }],
  })
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
  history.replaceState(null, '', '#loans')
  setPage('loans')
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
  const { default: Loans } = await import('../../Loans')
  dispose = render(() => <Loans />, host)
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-test-id="loans-item"]').length).toBe(2)
  })
}

const dialog = () => host.querySelector<HTMLElement>('[data-test-id="loans-modal"]')

async function openAdd(): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-test-id="add-loan-btn"]')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

async function openEdit(name: string): Promise<void> {
  const card = Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="loans-item"]')).find(
    (c) => c.textContent?.includes(name)
  )
  if (!card) throw new Error(`no loan "${name}"`)
  card.querySelector<HTMLButtonElement>('[data-test-id="loans-item-edit"]')!.click()
  await vi.waitFor(() => {
    expect(field('Name').value).toBe(name)
  })
}

/** The control under the label that reads `text`, as a person finds it, in `within`. */
function field(text: string, within: HTMLElement = dialog()!): HTMLInputElement {
  const label = Array.from(within.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text
  )
  if (!label) throw new Error(`no ${text} field`)
  return document.getElementById(label.getAttribute('for')!) as HTMLInputElement
}

const periodRows = () =>
  Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-test-id="loans-form-rate-period"]'))

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submit(): void {
  dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

function addPeriod(): void {
  const button = Array.from(dialog()!.querySelectorAll('button')).find(
    (b) => b.textContent === 'Add a rate period'
  )
  button!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function loans(): Promise<Row[]> {
  return (await (await getDB()).getAll('loans')) as Row[]
}

const stored = async (id: number) => (await (await getDB()).get('loans', id)) as Row

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

async function fillNewLoan(): Promise<void> {
  type(field('Name'), 'Boat')
  type(field('Amount borrowed'), '20000')
  type(field('Interest rate (%)'), '6,25')
  type(field('Term (months)'), '60')
  type(field('First payment due'), '2026-03-01')
}

describe('adding a loan', () => {
  it('marks every missing field in its own words, focuses the first, and sends nothing', async () => {
    await mountPage()
    await openAdd()

    submit()
    await settle()

    expect(field('Name').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('Name'))).toBe(M.name)
    expect(describedBy(field('Amount borrowed'))).toBe(M.principal)
    expect(describedBy(field('Interest rate (%)'))).toBe(M.rate)
    expect(describedBy(field('Term (months)'))).toBe(M.term)
    expect(describedBy(field('First payment due'))).toBe(M.startDate)
    expect(document.activeElement).toBe(field('Name'))
    expect(await loans()).toHaveLength(2)
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount it cannot read and a term past what the schedule runs', async () => {
    await mountPage()
    await openAdd()
    await fillNewLoan()
    type(field('Amount borrowed'), 'lots')
    type(field('Term (months)'), '1201')

    submit()
    await settle()

    expect(describedBy(field('Amount borrowed'))).toBe(M.principalNumber)
    expect(describedBy(field('Term (months)'))).toBe(M.termRange)
    expect(document.activeElement).toBe(field('Amount borrowed'))
    expect(await loans()).toHaveLength(2)
  })

  it('marks a rate period at the field of its row, and keeps the mark on the row it is about', async () => {
    await mountPage()
    await openAdd()
    await fillNewLoan()
    addPeriod()
    addPeriod()
    const [first, second] = periodRows()
    type(field('From payment', second), '61')
    type(field('To payment', first), '12')

    submit()
    await settle()

    expect(field('From payment', periodRows()[1]).getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('From payment', periodRows()[1]))).toBe(periodStartMessage(60))
    expect(field('From payment', periodRows()[0]).getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(field('From payment', periodRows()[1]))
    expect(await loans()).toHaveLength(2)

    // Removing the first row moves the refused one up, and its mark with it.
    periodRows()[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remove this rate period"]')!
      .click()
    await settle()
    expect(periodRows()).toHaveLength(1)
    expect(describedBy(field('From payment', periodRows()[0]))).toBe(periodStartMessage(60))

    type(field('From payment', periodRows()[0]), '13')
    expect(field('From payment', periodRows()[0]).getAttribute('aria-invalid')).toBeNull()
    expect(failureToasts()).toEqual([])
  })

  it('adds the loan with its rate period, says so, and closes', async () => {
    await mountPage()
    await openAdd()
    await fillNewLoan()
    addPeriod()
    type(field('Rate (%)', periodRows()[0]), '3,9')
    type(field('From payment', periodRows()[0]), '13')

    submit()

    await vi.waitFor(async () => {
      expect((await loans()).find((l) => l.name === 'Boat')).toMatchObject({
        principal: 20000,
        interest_rate: 6.25,
        term_months: 60,
        start_date: '2026-03-01',
        rate_periods: [{ rate: 3.9, start_month: 13, end_month: null }],
        prepayments: [],
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "Boat" to your loans.'])
    expect(failureToasts()).toEqual([])
  })

  it('keeps a 0 % loan at 0 %', async () => {
    await mountPage()
    await openAdd()
    await fillNewLoan()
    type(field('Interest rate (%)'), '0')

    submit()

    await vi.waitFor(async () => {
      expect((await loans()).find((l) => l.name === 'Boat')?.interest_rate).toBe(0)
    })
  })
})

describe('editing a loan', () => {
  it('saves a change, says so, and keeps the rate period it sends back', async () => {
    await mountPage()
    await openEdit('Car')
    type(field('Name'), 'Car loan')
    type(field('Amount borrowed'), '14500,50')

    submit()

    await vi.waitFor(async () => {
      expect(await stored(CAR)).toMatchObject({
        name: 'Car loan',
        principal: 14500.5,
        rate_periods: [{ id: 1, rate: 6, start_month: 13, end_month: 24 }],
      })
    })
    expect(successToasts()).toEqual(['Saved your changes to "Car loan".'])
    expect(failureToasts()).toEqual([])
  })

  it('renames a loan saved under older rules, and changes nothing else', async () => {
    await mountPage()
    await openEdit(LONG_NAME)
    type(field('Name'), 'Flat')

    submit()

    await vi.waitFor(async () => {
      expect((await stored(OLD)).name).toBe('Flat')
    })
    expect(await stored(OLD)).toMatchObject({
      principal: 15000.555,
      rate_periods: [{ id: 1, rate: 300, start_month: 0, end_month: 0 }],
    })
    expect(failureToasts()).toEqual([])
  })

  it('marks what an edit changes and the rules refuse, under the field', async () => {
    await mountPage()
    await openEdit('Car')
    type(field('Interest rate (%)'), '')
    type(field('To payment', periodRows()[0]), '99')

    submit()
    await settle()

    expect(describedBy(field('Interest rate (%)'))).toBe(M.rate)
    expect(describedBy(field('To payment', periodRows()[0]))).toBe(periodEndMessage(13, 60))
    expect((await stored(CAR)).interest_rate).toBe(4.5)
    expect(failureToasts()).toEqual([])
  })

  it('marks a rate period the runtime checks as new, when another tab removed it', async () => {
    await mountPage()
    await openEdit(LONG_NAME)
    // Another tab took the old period away: the form still sends it back as the loan's own.
    const db = await getDB()
    await db.put('loans', { ...(await stored(OLD)), rate_periods: [] } as never)
    type(field('Name'), 'Flat')

    submit()

    await vi.waitFor(() => {
      expect(describedBy(field('From payment', periodRows()[0]))).toBe(periodStartMessage(60))
    })
    expect(field('Rate (%)', periodRows()[0]).getAttribute('aria-invalid')).toBe('true')
    expect(dialog()).not.toBeNull()
    expect((await stored(OLD)).name).toBe(LONG_NAME)
    expect(failureToasts()).toEqual([])
  })

  it('says in the notice that a loan another tab deleted is not there', async () => {
    await mountPage()
    await openEdit('Car')
    await (await getDB()).delete('loans', CAR)
    type(field('Name'), 'Car loan')

    submit()

    await vi.waitFor(() => {
      expect(dialog()!.querySelector('[data-test-id="loans-form-notice"]')?.textContent).toBe(
        'Loan not found'
      )
    })
    expect(failureToasts()).toEqual([])
  })
})

describe('the body the dialog sends', () => {
  it('is the body the contract scenarios send to both runtimes', () => {
    const typed = {
      name: 'Car',
      principal: '15000',
      interest_rate: '4.5',
      term_months: '60',
      start_date: '2026-01-15',
      rate_periods: [],
    }
    expect(loanBody(typed)).toEqual(loanForm())
  })

  it('reads a comma or a dot, keeps text it cannot read, and sends a blank end as none', () => {
    const body = loanBody({
      ...BLANK_LOAN,
      principal: '12000,50',
      interest_rate: 'x',
      rate_periods: [{ rate: '3,9', start_month: '13', end_month: '' }],
    })
    expect(body).toMatchObject({
      principal: 12000.5,
      interest_rate: 'x',
      term_months: null,
      rate_periods: [{ rate: 3.9, start_month: 13, end_month: null }],
    })
  })

  it('leaves the rate periods out while the loan’s own have not arrived', () => {
    expect(loanBody(BLANK_LOAN, false)).not.toHaveProperty('rate_periods')
  })
})
