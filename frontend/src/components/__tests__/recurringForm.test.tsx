/**
 * The Recurring section's "Add Recurring" and "Edit Recurring" dialog, and its delete and "Add to
 * transactions", run against the real local-first router on fake-indexeddb.
 *
 * A refused save said what the transaction rules or zod said, in a toast ("Transaction amount
 * must be a positive number", "Validation failed"), with nothing in the dialog marked. A failed
 * delete or "Add to transactions" said nothing at all. Now the dialog checks the values with the
 * rules both runtimes run (shared/recurringSchema.ts) and marks the field in their words. The one
 * check the dialog cannot make is whether an account is still the profile's: the runtime refuses
 * one that is not, at the account field.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECURRING_MESSAGES as M } from '../../../../shared/recurringSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { recurringBody } from '../../features/recurringForm'
import { localToday } from '../../utils/period'
import type { Category } from '../../types/models'

type Row = Record<string, unknown>

const OTHER_PROFILE = 2
const HOME = 31
const GIRO = 32
const SAVINGS = 33
const ELSEWHERE_ACCOUNT = 35

/** The accounts the page passes in. The last is another profile's: a list from before a switch. */
const ACCOUNTS = [
  { id: GIRO, name: 'Giro' },
  { id: SAVINGS, name: 'Savings' },
  { id: ELSEWHERE_ACCOUNT, name: 'Elsewhere' },
]
const CATEGORIES = [{ id: HOME, name: 'Home', type: 'expense', color: '#f97316' }] as Category[]

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../RecurringSection'), import('../../core/storage/localApiRouter')])
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
  await db.add('profiles', { id: OTHER_PROFILE, name: 'Else', created_at: '2026-01-01' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.add('categories', {
    id: HOME,
    profile_id: 1,
    name: 'Home',
    type: 'expense',
    color: '#f97316',
  } as never)
  const account = (id: number, profile: number, name: string) =>
    db.add('accounts', {
      id,
      profile_id: profile,
      name,
      type: 'giro',
      currency: 'EUR',
      balance: 1000,
      starting_balance: 1000,
    } as never)
  await account(GIRO, 1, 'Giro')
  await account(SAVINGS, 1, 'Savings')
  await account(ELSEWHERE_ACCOUNT, OTHER_PROFILE, 'Elsewhere')
  for (const toast of toasts()) removeToast(toast.id)
  for (const request of confirmRequests()) resolveConfirm(request.id, false)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
  setPage('transactions')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

/** A rule stored before the section opens, as an older version may have stored it. */
async function seed(values: Row): Promise<void> {
  await (
    await getDB()
  ).add('recurring', {
    profile_id: 1,
    description: 'Rent',
    amount: 850.5,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: 1,
    next_date: '2026-03-01',
    category_id: HOME,
    account_id: GIRO,
    transfer_account_id: null,
    notes: 'Flat 4',
    active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...values,
  } as never)
}

async function showSection(): Promise<void> {
  const { default: RecurringSection } = await import('../RecurringSection')
  dispose = render(() => <RecurringSection categories={CATEGORIES} accounts={ACCOUNTS} />, host)
  host.querySelector<HTMLElement>('[class*="sectionHeader"]')!.click()
  await settle()
}

const button = (name: string): HTMLButtonElement => {
  const found = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === name || b.title === name
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

async function openAdd(): Promise<void> {
  await showSection()
  button('Add').click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

async function openEdit(): Promise<void> {
  await showSection()
  await vi.waitFor(() => {
    expect(host.querySelector('button[title="Edit"]')).not.toBeNull()
  })
  button('Edit').click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

const dialog = () => host.querySelector<HTMLElement>('[data-test-id="recurring-modal"]')

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

/** The control under the label that reads `text`, as a person finds it. */
function field(text: string): Control {
  const label = Array.from(dialog()!.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text
  )
  if (!label) throw new Error(`no ${text} field`)
  return label.parentElement!.querySelector<Control>('input, select, textarea')!
}

function type(el: Control, value: string): void {
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

async function rules(): Promise<Row[]> {
  return (await (await getDB()).getAll('recurring')) as Row[]
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const toastsOf = (kind: 'success' | 'info') =>
  toasts()
    .filter((t) => t.type === kind)
    .map((t) => t.message)

describe('adding a recurring transaction', () => {
  it('marks a blank description and amount in their words, focuses the first, and sends nothing', async () => {
    await openAdd()

    submit()
    await settle()

    const description = field('Description')
    expect(description.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(description)).toBe(M.description)
    expect(describedBy(field('Amount'))).toBe(M.amount)
    expect(field('Next Date').getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(description)
    expect(await rules()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount that is not a number and a day that is not one, under each', async () => {
    await openAdd()
    type(field('Description'), 'Gym')
    type(field('Amount'), 'thirty')
    type(field('Day of Month'), '32')

    submit()
    await settle()

    expect(describedBy(field('Amount'))).toBe(M.amountNumber)
    expect(describedBy(field('Day of Month'))).toBe(M.dayOfMonth)
    expect(document.activeElement).toBe(field('Amount'))
    expect(await rules()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks a transfer without the accounts it moves money between', async () => {
    await openAdd()
    type(field('Description'), 'Savings plan')
    type(field('Amount'), '100')
    type(field('Type'), 'transfer')

    submit()
    await settle()

    expect(describedBy(field('From account'))).toBe(M.transferFrom)
    expect(describedBy(field('To account'))).toBe(M.transferTo)

    type(field('From account'), String(GIRO))
    type(field('To account'), String(GIRO))
    submit()
    await settle()

    expect(field('From account').getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(field('To account'))).toBe(M.transferSame)
    expect(await rules()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('adds a rule with a comma for the cents and no day of the month, says so, and closes', async () => {
    await openAdd()
    type(field('Description'), 'Gym')
    type(field('Amount'), '29,90')
    type(field('Account'), String(GIRO))
    type(field('Category'), String(HOME))

    submit()

    await vi.waitFor(async () => {
      expect(await rules()).toEqual([
        expect.objectContaining({
          description: 'Gym',
          amount: 29.9,
          type: 'expense',
          frequency: 'monthly',
          day_of_month: null,
          next_date: localToday(),
          account_id: GIRO,
          category_id: HOME,
          transfer_account_id: null,
          active: 1,
        }),
      ])
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(toastsOf('success')).toEqual(['Added "Gym" to your recurring transactions.'])
    expect(failureToasts()).toEqual([])
  })

  it("marks the account when the runtime says it is not the profile's, in the runtime's words", async () => {
    await openAdd()
    type(field('Description'), 'Gym')
    type(field('Amount'), '30')
    type(field('Account'), String(ELSEWHERE_ACCOUNT))

    submit()

    await vi.waitFor(() => {
      expect(describedBy(field('Account'))).toBe(M.account)
    })
    expect(field('Account').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Account'))
    expect(dialog()).not.toBeNull()
    expect(await rules()).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})

describe('editing a recurring transaction', () => {
  it('opens a sum with a float error to the cent, saves a change, and says so', async () => {
    await seed({ amount: 0.1 + 0.2 })
    await openEdit()
    expect(field('Amount').value).toBe('0.3')
    expect(field('Day of Month').value).toBe('1')

    type(field('Notes'), 'Flat 5')
    submit()

    await vi.waitFor(async () => {
      expect(await rules()).toEqual([
        expect.objectContaining({ description: 'Rent', amount: 0.3, notes: 'Flat 5' }),
      ])
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(toastsOf('success')).toEqual(['Saved your changes to "Rent".'])
    expect(failureToasts()).toEqual([])
  })

  it('saves a rule an older version stored, sending its values back as they were', async () => {
    await seed({
      description: '',
      type: 'deduction',
      frequency: 'biweekly',
      account_id: ELSEWHERE_ACCOUNT,
    })
    await openEdit()

    type(field('Notes'), 'Still here')
    submit()

    await vi.waitFor(async () => {
      expect(await rules()).toEqual([
        expect.objectContaining({
          description: '',
          type: 'deduction',
          frequency: 'biweekly',
          account_id: ELSEWHERE_ACCOUNT,
          notes: 'Still here',
        }),
      ])
    })
    expect(toastsOf('success')).toEqual(['Saved your changes to the recurring transaction.'])
    expect(failureToasts()).toEqual([])
  })

  it('shows a type and a frequency it no longer offers as they were stored', async () => {
    await seed({ type: 'deduction', frequency: 'biweekly' })
    await openEdit()

    const kind = field('Type') as HTMLSelectElement
    const often = field('Frequency') as HTMLSelectElement
    expect([kind.value, kind.selectedOptions[0]?.textContent]).toEqual(['deduction', 'Deduction'])
    expect([often.value, often.selectedOptions[0]?.textContent]).toEqual(['biweekly', 'Biweekly'])

    // Changed and changed back, it is still there to choose.
    type(kind, 'expense')
    type(kind, 'deduction')
    expect(kind.value).toBe('deduction')

    type(field('Notes'), 'Every other Friday')
    submit()

    await vi.waitFor(async () => {
      expect(await rules()).toEqual([
        expect.objectContaining({
          type: 'deduction',
          frequency: 'biweekly',
          notes: 'Every other Friday',
        }),
      ])
    })
    expect(failureToasts()).toEqual([])
  })

  it('offers a new rule only the types and frequencies it can save', async () => {
    await openAdd()

    const offered = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.value)
    expect(offered(field('Type') as HTMLSelectElement)).toEqual(['expense', 'income', 'transfer'])
    expect(offered(field('Frequency') as HTMLSelectElement)).toEqual([
      'daily',
      'weekly',
      'monthly',
      'yearly',
    ])
  })

  it('marks an amount changed to zero, and keeps the rule as it was', async () => {
    await seed({})
    await openEdit()

    type(field('Amount'), '0')
    submit()
    await settle()

    expect(describedBy(field('Amount'))).toBe(M.amountPositive)
    expect(await rules()).toEqual([expect.objectContaining({ amount: 850.5 })])
    expect(failureToasts()).toEqual([])
  })
})

describe('deleting and running a rule', () => {
  async function confirmDelete(): Promise<void> {
    button('Delete').click()
    await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
    })
    resolveConfirm(confirmRequests()[0].id, true)
  }

  it('says a rule was deleted, and that one deleted elsewhere already was', async () => {
    await seed({})
    await seed({ description: 'Gym', next_date: '2026-03-05' })
    await showSection()
    await vi.waitFor(() => {
      expect(host.querySelectorAll('button[title="Delete"]')).toHaveLength(2)
    })

    await confirmDelete()
    await vi.waitFor(() => {
      expect(toastsOf('success')).toEqual(['Deleted "Rent".'])
    })

    // Gone in another tab: the store loses it while the row is still on screen.
    const [gym] = await rules()
    await (await getDB()).delete('recurring', gym.id as number)
    await confirmDelete()

    await vi.waitFor(() => {
      expect(toastsOf('info')).toEqual(['That recurring transaction was already deleted.'])
    })
    await vi.waitFor(() => {
      expect(host.querySelector('button[title="Delete"]')).toBeNull()
    })
    expect(failureToasts()).toEqual([])
  })

  it("adds the period to transactions, and says in the runtime's words when it already has", async () => {
    await seed({ next_date: localToday() })
    await showSection()
    await vi.waitFor(() => {
      expect(host.querySelector('button[title="Add to transactions"]')).not.toBeNull()
    })

    button('Add to transactions').click()
    await vi.waitFor(() => {
      expect(toastsOf('success')).toEqual(['Added "Rent" to your transactions.'])
    })
    expect(await (await getDB()).getAll('transactions')).toHaveLength(1)

    button('Add to transactions').click()
    await vi.waitFor(() => {
      expect(failureToasts()).toEqual([M.populated])
    })
    expect(await (await getDB()).getAll('transactions')).toHaveLength(1)
  })

  it('sends nothing for a second press while the first is on its way', async () => {
    await seed({ next_date: localToday() })
    await showSection()
    await vi.waitFor(() => {
      expect(host.querySelector('button[title="Add to transactions"]')).not.toBeNull()
    })

    button('Add to transactions').click()
    expect(button('Add to transactions').getAttribute('aria-disabled')).toBe('true')
    button('Add to transactions').click()

    await vi.waitFor(() => {
      expect(toastsOf('success')).toEqual(['Added "Rent" to your transactions.'])
    })
    await settle()
    expect(failureToasts()).toEqual([])
    expect(await (await getDB()).getAll('transactions')).toHaveLength(1)
    await vi.waitFor(() => {
      expect(button('Add to transactions').getAttribute('aria-disabled')).toBeNull()
    })
  })

  it('says a rule deleted elsewhere already was, when it is run', async () => {
    await seed({ next_date: localToday() })
    await showSection()
    await vi.waitFor(() => {
      expect(host.querySelector('button[title="Add to transactions"]')).not.toBeNull()
    })
    await (await getDB()).clear('recurring')

    button('Add to transactions').click()

    await vi.waitFor(() => {
      expect(toastsOf('info')).toEqual(['That recurring transaction was already deleted.'])
    })
    await vi.waitFor(() => {
      expect(host.querySelector('button[title="Add to transactions"]')).toBeNull()
    })
    expect(failureToasts()).toEqual([])
    expect(await (await getDB()).getAll('transactions')).toEqual([])
  })
})

describe('the body the dialog sends', () => {
  it('names a second account only for a transfer', () => {
    // A look at Transfer leaves the hidden "To account" with a value; it is not sent.
    const values = {
      description: 'Gym',
      amount: '30',
      type: 'expense',
      frequency: 'monthly',
      day_of_month: '',
      next_date: '2026-03-05',
      account_id: String(GIRO),
      transfer_account_id: String(SAVINGS),
      category_id: '',
      notes: '',
    }
    expect(recurringBody(values)).toMatchObject({ account_id: GIRO, transfer_account_id: null })
    expect(recurringBody({ ...values, type: 'transfer' })).toMatchObject({
      account_id: GIRO,
      transfer_account_id: SAVINGS,
    })
  })
})
