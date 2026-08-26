/**
 * Switching billing interval on the tier you already hold.
 *
 * The worker has been able to do this since the duplicate-subscription fix — POST
 * /api/billing/checkout with a new { plan, interval } moves the existing subscription onto the
 * new price. The grid could not ASK for it: "is this my plan" keyed on tier alone, and the tier
 * either side of an interval switch is the same one, so a monthly subscriber who flipped the
 * toggle to Annual still got "Manage subscription" and no way to act on what they were reading.
 *
 * Monthly -> annual only, and on purpose. It is a price increase, so Stripe prorates the
 * difference onto the next invoice and nothing is given back. The reverse is a decrease
 * mid-period, which leaves a credit balance rather than a refund — a conversation with support,
 * not a button. These tests pin that asymmetry, because the obvious "improvement" is to make it
 * symmetric.
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
let upgraded: Array<{ id: string; interval: string }> = []

async function mount(
  opts: { currentPlan?: string; currentInterval?: string | null; comped?: boolean } = {}
) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <BillingPlans
        currentPlan={() => opts.currentPlan ?? 'free'}
        configured={() => true}
        availablePlans={() => ['advanced']}
        busyKey={() => null}
        comped={() => opts.comped ?? false}
        currentInterval={() => opts.currentInterval ?? null}
        onUpgrade={(id, interval) => upgraded.push({ id, interval })}
        onManage={() => {}}
      />
    ),
    host
  )
  await vi.waitFor(() => {
    expect(host.textContent).toContain('Advanced')
  })
}

const byTestId = (id: string) => host.querySelector(`[data-testid="${id}"]`)
const toggle = (label: 'Monthly' | 'Annual') =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!

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

describe('the toggle opens on what you are actually paying', () => {
  it('starts on annual for an annual subscriber', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'annual' })

    // The annual price, not the monthly one — the toggle is showing their real interval.
    expect(host.textContent).toContain('50')
    expect(host.textContent).toContain('/yr')
  })

  it('starts on monthly for a monthly subscriber', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })

    expect(host.textContent).toContain('/mo')
  })

  it('starts on monthly when the interval is unknown', async () => {
    // Free, comped, or a row predating migration 0025. Monthly is the safe default: it is what
    // the grid always showed, and it never claims an annual commitment nobody made.
    await mount({ currentPlan: 'free', currentInterval: null })

    expect(host.textContent).toContain('/mo')
  })

  it('does not drag the toggle back after the user moves it', async () => {
    // The status arrives after mount, so the seed is an effect. Re-running it on every read
    // would fight the click that just happened.
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })

    toggle('Annual').click()

    expect(host.textContent).toContain('/yr')
  })
})

describe('monthly -> annual', () => {
  it('offers the switch on the tier already held', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })

    toggle('Annual').click()

    const cta = byTestId('switch-to-annual')
    expect(cta).not.toBeNull()
    expect(cta?.textContent).toContain('Switch to annual billing')
  })

  it('asks for the annual price of the tier they are on', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })
    toggle('Annual').click()
    ;(byTestId('switch-to-annual') as HTMLButtonElement).click()

    expect(upgraded).toEqual([{ id: 'advanced', interval: 'annual' }])
  })

  it('says where the money goes, so proration is not a surprise', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })

    toggle('Annual').click()

    expect(host.textContent).toContain('added to your next invoice')
  })

  it('is not offered while still looking at monthly', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })

    expect(byTestId('switch-to-annual')).toBeNull()
  })

  it('leaves Manage reachable — cancelling must never be crowded out', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly' })

    toggle('Annual').click()

    expect(byTestId('manage-subscription')).not.toBeNull()
  })
})

describe('annual -> monthly is deliberately not a button', () => {
  it('offers no switch, because the credit is a conversation and not a click', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'annual' })

    toggle('Monthly').click()

    expect(byTestId('switch-to-annual')).toBeNull()
    expect(upgraded).toEqual([])
  })

  it('points at support instead of leaving a dead end', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'annual' })

    toggle('Monthly').click()

    expect(byTestId('annual-to-monthly-note')?.textContent).toContain('Get in touch')
  })

  it('says nothing extra while looking at annual, which is what they are on', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'annual' })

    expect(byTestId('annual-to-monthly-note')).toBeNull()
  })
})

describe('accounts with no subscription to switch', () => {
  it('offers nothing to a comped plan, which has no Stripe subscription behind it', async () => {
    await mount({ currentPlan: 'advanced', currentInterval: 'monthly', comped: true })

    toggle('Annual').click()

    expect(byTestId('switch-to-annual')).toBeNull()
  })

  it('offers nothing on Free, which is not billed at any interval', async () => {
    await mount({ currentPlan: 'free', currentInterval: null })

    toggle('Annual').click()

    expect(byTestId('switch-to-annual')).toBeNull()
  })

  it('offers nothing when the interval is unknown, rather than guessing monthly', async () => {
    // A subscriber predating migration 0025. Assuming monthly here would offer an annual switch
    // to someone who may already be annual, and the worker would then no-op confusingly.
    await mount({ currentPlan: 'advanced', currentInterval: null })

    toggle('Annual').click()

    expect(byTestId('switch-to-annual')).toBeNull()
  })
})
