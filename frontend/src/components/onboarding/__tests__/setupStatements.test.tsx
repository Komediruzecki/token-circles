/**
 * Setup's statement step over a whole setup (review of 19 Nov, findings 2 and 12): where each
 * statement goes by default as files come and go, and what setup counts as imported when the
 * Import page imported while it waited. The wizard is mounted as App mounts it, under
 * `onboardingOpen()`, so waiting on the Import page closes it and the way back opens a new one.
 * Local-first on fake-indexeddb; made-up payees and amounts only.
 */
import { Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setProfiles } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import {
  goToOnboardingStep,
  noteImportWhileSetupWaits,
  onboardingOpen,
  onboardingStep,
  pauseOnboarding,
  prevOnboardingStep,
  resumeOnboarding,
  setOnboardingOwner,
  setupSoFar,
  skipOnboarding,
  startOnboarding,
} from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'
import { takeHandedImportFile } from '../../../features/import/importHandoff'

const REVOLUT_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'
const revolut = (rows: string[]) => `${[REVOLUT_HEADER, ...rows].join('\n')}\n`
const REVOLUT_MAY = revolut([
  'CARD_PAYMENT,Current,2026-05-03 10:00:00,2026-05-03 10:00:00,Example Cafe,-3.40,0,EUR,COMPLETED,496.60',
  'CARD_PAYMENT,Current,2026-05-12 10:00:00,2026-05-12 10:00:00,Example Books,-18.00,0,EUR,COMPLETED,478.60',
])
const REVOLUT_JUNE = revolut([
  'CARD_PAYMENT,Current,2026-06-02 10:00:00,2026-06-02 10:00:00,Example Bakery,-2.10,0,EUR,COMPLETED,476.50',
])
const REVOLUT_USD = revolut([
  'CARD_PAYMENT,Current,2026-05-04 10:00:00,2026-05-04 10:00:00,Example Diner,-7.00,0,USD,COMPLETED,93.00',
])
const N26 = `${[
  '"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
  '2026-05-05,2026-05-05,Example Grocer,,Presentment,,Main Account,-4.20,,,',
  '2026-05-09,2026-05-09,Example Gym,,Presentment,,Main Account,-29.00,,,',
].join('\n')}\n`
/** A table from no bank setup reads: it goes to the Import page. */
const OTHER =
  'When,What,How much\n2026-05-20,Example Market,-6.50\n2026-05-21,Example Kiosk,-1.20\n'

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

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))
const waitLong = { timeout: 15_000 }
const all = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-test-id="${id}"]`)]
const one = (id: string) => all(id)[0] ?? null

/** The wizard as App mounts it: closed, it is gone; opened again, it is a new one. */
async function mount(step: 'account' | 'import'): Promise<void> {
  startOnboarding(step)
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(
    () => (
      <Show when={onboardingOpen()}>
        <OnboardingWizard selectProfiles={() => {}} />
      </Show>
    ),
    host
  )
  await settle()
}

function choose(files: Array<[string, string]>): void {
  const made = files.map(([name, text]) => new File([text], name, { type: 'text/csv' }))
  const input = one('onboarding-import-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: made, configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Each file card as [file, the account its Goes into shows]. */
const targets = () =>
  all('onboarding-import-file').map((card) => {
    const select = card.querySelector<HTMLSelectElement>(
      '[data-test-id="onboarding-import-target"]'
    )
    const shown = select ? ([...select.options].find((o) => o.selected)?.textContent ?? null) : null
    return [card.getAttribute('data-file'), shown]
  })

async function untilStates(states: string[]): Promise<void> {
  await vi.waitFor(() => {
    expect(all('onboarding-import-file').map((c) => c.getAttribute('data-state'))).toEqual(states)
  }, waitLong)
}

/** Setup's account step, making the main account, then on to the statement. */
async function makeMainAccount(name: string): Promise<void> {
  await mount('account')
  const field = one('onboarding-account-name') as HTMLInputElement
  field.value = name
  field.dispatchEvent(new Event('input', { bubbles: true }))
  one('onboarding-account-create')!.click()
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('import')
  }, waitLong)
}

async function importReady(): Promise<void> {
  one('onboarding-import-selected')!.click()
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('subscriptions')
  }, waitLong)
}

describe('where a statement goes, over the whole setup', () => {
  it('picked one after another: a second bank gets a new account, not the main one', async () => {
    await makeMainAccount('Main checking')
    choose([['revolut.csv', REVOLUT_MAY]])
    await untilStates(['ready'])
    expect(targets()).toEqual([['revolut.csv', 'Main checking']])
    await importReady()

    goToOnboardingStep('import')
    await settle()
    one('onboarding-import-another')!.click()
    await settle()
    choose([['n26.csv', N26]])
    await untilStates(['ready'])

    expect(targets()).toEqual([['n26.csv', 'New account: N26 EUR']])
  })

  it('a file removed: the one left takes the main account', async () => {
    await makeMainAccount('Main checking')
    choose([
      ['revolut.csv', REVOLUT_MAY],
      ['n26.csv', N26],
    ])
    await untilStates(['ready', 'ready'])
    expect(targets()).toEqual([
      ['revolut.csv', 'Main checking'],
      ['n26.csv', 'New account: N26 EUR'],
    ])

    all('onboarding-import-remove')[0].click()
    await untilStates(['ready'])

    expect(targets()).toEqual([['n26.csv', 'Main checking']])
  })

  it('two currencies of one bank: the one in another currency gets an account of its own', async () => {
    await makeMainAccount('Main checking')
    choose([
      ['revolut-eur.csv', REVOLUT_MAY],
      ['revolut-usd.csv', REVOLUT_USD],
    ])
    await untilStates(['ready', 'ready'])

    expect(targets()).toEqual([
      ['revolut-eur.csv', 'Main checking'],
      ['revolut-usd.csv', 'New account: Revolut USD'],
    ])
  })

  it('a target picked by hand stays when another file comes, and the rest follow the rule', async () => {
    await makeMainAccount('Main checking')
    choose([
      ['revolut-may.csv', REVOLUT_MAY],
      ['n26.csv', N26],
    ])
    await untilStates(['ready', 'ready'])
    const first = all('onboarding-import-target')[0] as HTMLSelectElement
    first.value = 'Revolut EUR'
    first.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => {
      expect(targets()[0]).toEqual(['revolut-may.csv', 'New account: Revolut EUR'])
    }, waitLong)

    choose([['revolut-june.csv', REVOLUT_JUNE]])
    await untilStates(['ready', 'ready', 'ready'])

    expect(targets()).toEqual([
      ['revolut-may.csv', 'New account: Revolut EUR'],
      ['n26.csv', 'Main checking'],
      ['revolut-june.csv', 'New account: Revolut EUR'],
    ])
  })
})

describe('what setup counts as imported', () => {
  it("counts the Import page's import while it waited as its own, on the step and after it", async () => {
    await mount('import')
    choose([['export.csv', OTHER]])
    await untilStates(['unreadable'])
    one('onboarding-import-open')!.click()
    await vi.waitFor(() => {
      expect(onboardingOpen()).toBe(false)
    })
    expect(host.textContent).toBe('')

    // The Import page imports the file while setup waits.
    noteImportWhileSetupWaits({ imported: 2, createdAccounts: [], statements: [] })
    await expect(resumeOnboarding()).resolves.toBe('opened')
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    })

    // Back to the statement: it shows what came in, and nothing to hand over again.
    prevOnboardingStep()
    await vi.waitFor(() => {
      expect(one('onboarding-import-done')?.textContent).toBe('Imported 2 transactions.')
    }, waitLong)
    expect(host.textContent).not.toContain('Open export.csv in Import')
    expect(one('onboarding-import-skip')).toBeNull()

    one('onboarding-next')!.click()
    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('subscriptions')
    })
    expect(setupSoFar().imported).toBe(2)
  })

  it('says what the whole setup brought in, after another statement', async () => {
    await makeMainAccount('Main checking')
    choose([['revolut.csv', REVOLUT_MAY]])
    await untilStates(['ready'])
    await importReady()
    goToOnboardingStep('import')
    await settle()
    expect(one('onboarding-import-done')?.textContent).toBe(
      'Imported 2 transactions into Main checking.'
    )

    one('onboarding-import-another')!.click()
    await settle()
    choose([['n26.csv', N26]])
    await untilStates(['ready'])
    await importReady()
    goToOnboardingStep('import')
    await settle()

    expect(one('onboarding-import-done')?.textContent).toBe(
      'Imported 4 transactions into Main checking and N26 EUR.'
    )
    expect(setupSoFar().statements.map((s) => [s.bankId, s.account])).toEqual([
      ['revolut', 'Main checking'],
      ['n26', 'N26 EUR'],
    ])
  })

  it('pauses with what it brought in, and a new wizard knows the main account it made', async () => {
    await makeMainAccount('Main checking')
    choose([
      ['revolut.csv', REVOLUT_MAY],
      ['export.csv', OTHER],
    ])
    await untilStates(['ready', 'unreadable'])
    one('onboarding-import-selected')!.click()
    await vi.waitFor(() => {
      expect(one('onboarding-import-done')).not.toBeNull()
    }, waitLong)
    all('onboarding-import-open-file')[0]?.click()
    if (onboardingOpen()) one('onboarding-import-open')?.click()
    await vi.waitFor(() => {
      expect(onboardingOpen()).toBe(false)
    })
    expect(setupSoFar()).toMatchObject({ main: 'Main checking', imported: 2 })

    await expect(resumeOnboarding()).resolves.toBe('opened')
    expect(onboardingStep()).toBe('subscriptions')
    pauseOnboarding()
  })
})
