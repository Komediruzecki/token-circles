/**
 * BillingPlans when this account cannot upgrade yet.
 *
 * The reason is passed in rather than discovered from a failed request: the checkout route
 * refuses an unconfirmed address, and finding that out after being sent to Stripe is the worst
 * place to learn it. What must survive is Manage — someone already paying has to be able to
 * reach the portal and cancel whatever else is blocked.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BillingPlans from '../BillingPlans'

const PLANS = {
  plans: [
    {
      id: 'free',
      name: 'Free',
      monthlyPriceUsd: 0,
      annualPriceUsd: 0,
      limits: { receiptsPerProfile: 0, remindersPerMonth: 0, profiles: 1 },
      features: {
        cloudSync: false,
        emailReminders: false,
        receipts: false,
        advancedReports: false,
      },
    },
    {
      id: 'advanced',
      name: 'Advanced',
      monthlyPriceUsd: 5,
      annualPriceUsd: 50,
      limits: { receiptsPerProfile: null, remindersPerMonth: null, profiles: null },
      features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
    },
  ],
  notices: {},
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let upgraded: string[] = []

async function mount(opts: { blocked?: string | null; currentPlan?: string } = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <BillingPlans
        currentPlan={() => opts.currentPlan ?? 'free'}
        configured={() => true}
        availablePlans={() => ['advanced']}
        busyKey={() => null}
        upgradeBlockedReason={() => opts.blocked ?? null}
        onUpgrade={(id) => upgraded.push(id)}
        onManage={() => {}}
      />
    ),
    host
  )
  // onMount fetches the plan catalogue. Waited for rather than counted in microtasks: a fixed
  // number of ticks passed locally and failed on a slower CI runner, which is a flaky test
  // dressed up as a passing one.
  await vi.waitFor(() => {
    // The plan NAME, not just any button — the interval toggle renders before the catalogue
    // arrives, so waiting on a button count returns too early and asserts against an empty grid.
    expect(host.textContent).toContain('Advanced')
  })
}

const upgradeButton = () =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Upgrade')
const manageButton = () =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Manage billing'))
const reason = () => host.querySelector('[data-testid="upgrade-blocked-reason"]')

beforeEach(() => {
  upgraded = []
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(JSON.stringify(PLANS), { status: 200 }))
  )
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
})

describe('when nothing is blocking', () => {
  it('offers the upgrade and says nothing extra', async () => {
    await mount()

    expect(upgradeButton()?.disabled).toBe(false)
    expect(reason()).toBeNull()
  })
})

describe('when this account cannot upgrade yet', () => {
  it('disables the upgrade and states the reason', async () => {
    await mount({ blocked: 'Upgrading is available once your email address is confirmed.' })

    expect(upgradeButton()?.disabled).toBe(true)
    expect(reason()?.textContent).toContain('email address is confirmed')
  })

  it('does not start a checkout that the server would refuse', async () => {
    await mount({ blocked: 'nope' })

    upgradeButton()?.click()

    expect(upgraded).toEqual([])
  })

  it('leaves Manage billing alone, so a subscriber can still cancel', async () => {
    await mount({ blocked: 'nope', currentPlan: 'advanced' })

    expect(manageButton()).toBeDefined()
    expect(manageButton()!.disabled).toBe(false)
  })
})
