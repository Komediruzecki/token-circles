/**
 * The Accounts dialog, run against the real local-first router on fake-indexeddb.
 *
 * It answered every refused save with "Failed to create account" or "Failed to update account",
 * with nothing in the dialog marked. A base currency other than the one this browser asks for is
 * a 409 whose sentence says what to do about it (Settings), and the dialog dropped it for those
 * words. A balance it could not read was a toast too.
 *
 * Now the dialog checks the values with the rules both runtimes run (shared/accountSchema.ts),
 * marks the field in its own words, and puts the 409's sentence in the dialog's notice. An edit
 * checks only what it changes, so an account saved under older rules can still be edited.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_MESSAGES as M } from '../../../../shared/accountSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

vi.mock('../../components/AccountConstellation', () => ({ default: () => null }))

const EVERYDAY = 1
const LONG_NAME = 'Joint account '.repeat(8).trim()
const CONFLICT =
  'Account balances use USD. Change the base currency in Settings before adding financial data.'

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Accounts'), import('../../core/storage/localApiRouter')])
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
  await db.add('accounts', {
    id: EVERYDAY,
    profile_id: 1,
    name: 'Everyday',
    type: 'giro',
    bank_name: 'Credit Union',
    currency: 'EUR',
    balance: 920,
    starting_balance: 1000,
    starting_date: '2026-01-01',
    notes: '',
  } as never)
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
  setPage('accounts')
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
  const { default: Accounts } = await import('../Accounts')
  dispose = render(() => <Accounts />, host)
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-test-id="account-card"]').length).toBeGreaterThan(0)
  })
}

const dialog = () =>
  host.querySelector<HTMLElement>(
    '[data-test-id="add-account-modal"], [data-test-id="edit-account-modal"]'
  )

async function openAdd(): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-test-id="add-account-btn"]')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

async function openEdit(name: string): Promise<void> {
  const card = Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="account-card"]')).find(
    (c) => c.querySelector('[data-test-id="account-name"]')?.textContent === name
  )
  if (!card) throw new Error(`no account "${name}"`)
  card.querySelector<HTMLButtonElement>('[data-test-id="account-edit-btn"]')!.click()
  await vi.waitFor(() => {
    expect(field('Account Name').value).toBe(name)
  })
}

/** The control under the label that starts with `text`, as a person finds it. */
function field(text: string): HTMLInputElement {
  const label = Array.from(dialog()!.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field in the dialog`)
  return label.parentElement!.querySelector<HTMLInputElement>('input, select')!
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

const notice = () => dialog()?.querySelector('[role="alert"]')?.textContent ?? ''
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function accounts(): Promise<Row[]> {
  return (await (await getDB()).getAll('accounts')) as Row[]
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('adding an account', () => {
  it('marks a blank name in its own words, focuses it, and sends nothing', async () => {
    await mountPage()
    await openAdd()

    submit()
    await settle()

    expect(field('Account Name').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('Account Name'))).toBe(M.name)
    expect(document.activeElement).toBe(field('Account Name'))
    expect(await accounts()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('marks a balance it cannot read, under that balance', async () => {
    await mountPage()
    await openAdd()
    type(field('Account Name'), 'Wallet')
    type(field('Starting Balance'), '12,3,4')
    type(field('Current Balance'), 'lots')

    submit()
    await settle()

    expect(describedBy(field('Starting Balance'))).toBe(M.startingBalance)
    expect(describedBy(field('Current Balance'))).toBe(M.balance)
    expect(document.activeElement).toBe(field('Starting Balance'))
    expect(await accounts()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('adds an account at its starting balance, a comma for the cents, says so, and closes', async () => {
    await mountPage()
    await openAdd()
    type(field('Account Name'), 'Holiday fund')
    type(field('Starting Balance'), '1250,50')

    submit()

    await vi.waitFor(async () => {
      expect((await accounts()).find((a) => a.name === 'Holiday fund')).toMatchObject({
        type: 'giro',
        starting_balance: 1250.5,
        balance: 1250.5,
        currency: 'EUR',
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "Holiday fund" to your accounts.'])
    expect(failureToasts()).toEqual([])
  })

  it('says why a different base currency is refused, in the dialog', async () => {
    await (await getDB()).put('settings', { key: 'currency', value: 'USD' })
    await mountPage()
    await openAdd()
    type(field('Account Name'), 'Dollars')

    submit()

    await vi.waitFor(() => {
      expect(notice()).toBe(CONFLICT)
    })
    expect(dialog()).not.toBeNull()
    expect((await accounts()).map((a) => a.name)).toEqual(['Everyday'])
    expect(failureToasts()).toEqual([])
  })
})

describe('editing an account', () => {
  it('saves a new name, and names it in the toast', async () => {
    await mountPage()
    await openEdit('Everyday')
    type(field('Account Name'), 'Main')

    submit()

    await vi.waitFor(async () => {
      expect((await (await getDB()).get('accounts', EVERYDAY)) as Row).toMatchObject({
        name: 'Main',
        balance: 920,
        starting_balance: 1000,
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Saved your changes to "Main".'])
  })

  it('marks a name the edit blanks, and a current balance it cannot read', async () => {
    await mountPage()
    await openEdit('Everyday')
    type(field('Account Name'), ' ')
    type(field('Current Balance'), 'abc')

    submit()
    await settle()

    expect(describedBy(field('Account Name'))).toBe(M.name)
    expect(describedBy(field('Current Balance'))).toContain(M.balance)
    expect(((await (await getDB()).get('accounts', EVERYDAY)) as Row).name).toBe('Everyday')
    expect(failureToasts()).toEqual([])
  })

  it('saves an account kept under older rules, checking only what changed', async () => {
    const db = await getDB()
    await db.put('accounts', { ...(await db.get('accounts', EVERYDAY)), name: LONG_NAME })
    await mountPage()
    await openEdit(LONG_NAME)
    type(field('Bank / Institution'), 'Savings Bank')

    submit()

    await vi.waitFor(async () => {
      expect((await db.get('accounts', EVERYDAY)) as Row).toMatchObject({
        name: LONG_NAME,
        bank_name: 'Savings Bank',
      })
    })
    expect(failureToasts()).toEqual([])
  })

  it('says why a different base currency is refused, in the dialog', async () => {
    // This account and the profile are in USD; this browser asks for EUR.
    const db = await getDB()
    await db.put('settings', { key: 'currency', value: 'USD' })
    await db.put('accounts', { ...(await db.get('accounts', EVERYDAY)), currency: 'USD' })
    await mountPage()
    await openEdit('Everyday')
    type(field('Account Name'), 'Main')

    submit()

    await vi.waitFor(() => {
      expect(notice()).toBe(CONFLICT)
    })
    expect(dialog()).not.toBeNull()
    expect(((await db.get('accounts', EVERYDAY)) as Row).name).toBe('Everyday')
    expect(failureToasts()).toEqual([])
  })
})

describe('an account of a type this build does not know', () => {
  // A later build, or an API client, can store a type this one does not have. The page shows it as
  // a plain account, and an edit sends the type back as it is, so a rollback changes nothing.
  it('shows as a plain account, and an edit keeps its type', async () => {
    const db = await getDB()
    await db.put('accounts', { ...(await db.get('accounts', EVERYDAY)), type: 'sock_drawer' })
    await mountPage()
    const card = host.querySelector<HTMLElement>('[data-test-id="account-card"]')!
    expect(card.querySelector('[data-test-id="account-type"]')?.textContent).toBe('account')

    await openEdit('Everyday')
    type(field('Account Name'), 'Sock drawer')
    submit()

    await vi.waitFor(async () => {
      expect((await db.get('accounts', EVERYDAY)) as Row).toMatchObject({
        name: 'Sock drawer',
        type: 'sock_drawer',
      })
    })
    expect(failureToasts()).toEqual([])
  })

  it('opens the edit with its type shown as a plain account, not a blank select', async () => {
    const db = await getDB()
    await db.put('accounts', { ...(await db.get('accounts', EVERYDAY)), type: 'sock_drawer' })
    await mountPage()

    await openEdit('Everyday')

    const select = field('Account Type') as unknown as HTMLSelectElement
    expect(select.value).toBe('sock_drawer')
    expect(select.selectedIndex).toBeGreaterThanOrEqual(0)
    const chosen = select.selectedOptions[0]
    expect(chosen.textContent).toBe('Other account')
    // It says what the account is; it is not a type anyone can pick.
    expect(chosen.disabled).toBe(true)
  })

  it('offers no plain-account option for an account of a type it has', async () => {
    await mountPage()
    await openEdit('Everyday')

    const select = field('Account Type') as unknown as HTMLSelectElement
    expect(select.value).toBe('giro')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'giro',
      'savings',
      'ib',
      'cash',
      'credit',
    ])
  })
})

describe('a credit card and an overdraft', () => {
  it('shows a credit card with its badge and an icon of its own, apart from cash', async () => {
    const db = await getDB()
    const everyday = (await db.get('accounts', EVERYDAY)) as Row
    await db.put('accounts', { ...everyday, id: 2, name: 'Visa', type: 'credit', balance: -350 })
    await db.put('accounts', { ...everyday, id: 3, name: 'Wallet', type: 'cash', balance: 40 })
    await mountPage()
    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-test-id="account-card"]')).toHaveLength(3)
    })
    const card = (name: string) =>
      Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="account-card"]')).find(
        (c) => c.querySelector('[data-test-id="account-name"]')?.textContent === name
      )!
    const icon = (name: string) =>
      card(name).querySelector('[data-test-id="account-icon"] path')?.getAttribute('d')
    expect(card('Visa').querySelector('[data-test-id="account-type"]')?.textContent).toBe('credit')
    expect(new Set([icon('Visa'), icon('Wallet'), icon('Everyday')]).size).toBe(3)
  })

  it("opens a credit card's edit on Credit Card, not as a plain account", async () => {
    const db = await getDB()
    await db.put('accounts', { ...(await db.get('accounts', EVERYDAY)), type: 'credit' })
    await mountPage()

    await openEdit('Everyday')

    const select = field('Account Type') as unknown as HTMLSelectElement
    expect(select.value).toBe('credit')
    const chosen = select.selectedOptions[0]
    expect(chosen.textContent).toBe('Credit Card')
    expect(chosen.disabled).toBe(false)
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain('Other account')
  })

  it('shows a limit and a rate for a credit card, and stores them with what is owed', async () => {
    await mountPage()
    await openAdd()
    type(field('Account Name'), 'Visa')
    type(field('Account Type'), 'credit')
    await vi.waitFor(() => {
      expect(field('Credit Limit')).toBeTruthy()
    })
    expect(describedBy(field('Credit Limit'))).toBe('The most the card lets you owe.')
    expect(describedBy(field('Interest Rate'))).toBe(
      'The yearly rate the card charges on money you owe.'
    )
    expect(describedBy(field('Current Balance'))).toBe(
      'Money you owe on the card is a balance below zero, like -350.'
    )

    type(field('Credit Limit'), '2000')
    type(field('Interest Rate'), '15,9')
    type(field('Current Balance'), '-350')
    submit()

    await vi.waitFor(async () => {
      expect((await accounts()).find((row) => row.name === 'Visa')).toMatchObject({
        type: 'credit',
        credit_limit: 2000,
        credit_rate: 15.9,
        balance: -350,
      })
    })
    expect(failureToasts()).toEqual([])
  })

  it("calls a Giro account's limit its overdraft, and sends neither for a savings account", async () => {
    await mountPage()
    await openAdd()
    type(field('Account Name'), 'Pot')
    expect(field('Overdraft Limit')).toBeTruthy()
    expect(describedBy(field('Interest Rate'))).toBe(
      'The yearly rate the bank charges while the account is below zero.'
    )
    type(field('Overdraft Limit'), '500')

    type(field('Account Type'), 'savings')
    await vi.waitFor(() => {
      expect(() => field('Overdraft Limit')).toThrow()
    })
    expect(() => field('Interest Rate')).toThrow()
    submit()

    await vi.waitFor(async () => {
      expect((await accounts()).find((row) => row.name === 'Pot')).toMatchObject({
        type: 'savings',
        credit_limit: null,
        credit_rate: null,
      })
    })
    expect(failureToasts()).toEqual([])
  })

  it('opens an overdraft with its limit and rate, and making it savings takes both away', async () => {
    const db = await getDB()
    await db.put('accounts', {
      ...(await db.get('accounts', EVERYDAY)),
      credit_limit: 500,
      credit_rate: 9.5,
    })
    await mountPage()
    await openEdit('Everyday')
    expect(field('Overdraft Limit').value).toBe('500')
    expect(field('Interest Rate').value).toBe('9.5')

    type(field('Account Type'), 'savings')
    submit()

    await vi.waitFor(async () => {
      expect((await db.get('accounts', EVERYDAY)) as Row).toMatchObject({
        type: 'savings',
        credit_limit: null,
        credit_rate: null,
      })
    })
    expect(failureToasts()).toEqual([])
  })

  it('marks a rate it cannot read, under the rate, and sends nothing', async () => {
    await mountPage()
    await openAdd()
    type(field('Account Name'), 'Visa')
    type(field('Account Type'), 'credit')
    await vi.waitFor(() => {
      expect(field('Interest Rate')).toBeTruthy()
    })
    type(field('Interest Rate'), 'high')
    submit()
    await settle()

    expect(field('Interest Rate').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('Interest Rate'))).toContain(M.creditRate)
    expect(await accounts()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })
})

describe('an account a type v4 renamed', () => {
  // The Worker hands the Accounts page the stored type as it is, so a row older versions saved
  // reaches the form as `checking` or `retirement`. The form opens it as the type that replaced
  // it, and the edit's check reads the two as the same type, so an untouched save writes nothing.
  it('opens as the type that replaced it', async () => {
    const { createAccountForm } = await import('../accountForm')
    const opened = (type: string) =>
      createRoot((dispose) => {
        const form = createAccountForm({ onSaved: () => {} })
        form.open({ id: 7, name: 'Old', type, balance: 0 })
        const value = form.values.type
        dispose()
        return value
      })

    expect(opened('checking')).toBe('giro')
    expect(opened('retirement')).toBe('ib')
    expect(opened('investment')).toBe('ib')
    expect(opened('sock_drawer')).toBe('sock_drawer')
    expect(opened('savings')).toBe('savings')
  })
})
