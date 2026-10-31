/**
 * Setup's statement step (FirstImport.tsx), run against the real local-first router on
 * fake-indexeddb.
 *
 * The step used to embed the Import page's whole flow: its tabs, the rules editor, the column
 * mapping and the preview table. Now a statement from a bank the app reads goes in with one tap,
 * into the account setup just made or a new one named for the bank. Any other file gets a way out
 * (setup finishes and the Import page opens with it) or is left behind.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setProfiles } from '../../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import {
  getOnboardingStatus,
  goToOnboardingStep,
  onboardingOpen,
  onboardingStep,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
} from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'
import { handedImportFile, takeHandedImportFile } from '../../../features/import/importHandoff'

type Row = Record<string, unknown>

/** A Revolut export, hand-typed: seven transactions between 14 April and 1 July. */
const REVOLUT_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'
const REVOLUT_ROWS = [
  'CARD_PAYMENT,Current,2026-04-14 10:00:00,2026-04-14 10:00:00,Netflix,-13.99,0,EUR,COMPLETED,1000.00',
  'CARD_PAYMENT,Current,2026-05-14 10:00:00,2026-05-14 10:00:00,Netflix,-13.99,0,EUR,COMPLETED,986.01',
  'CARD_PAYMENT,Current,2026-06-14 10:00:00,2026-06-14 10:00:00,Netflix,-13.99,0,EUR,COMPLETED,972.02',
  'CARD_PAYMENT,Current,2026-06-01 09:00:00,2026-06-01 09:00:00,Spotify P0FF8B1C34,-11.99,0,EUR,COMPLETED,960.03',
  'CARD_PAYMENT,Current,2026-07-01 09:00:00,2026-07-01 09:00:00,Spotify P0FF8B1C34,-11.99,0,EUR,COMPLETED,948.04',
  'CARD_PAYMENT,Current,2026-06-20 12:00:00,2026-06-20 12:00:00,Konzum Zagreb,-45.20,0,EUR,COMPLETED,902.84',
  'TOPUP,Current,2026-06-02 08:00:00,2026-06-02 08:00:00,Payroll June,2000.00,0,EUR,COMPLETED,2902.84',
]
const revolut = (rows = REVOLUT_ROWS) => `${[REVOLUT_HEADER, ...rows].join('\n')}\n`

/** A table no bank adapter recognises. */
const UNKNOWN_TABLE = 'When,What,How much\n2026-06-01,Groceries,-10.00\n2026-06-02,Bus,-2.50\n'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../OnboardingWizard'), import('../../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  setOnboardingOwner('local')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  for (const toast of toasts()) removeToast(toast.id)
  setProfiles([{ id: 1, name: 'Personal' }] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
  takeHandedImportFile()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  if (onboardingOpen()) skipOnboarding()
  setOnboardingOwner(null)
  setCurrentProfile(null)
  takeHandedImportFile()
  window.location.hash = ''
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const waitLong = { timeout: 15_000 }

async function openAt(step: 'account' | 'import' | 'subscriptions'): Promise<void> {
  startOnboarding(step)
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)
  await settle()
}

/** A fresh wizard, as setup run again opens one: nothing from the last visit. */
async function reopenAt(step: 'import'): Promise<void> {
  dispose?.()
  host.replaceChildren()
  await openAt(step)
}

const byTestId = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)

