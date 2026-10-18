/**
 * The onboarding wizard's "Name your space", "Create your first account" and subscriptions steps,
 * run against the real local-first router on fake-indexeddb.
 *
 * Both forms used to toast a caught error's own words with nothing marked, and a blank name kept
 * the button disabled without saying why. Now each checks by the rules both runtimes run and marks
 * the field in their words; a refusal from the runtime is marked at its field, or said in the
 * step's notice when no field is the reason. "Add 2 subscriptions & continue" moved on whether or
 * not anything was added.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_MESSAGES } from '../../../../../shared/accountSchema'
import { BILL_MESSAGES } from '../../../../../shared/billSchema'
import { PROFILE_MESSAGES, profileNameTaken } from '../../../../../shared/profileSchema'
import { getProfiles, setCurrentProfile, setProfiles } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { onboardingStep, skipOnboarding, startOnboarding } from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'

type Row = Record<string, unknown>

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
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: 2, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  for (const toast of toasts()) removeToast(toast.id)
  setProfiles([
    { id: 1, name: 'Personal' },
    { id: 2, name: 'Household' },
  ] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  skipOnboarding()
  setCurrentProfile(null)
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function openAt(step: 'space' | 'account' | 'subscriptions'): Promise<void> {
  startOnboarding(step)
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)
  await settle()
}

const byTestId = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)

function type(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

const nameField = () => byTestId('onboarding-profile-name') as HTMLInputElement
const continueButton = () => byTestId('onboarding-next') as HTMLButtonElement

async function storedProfile(id: number): Promise<Row | undefined> {
  return (await (await getDB()).get('profiles', id)) as Row | undefined
}

describe('naming your space', () => {
  it("marks a blank name in the rules' words, focuses it, and stays on the step", async () => {
    await openAt('space')
    type(nameField(), '  ')

    continueButton().click()
    await settle()

    expect(nameField().getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(nameField())).toBe(PROFILE_MESSAGES.name)
    expect(document.activeElement).toBe(nameField())
    expect(onboardingStep()).toBe('space')
    expect((await storedProfile(1))?.name).toBe('Personal')
    expect(failureToasts()).toEqual([])
  })

  it("marks a name another profile has, in the runtime's words", async () => {
    await openAt('space')
    type(nameField(), 'household')

    continueButton().click()

    await vi.waitFor(() => {
      expect(describedBy(nameField())).toBe(profileNameTaken('Household').name)
    })
    expect(nameField().getAttribute('aria-invalid')).toBe('true')
    expect(onboardingStep()).toBe('space')
    expect((await storedProfile(1))?.name).toBe('Personal')
    expect(failureToasts()).toEqual([])
  })

  it('keeps the currency chosen while the name is edited, saves both, and moves on', async () => {
    await openAt('space')
    type(byTestId('onboarding-currency') as HTMLSelectElement, 'GBP')
    type(nameField(), 'Our money')

    continueButton().click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('account')
    })
    expect(localStorage.getItem('localCurrency')).toBe('GBP')
    expect((await storedProfile(1))?.name).toBe('Our money')
    expect(getProfiles().find((p) => p.id === 1)?.name).toBe('Our money')
    expect(failureToasts()).toEqual([])
  })
})

describe('asking where you live and who the space covers', () => {
  const chip = (id: string) => byTestId(`onboarding-space-${id}`) as HTMLLabelElement
  const radio = (id: string) => chip(id).querySelector('input') as HTMLInputElement

  async function stored(key = 'guidance:1'): Promise<unknown> {
    const row = (await (await getDB()).get('settings', key)) as { value?: string } | undefined
    return row?.value === undefined ? undefined : JSON.parse(row.value)
  }

  it('asks both questions as guidance.md writes them, and says they are optional', async () => {
    await openAt('space')
    const legends = [...host.querySelectorAll('legend')].map((l) => l.textContent)
    expect(legends).toEqual([
      'Where do you live?',
      'Who does this space cover?',
      'Adults',
      'Children',
    ])
    expect(byTestId('onboarding-space-region')?.textContent).toContain(
      'We compare your numbers with official statistics for that place.'
    )
    const labels = (prefix: string) =>
      [...host.querySelectorAll<HTMLElement>(`[data-test-id^="onboarding-space-${prefix}-"]`)]
        .filter((el) => el.tagName === 'LABEL')
        .map((el) => el.textContent)
    expect(labels('region')).toEqual([
      'Germany',
      'Croatia',
      'Another EU country',
      'United Kingdom',
      'United States',
      'Somewhere else',
    ])
    expect(labels('adults')).toEqual(['1', '2', '3 or more'])
    expect(labels('children')).toEqual(['0', '1', '2', '3 or more'])
    expect(byTestId('onboarding-space-questions-lead')?.textContent).toBe(
      'Both questions are optional. Change them later in Settings.'
    )
  })

  it('saves the answers chosen with the space, and moves on', async () => {
    await openAt('space')
    chip('region-HR').click()
    chip('adults-2').click()
    chip('children-1').click()
    expect(radio('region-HR').checked).toBe(true)

    continueButton().click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('account')
    })
    expect(await stored()).toEqual({ region: 'HR', adults: 2, children: 1 })
    expect(failureToasts()).toEqual([])
  })

  it('counts a region left unanswered as skipped, and the household as not asked', async () => {
    await openAt('space')
    continueButton().click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('account')
    })
    expect(await stored()).toEqual({ region: 'skipped' })
  })

  it('shows the answers the record holds, and keeps what it does not change', async () => {
    const record = { region: 'DE', children: 0, tenure: 'own_outright' }
    await (await getDB()).put('settings', { key: 'guidance:1', value: JSON.stringify(record) })
    await openAt('space')
    await vi.waitFor(() => {
      expect(radio('region-DE').checked).toBe(true)
    })
    expect(radio('children-0').checked).toBe(true)

    chip('adults-3').click()
    continueButton().click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('account')
    })
    expect(await stored()).toEqual({ ...record, adults: 3 })
  })

  it('never puts skipped over a region only a newer build reads', async () => {
    await (await getDB()).put('settings', { key: 'guidance:1', value: '{"region":"AT"}' })
    await openAt('space')
    continueButton().click()

    await vi.waitFor(() => {
      expect(onboardingStep()).toBe('account')
    })
    expect(await stored()).toEqual({ region: 'AT' })
  })
})

describe('creating your first account', () => {
  const field = (id: string) => byTestId(id) as HTMLInputElement
  const create = () => byTestId('onboarding-account-create') as HTMLButtonElement
  const accounts = async () => (await (await getDB()).getAll('accounts')) as Row[]

  it('marks a blank name and a balance that is not a number, and creates nothing', async () => {
    await openAt('account')
    type(field('onboarding-account-balance'), 'lots')

    create().click()
    await settle()

    const name = field('onboarding-account-name')
    expect(describedBy(name)).toBe(ACCOUNT_MESSAGES.name)
    expect(describedBy(field('onboarding-account-balance'))).toBe(
      `${ACCOUNT_MESSAGES.balance} | Used as the opening balance.`
    )
    expect(document.activeElement).toBe(name)
    expect(await accounts()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('creates one with a comma for the cents, says so, and starts the next one blank', async () => {
    await openAt('account')
    type(field('onboarding-account-name'), 'Main Checking')
    type(field('onboarding-account-balance'), '1234,56')

    create().click()

    await vi.waitFor(async () => {
      expect(await accounts()).toEqual([
        expect.objectContaining({ name: 'Main Checking', balance: 1234.56, currency: 'EUR' }),
      ])
    })
    await vi.waitFor(() => {
      expect(successToasts()).toEqual(['Account "Main Checking" created'])
    })
    expect(field('onboarding-account-name').value).toBe('')
    expect(field('onboarding-account-balance').value).toBe('')
    expect(failureToasts()).toEqual([])
  })

  it('says in the notice why an account in another currency was refused', async () => {
    await openAt('account')
    type(field('onboarding-account-name'), 'Travel')
    type(byTestId('onboarding-account-currency') as HTMLSelectElement, 'USD')

    create().click()

    await vi.waitFor(() => {
      expect(byTestId('onboarding-account-notice')?.textContent).toMatch(/Account balances use EUR/)
    })
    expect(await accounts()).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})

describe('adding the subscriptions the scan found', () => {
  /** A charge `days` ago, as the transactions store keeps one. */
  const charge = (id: number, description: string, amount: number, days: number) => ({
    id,
    profile_id: 1,
    description,
    amount,
    type: 'expense',
    currency: 'EUR',
    amount_local: amount,
    date: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
    created_at: '2026-01-01T00:00:00.000Z',
  })

  it('marks a refused price and stays on the step instead of moving on', async () => {
    const db = await getDB()
    let id = 1
    for (const days of [95, 65, 35, 5]) {
      await db.add('transactions', charge(id++, 'NETFLIX.COM AMSTERDAM', 13.99, days) as never)
      await db.add('transactions', charge(id++, 'Spotify P0FF8B1C34', 10.99, days) as never)
    }
    await openAt('subscriptions')
    const addContinue = () => byTestId('onboarding-subs-add-continue') as HTMLButtonElement | null
    await vi.waitFor(() => {
      expect(addContinue()?.textContent).toMatch(/Add 2 subscriptions & continue/)
    })
    const netflixPrice = host.querySelector<HTMLInputElement>(
      '[data-name="Netflix"] [data-test-id="sub-scan-price"]'
    )!
    type(netflixPrice, '0')

    addContinue()!.click()
    await settle()

    expect(describedBy(netflixPrice)).toBe(BILL_MESSAGES.amountPositive)
    expect(onboardingStep()).toBe('subscriptions')
    expect(await db.getAll('bills')).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})
