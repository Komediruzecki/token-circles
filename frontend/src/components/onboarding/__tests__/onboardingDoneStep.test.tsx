/**
 * The setup wizard's last step lists the next steps the profile's data now calls for
 * (shared/orientation.ts), counted after what was just imported. A step's link finishes setup and
 * goes to its page, and finishing gives the account its Getting started card.
 *
 * Run against the real local-first router on fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { setCurrentProfile, setProfiles } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import {
  __resetGettingStartedForTest,
  LOCAL_GETTING_STARTED_KEY,
} from '../../../core/gettingStarted'
import {
  onboardingOpen,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
} from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../OnboardingWizard'), import('../../../core/storage/localApiRouter')])
}, 120_000)

/** 'YYYY-MM' `n` months before this one. */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  __resetGettingStartedForTest()
  setOnboardingOwner('local')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.add('categories', {
    id: 7,
    profile_id: 1,
    name: 'Groceries',
    type: 'expense',
    color: '#F97316',
  } as never)
  // Four months imported: Netflix every month with no category, and two grocery runs. The runs
  // come to a different amount each month: one amount on one day every month is a regular payment,
  // which the subscription scan proposes.
  let id = 1
  const entry = (date: string, description: string, amount: number, category: number | null) =>
    db.add('transactions', {
      id: id++,
      profile_id: 1,
      description,
      amount,
      amount_local: amount,
      currency: 'EUR',
      exchange_rate: 1,
      type: 'expense',
      date,
      category_id: category,
      account_id: null,
      transfer_account_id: null,
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as never)
  for (const n of [4, 3, 2, 1]) {
    await entry(`${monthsAgo(n)}-14`, 'NETFLIX.COM', 15.99, null)
    await entry(`${monthsAgo(n)}-05`, 'Market', 60 + 9 * n, 7)
    await entry(`${monthsAgo(n)}-19`, 'Market', 70 + 9 * n, 7)
  }
  setProfiles([{ id: 1, name: 'Personal' }] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
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
  history.replaceState(null, '', '#')
})

const steps = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="next-step"]')).map((step) => ({
    id: step.dataset.step,
    reason: step.querySelector('[data-test-id="next-step-reason"]')?.textContent,
  }))

it('lists the next steps from what the profile holds, and a step finishes setup on its way', async () => {
  startOnboarding('done')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)

  await vi.waitFor(
    () => {
      expect(host.querySelector('[data-test-id="onboarding-next-steps"]')).not.toBeNull()
    },
    { timeout: 10_000 }
  )
  expect(steps()).toEqual([
    {
      id: 'import-year',
      reason: '4 of the last 13 months are tracked. A month counts once it holds 3 entries.',
    },
    { id: 'review-subscriptions', reason: "It's in your statements but not on Bills yet." },
    {
      id: 'sort-uncategorised',
      reason: "That's 33% of your entries. Budgets and Analytics group spending by category.",
    },
  ])

  const scan = host.querySelector<HTMLAnchorElement>(
    '[data-step="review-subscriptions"] [data-test-id="next-step-link"]'
  )!
  expect(scan.getAttribute('href')).toBe('#bills?scan=1')
  scan.click()

  expect(onboardingOpen()).toBe(false)
  expect(localStorage.getItem('finance_onboarding:local')).toBe('completed')
  expect(JSON.parse(localStorage.getItem(LOCAL_GETTING_STARTED_KEY)!)).toEqual({ hidden: false })
  await vi.waitFor(() => {
    expect(window.location.hash).toBe('#bills?scan=1')
  })
})