/** Choose `text` as the file `name`, as the system's picker hands one over. */
function choose(name: string, text: string): File {
  const file = new File([text], name, { type: 'text/csv' })
  const input = byTestId('onboarding-import-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return file
}

const fileState = () => byTestId('onboarding-import-file')?.getAttribute('data-state') ?? null

async function readUntil(state: string): Promise<void> {
  await vi.waitFor(() => {
    expect(fileState()).toBe(state)
  }, waitLong)
}

const options = () =>
  [...(byTestId('onboarding-import-target') as HTMLSelectElement).options].map((o) => ({
    text: o.textContent,
    selected: o.selected,
  }))

const transactions = async () => (await (await getDB()).getAll('transactions')) as Row[]
const accounts = async () => (await (await getDB()).getAll('accounts')) as Row[]

/** The step's footer: its primary action and, where the step can wait, Skip. */
const footer = () =>
  [...host.querySelectorAll<HTMLButtonElement>('footer button')].map((b) => ({
    id: b.getAttribute('data-test-id'),
    text: b.textContent?.trim(),
  }))

describe('a statement from a bank the app reads', () => {
  it('starts at the picker, and names the banks it reads', async () => {
    await openAt('import')

    expect(byTestId('onboarding-import-pick')?.textContent).toContain('Choose a statement')
    const banks = byTestId('onboarding-import-banks')?.textContent ?? ''
    expect(banks).toMatch(/^Reads exports from .*Revolut.* and .+\./)
    expect(banks).toContain('Any other file goes to the Import page, where you match its columns.')
    expect(footer()).toEqual([
      { id: 'onboarding-import-skip', text: 'Skip' },
      { id: 'onboarding-import-choose', text: 'Choose a file' },
    ])
  })

  it('goes into a new account named for the bank, and imports in one tap', async () => {
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    expect(byTestId('onboarding-import-meta')?.textContent).toBe('Revolut · 7 new transactions')
    // Each date in one piece: a narrow card wraps between them, never inside one.
    expect(byTestId('onboarding-import-dates')?.textContent).toMatch(
      /^14\u00a0Apr(\u00a02026)? to 1\u00a0Jul(\u00a02026)?$/
    )
    const [target] = options()
    expect(options()).toHaveLength(1)
    expect(target).toEqual({ text: expect.stringMatching(/^New account: Revolut/), selected: true })
    expect(footer()).toEqual([
      { id: 'onboarding-import-skip', text: 'Skip' },
      { id: 'onboarding-import-selected', text: 'Import 7' },
    ])

    byTestId('onboarding-import-selected')!.click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)
    const made = await accounts()
    expect(made.map((a) => `New account: ${String(a.name)}`)).toEqual([target.text])
    const stored = await transactions()
    expect(stored).toHaveLength(7)
    expect(new Set(stored.map((t) => t.account_id))).toEqual(new Set([made[0].id]))
  })

  it('goes into the account setup just made', async () => {
    await openAt('account')
    const name = byTestId('onboarding-account-name') as HTMLInputElement
    name.focus()
    name.value = 'Main checking'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    byTestId('onboarding-account-create')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('import')
    }, waitLong)

    choose('revolut.csv', revolut())
    await readUntil('ready')

    expect(options().find((o) => o.selected)?.text).toBe('Main checking')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)
    expect((await accounts()).map((a) => a.name)).toEqual(['Main checking'])
    expect(await transactions()).toHaveLength(7)
  })

  it('reopened at this step, goes into the account the profile has, not a new one', async () => {
    // Setup left at the statement (to go and export it) reopens here, with nothing made on this
    // visit; so does setup run again over a profile that has an account.
    const db = await getDB()
    const main = (await db.add('accounts', {
      name: 'Main Checking',
      type: 'giro',
      currency: 'EUR',
      balance: 1500,
      profile_id: 1,
    })) as number
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    expect(options().find((o) => o.selected)?.text).toBe('Main Checking')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)
    expect((await accounts()).map((a) => a.name)).toEqual(['Main Checking'])
    const stored = await transactions()
    expect(stored).toHaveLength(7)
    expect(new Set(stored.map((t) => t.account_id))).toEqual(new Set([main]))
  })

  it("reopened with several accounts, picks the newest in the statement's currency", async () => {
    const db = await getDB()
    for (const [name, currency] of [
      ['Old euros', 'EUR'],
      ['New euros', 'EUR'],
      ['Dollars', 'USD'],
    ]) {
      await db.add('accounts', { name, type: 'giro', currency, balance: 100, profile_id: 1 })
    }
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    // The newest account is in dollars; the statement is in euros.
    expect(options().find((o) => o.selected)?.text).toBe('New euros')
    expect(options().map((o) => o.text)).toEqual([
      'Old euros',
      'New euros',
      'Dollars',
      expect.stringMatching(/^New account: Revolut/),
    ])
  })

  it('reopened with accounts only in another currency, a statement goes into a new account', async () => {
    const db = await getDB()
    await db.add('accounts', {
      name: 'Dollars',
      type: 'giro',
      currency: 'USD',
      balance: 100,
      profile_id: 1,
    })
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    // The statement is in euros; the only account keeps dollars.
    expect(options().find((o) => o.selected)?.text).toMatch(/^New account: Revolut/)
  })

  it('counts a row the statement repeats once, as the import does', async () => {
    await openAt('import')
    // The last row twice, to the second: the statement's own repeat, left out of the import.
    choose('revolut.csv', revolut([...REVOLUT_ROWS, REVOLUT_ROWS[6]]))
    await readUntil('ready')

    expect(byTestId('onboarding-import-selected')?.textContent).toBe('Import 7')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)
    expect(await transactions()).toHaveLength(7)
  })

  it('counts only what is new when part of the statement is here already', async () => {
    await openAt('import')
    choose('revolut.csv', revolut(REVOLUT_ROWS.slice(0, 3)))
    await readUntil('ready')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)

    await reopenAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    expect(byTestId('onboarding-import-meta')?.textContent).toBe('Revolut · 4 new transactions')
    expect(host.textContent).toContain(
      '3 transactions in it are here already and stay as they are.'
    )
    expect(byTestId('onboarding-import-selected')?.textContent).toBe('Import 4')
  })

  it('says when nothing in it is new, and Continue goes on to Done', async () => {
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)

    await reopenAt('import')
    choose('revolut.csv', revolut())
    await readUntil('nothing-new')

    expect(byTestId('onboarding-import-nothing-new')?.textContent).toBe(
      'Nothing new: every transaction in it is here already.'
    )
    expect(footer()).toEqual([{ id: 'onboarding-next', text: 'Continue' }])
    byTestId('onboarding-next')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('done')
    })
    expect(await transactions()).toHaveLength(7)
  })

  it('asks before Skip drops a statement ready to import, and stays when told to keep it', async () => {
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    byTestId('onboarding-import-skip')!.click()
    await vi.waitFor(() => {
      expect(confirmRequests().map((r) => [r.message, r.confirmText, r.cancelText])).toEqual([
        [
          'Leave this statement out? Nothing from it is imported. The Import page can bring it in later.',
          'Leave it out',
          'Keep it',
        ],
      ])
    })
    resolveConfirm(confirmRequests()[0].id, false)
    await settle()
    expect(onboardingStep()).toBe('import')
    expect(fileState()).toBe('ready')

    byTestId('onboarding-import-skip')!.click()
    await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
    })
    resolveConfirm(confirmRequests()[0].id, true)
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('done')
    })
    expect(await transactions()).toEqual([])
  })

  it('forgets the file on Remove, back to the picker', async () => {
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')

    byTestId('onboarding-import-remove')!.click()
    await settle()

    expect(byTestId('onboarding-import-file')).toBeNull()
    expect(byTestId('onboarding-import-pick')).not.toBeNull()
    expect(footer().map((b) => b.id)).toEqual([
      'onboarding-import-skip',
      'onboarding-import-choose',
    ])
  })
})

