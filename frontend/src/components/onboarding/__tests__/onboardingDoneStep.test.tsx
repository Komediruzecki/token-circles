/**
 * The setup wizard's last step lists the next steps the profile's data now calls for
 * (shared/orientation.ts), counted after what was just imported. A step's link finishes setup and
 * goes to its page, and finishing gives the account its Getting started card.
 *
 * Run against the real local-first router on fake-indexeddb.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- App.tsx, named below */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { setCurrentProfile, setProfiles } from '../../../core/appStore'
import { confirmRequests } from '../../../core/confirmStore'
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
    title: step.querySelector('[data-test-id="next-step-link"]')?.firstElementChild?.textContent,
    reason: step.querySelector('[data-test-id="next-step-reason"]')?.textContent ?? null,
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
  // Review M14: Getting started on Dashboard, a click on, listed the same steps with the same
  // reasons word for word. Here each step is its title and page; Getting started says why.
  expect(steps()).toEqual([
    { id: 'import-year', title: 'Import the rest of your year', reason: null },
    {
      id: 'review-subscriptions',
      title: 'Review the subscription we spotted',
      reason: null,
    },
    { id: 'sort-uncategorised', title: 'Sort the 4 entries without a category', reason: null },
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

// Review M20: the line under the heading counted what this visit made, held in memory. A reload
// on the subscriptions step (the cloud reopens there, and local-first does too since M7) left
// "Personal Profile has 1 tracked subscription." in one runtime and "1 account and 1 tracked
// subscription" in the other, for the same statement. It counts what the profile holds now.
it('says what the profile holds, though this visit counted nothing: as after a reload', async () => {
  const db = await getDB()
  await db.add('accounts', {
    id: 11,
    profile_id: 1,
    name: 'Main',
    balance: 1000,
    starting_balance: 1000,
  } as never)
  const bill = {
    profile_id: 1,
    due_date: `${monthsAgo(0)}-14`,
    category_id: null,
    recurring: 1,
    last_paid_date: null,
    next_due_date: null,
    frequency: 'monthly',
    type: 'subscription',
  }
  await db.add('bills', { ...bill, id: 21, name: 'Netflix', amount: 15.99, is_active: 1 } as never)
  // A bill and a subscription are one count in one word (review M12).
  await db.add('bills', {
    ...bill,
    id: 23,
    name: 'Rent',
    amount: 650,
    is_active: 1,
    type: 'bill',
  } as never)
  // Paused: not tracked any more, as the week-one mail counts them.
  await db.add('bills', { ...bill, id: 22, name: 'Gym', amount: 30, is_active: 0 } as never)
  await db.add('bills', { ...bill, id: 24, name: 'Paper', amount: 9, is_active: false } as never)
  // Another profile's: not this one's.
  await db.add('accounts', {
    id: 12,
    profile_id: 2,
    name: 'Shared',
    balance: 5,
    starting_balance: 5,
  } as never)

  startOnboarding('done')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)

  await vi.waitFor(
    () => {
      expect(host.querySelector('[data-test-id="onboarding-next-steps"]')).not.toBeNull()
    },
    { timeout: 10_000 }
  )
  expect(host.querySelector('[data-test-id="onboarding-done-summary"]')?.textContent).toBe(
    'Personal has 1 account, 12 transactions and 2 regular payments tracked on Bills.'
  )
})

it('reads no earlier evaluation as what the profile holds, when the done step cannot evaluate it', async () => {
  // An evaluation from before the account: 12 transactions and no account.
  const { refreshAchievements } = await import('../../../core/achievementsStore')
  await refreshAchievements()
  const db = await getDB()
  await db.add('accounts', {
    id: 11,
    profile_id: 1,
    name: 'Main',
    balance: 1000,
    starting_balance: 1000,
  } as never)
  // A row the bills list refuses: the done step's evaluation fails on it.
  await db.add('bills', { id: 23, profile_id: 1, name: 'Unreadable' } as never)

  startOnboarding('done')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)

  // What this visit can count: the account the step reads itself. Not "Personal has 12
  // transactions.", which is the earlier evaluation's, with no account.
  await vi.waitFor(
    () => {
      expect(host.querySelector('[data-test-id="onboarding-done-summary"]')?.textContent).toBe(
        'Personal has 1 account.'
      )
    },
    { timeout: 10_000 }
  )
})

// Done has nothing left to leave: Escape there finishes setup as Go to my dashboard does, and
// records it completed. It used to ask "Leave setup?" and record a skip.
it('Escape on Done finishes setup without asking, and records it completed', async () => {
  startOnboarding('done')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="onboarding-step-done"]')).not.toBeNull()
  })

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  expect(confirmRequests()).toEqual([])
  expect(onboardingOpen()).toBe(false)
  expect(localStorage.getItem('finance_onboarding:local')).toBe('completed')
})

// Review M16: the tip sent people to "the sidebar" for a tour; the button there is What's New,
// which opens Take a Tour. The tip names it as the sidebar labels it.
it('names the sidebar button a tour starts from, as the sidebar labels it', async () => {
  startOnboarding('done')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)

  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="onboarding-done-tip"]')).not.toBeNull()
  })
  expect(host.querySelector('[data-test-id="onboarding-done-tip"]')!.textContent).toBe(
    "Press Ctrl+K anywhere to add a transaction, and take a page tour any time from What's New in the sidebar."
  )
  const app = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8')
  expect(app).toContain('data-test-id="whats-new-btn"')
  expect(app).toContain("<span>What's New</span>")
})
