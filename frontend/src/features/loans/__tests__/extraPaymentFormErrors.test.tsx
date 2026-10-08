/**
 * The Extra payments tab's two forms, run against the real local-first router on fake-indexeddb.
 *
 * A refused save was a toast, the runtime's first sentence or "Couldn't save the extra payment.
 * Try again.", with nothing in the form marked, and an amount with a third decimal was rounded
 * without a word. Now both forms check the values with the rules both runtimes run
 * (shared/loanSchema.ts), mark the field in its own words, and mark a field the runtime refuses
 * the same way. A change checks only what it changes, so an extra payment that goes with a payment
 * a since-shortened term has passed can still have its amount changed.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOAN_MESSAGES as M } from '../../../../../shared/loanSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'

const CAR = 1
const VAN = 2

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
      principal: 15000,
      interest_rate: 4.5,
      start_date: '2026-01-15',
      created_at: `2026-01-0${id}T00:00:00.000Z`,
      rate_periods: [],
      ...values,
    } as never)
  await loan(CAR, {
    name: 'Car',
    term_months: 60,
    prepayments: [{ id: 1, month: 6, amount: 500, note: 'Bonus' }],
  })
  // Saved with payment 36 of 36; the term was shortened to 24 since.
  await loan(VAN, {
    name: 'Van',
    term_months: 24,
    prepayments: [{ id: 1, month: 36, amount: 700, note: 'Old' }],
  })
  for (const toast of toasts()) removeToast(toast.id)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
  Element.prototype.scrollIntoView = () => {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2025-12-15T12:00:00Z'))
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
  setPage('loans')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  history.replaceState(null, '', '#')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const addForm = () => byTestId('loans-extra-form')!
const editForm = () => byTestId('loans-extra-edit-form')

async function openLoan(id: number): Promise<void> {
  history.replaceState(null, '', `#loans/${id}/extras`)
  const { default: Loans } = await import('../../Loans')
  dispose = render(() => <Loans />, host)
  await vi.waitFor(() => {
    expect(byTestId('loans-extra-form')).not.toBeNull()
  })
}

async function openChange(month: number): Promise<void> {
  host
    .querySelector<HTMLButtonElement>(
      `[aria-label="Change the extra payment with payment ${month}"]`
    )!
    .click()
  await vi.waitFor(() => {
    expect(editForm()).not.toBeNull()
  })
}

/** The control under the label that reads `text`, as a person finds it, in `within`. */
function field(text: string, within: HTMLElement): HTMLInputElement {
  const label = Array.from(within.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text
  )
  if (!label) throw new Error(`no ${text} field`)
  return document.getElementById(label.getAttribute('for')!) as HTMLInputElement
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function pick(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function submit(form: HTMLElement): void {
  form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function extras(id: number): Promise<Row[]> {
  const loan = (await (await getDB()).get('loans', id)) as Row
  return (loan.prepayments as Row[]).map(({ month, amount, note }) => ({ month, amount, note }))
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('adding an extra payment', () => {
  it('marks a missing amount in its own words, focuses it, and sends nothing', async () => {
    await openLoan(CAR)

    submit(addForm())
    await settle()

    const amount = field('Amount', addForm())
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(amount)).toBe(M.extraAmount)
    expect(document.activeElement).toBe(amount)
    expect(await extras(CAR)).toEqual([{ month: 6, amount: 500, note: 'Bonus' }])
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount it cannot read, and one with a third decimal', async () => {
    await openLoan(CAR)
    type(field('Amount', addForm()), 'lots')

    submit(addForm())
    await settle()
    expect(describedBy(field('Amount', addForm()))).toBe(M.extraAmountNumber)

    // Marked, it is checked again as it changes.
    type(field('Amount', addForm()), '10,555')
    expect(describedBy(field('Amount', addForm()))).toBe(M.extraAmountCents)
    type(field('Amount', addForm()), '0')
    expect(describedBy(field('Amount', addForm()))).toBe(M.amountPositive)
    expect(await extras(CAR)).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('adds it, says so, and starts over on the same payment', async () => {
    await openLoan(CAR)
    pick(field('When', addForm()), '3')
    type(field('Amount', addForm()), '1000,50')
    type(field('Note (optional)', addForm()), '  Gift  ')

    submit(addForm())

    await vi.waitFor(async () => {
      expect(await extras(CAR)).toEqual([
        { month: 6, amount: 500, note: 'Bonus' },
        { month: 3, amount: 1000.5, note: 'Gift' },
      ])
    })
    await vi.waitFor(() => {
      expect(successToasts()).toEqual(['Added €1,000.50 with payment 3 to "Car".'])
    })
    expect(field('Amount', addForm()).value).toBe('')
    expect(field('Note (optional)', addForm()).value).toBe('')
    expect(field('When', addForm()).value).toBe('3')
    expect(failureToasts()).toEqual([])
  })

  it('marks the payment the runtime refuses, when another tab shortened the loan', async () => {
    await openLoan(CAR)
    pick(field('When', addForm()), '48')
    type(field('Amount', addForm()), '100')
    // Another tab shortened the term: the page still offers the payments it had.
    const db = await getDB()
    await db.put('loans', { ...(await db.get('loans', CAR)), term_months: 24 } as never)

    submit(addForm())

    await vi.waitFor(() => {
      expect(describedBy(field('When', addForm()))).toBe(M.extraMonth)
    })
    expect(field('When', addForm()).getAttribute('aria-invalid')).toBe('true')
    expect(await extras(CAR)).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })
})

describe('changing an extra payment', () => {
  it('saves a change, says so, and closes', async () => {
    await openLoan(CAR)
    await openChange(6)
    type(field('Amount', editForm()!), '650')

    submit(editForm()!)

    await vi.waitFor(async () => {
      expect(await extras(CAR)).toEqual([{ month: 6, amount: 650, note: 'Bonus' }])
    })
    await vi.waitFor(() => {
      expect(editForm()).toBeNull()
    })
    expect(successToasts()).toEqual(['Saved your changes to the extra payment with payment 6.'])
    expect(failureToasts()).toEqual([])
  })

  it('changes the amount of one with a payment a shortened term has passed, and keeps it there', async () => {
    await openLoan(VAN)
    await openChange(36)
    expect(field('When', editForm()!).value).toBe('36')
    type(field('Amount', editForm()!), '750')

    submit(editForm()!)

    await vi.waitFor(async () => {
      expect(await extras(VAN)).toEqual([{ month: 36, amount: 750, note: 'Old' }])
    })
    expect(failureToasts()).toEqual([])
  })

  it('marks a refused change under the field, sends nothing, and stays open', async () => {
    await openLoan(CAR)
    await openChange(6)
    type(field('Amount', editForm()!), '0')

    submit(editForm()!)
    await settle()

    const amount = field('Amount', editForm()!)
    expect(describedBy(amount)).toBe(M.amountPositive)
    expect(document.activeElement).toBe(amount)
    expect(await extras(CAR)).toEqual([{ month: 6, amount: 500, note: 'Bonus' }])
    expect(failureToasts()).toEqual([])
  })

  it('says in the notice that an extra payment another tab removed is not there', async () => {
    await openLoan(CAR)
    await openChange(6)
    const db = await getDB()
    await db.put('loans', { ...(await db.get('loans', CAR)), prepayments: [] } as never)
    type(field('Amount', editForm()!), '650')

    submit(editForm()!)

    await vi.waitFor(() => {
      expect(byTestId('loans-extra-edit-notice')?.textContent).toBe('Extra payment not found')
    })
    expect(editForm()).not.toBeNull()
    expect(failureToasts()).toEqual([])
  })
})