describe('a file the step cannot import', () => {
  it('says it does not know the bank, and Open in Import finishes setup with the file', async () => {
    await openAt('import')
    const file = choose('export.csv', UNKNOWN_TABLE)
    await readUntil('unreadable')

    expect(byTestId('onboarding-import-problem')?.textContent).toBe(
      "We don't recognise the bank in this file. The Import page reads it once you match its columns."
    )
    expect(footer()).toEqual([
      { id: 'onboarding-import-skip', text: 'Skip' },
      { id: 'onboarding-import-open', text: 'Open in Import' },
    ])

    byTestId('onboarding-import-open')!.click()

    expect(onboardingOpen()).toBe(false)
    expect(getOnboardingStatus('local')).toBe('completed')
    expect(window.location.hash).toBe('#import')
    // File Upload reads any table, and goes on to matching its columns.
    expect(handedImportFile()).toEqual({ file, tab: 'file-upload' })
    expect(await transactions()).toEqual([])
  })

  it('hands a bank statement with no transactions in it to Bank Imports', async () => {
    await openAt('import')
    const file = choose('revolut.csv', revolut([]))
    await readUntil('unreadable')

    expect(byTestId('onboarding-import-problem')?.textContent).toBe(
      "We couldn't read any transactions in this file. The Import page shows what's in it."
    )
    byTestId('onboarding-import-open')!.click()

    expect(handedImportFile()).toEqual({ file, tab: 'bank-imports' })
  })

  it('goes on without it: Skip asks nothing, hands nothing over, and goes to Done', async () => {
    await openAt('import')
    choose('export.csv', UNKNOWN_TABLE)
    await readUntil('unreadable')

    byTestId('onboarding-import-skip')!.click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('done')
    })
    expect(confirmRequests()).toEqual([])
    expect(handedImportFile()).toBeNull()
    expect(onboardingOpen()).toBe(true)
  })
})

describe('back on the step after an import', () => {
  it('shows what went in, and Continue goes on to the subscriptions it made possible', async () => {
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)

    goToOnboardingStep('import')
    await settle()

    expect(fileState()).toBe('imported')
    expect(byTestId('onboarding-import-done')?.textContent).toMatch(
      /^Imported 7 transactions into .+\.$/
    )
    expect(byTestId('onboarding-import-another')).not.toBeNull()
    byTestId('onboarding-next')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    })
  })
})

describe('leaving setup at its subscriptions', () => {
  /** What Close asks there; then Stay. */
  const closeAsks = async (): Promise<string> => {
    byTestId('onboarding-skip')!.click()
    await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
    })
    const [{ id, message }] = confirmRequests()
    resolveConfirm(id, false)
    await settle()
    return message
  }

  it('after a statement went in on this visit, says the import is kept', async () => {
    await openAt('import')
    choose('revolut.csv', revolut())
    await readUntil('ready')
    byTestId('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    }, waitLong)

    expect(await closeAsks()).toBe(
      'Leave setup? Your import is saved, and Bills can scan for subscriptions any time.'
    )
    expect(onboardingStep()).toBe('subscriptions')
  })

  it('reopened there with nothing imported on this visit, claims no import', async () => {
    await openAt('subscriptions')

    expect(await closeAsks()).toBe(
      'Leave setup? Bills can scan your transactions for subscriptions any time, and Settings can run setup again.'
    )
    expect(onboardingStep()).toBe('subscriptions')
  })
})
