/**
 * Which way each plan card points.
 *
 * Every paid card said "Upgrade", whatever plan you were on. From Advanced, the Basic card still
 * said Upgrade — the exact opposite of what clicking it does — so the page gave a subscriber no
 * way to tell which of the other tiers were above them and which were below.
 *
 * Direction is read from the catalogue's own order rather than a list kept in the component, so
 * these tests deliberately use a four-tier catalogue: the interesting cases only exist when there
 * is something both above and below where you are.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BillingPlans from '../BillingPlans'

const limits = { receiptsPerProfile: null, remindersPerMonth: null, profiles: null }
const features = { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true }

const tier = (id: string, name: string, price: number) => ({
  id,
  name,
  monthlyPriceUsd: price,
  annualPriceUsd: price * 10,
  limits,
  features,
})

// Declaration order is the ladder — this mirrors `Object.values(PLANS)` from the worker.
const PLANS = {
  plans: [
    tier('free', 'Free', 0),
    tier('basic', 'Basic', 3),
    tier('advanced', 'Advanced', 5),
    tier('ultimate', 'Ultimate', 9),
  ],
  notices: {},
}

const PAID = ['basic', 'advanced', 'ultimate']

let host: HTMLDivElement
let dispose: (() => void) | undefined

async function mount(currentPlan: string, availablePlans: string[] = PAID) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <BillingPlans
        currentPlan={() => currentPlan}
        configured={() => true}
        availablePlans={() => availablePlans}
        busyKey={() => null}
        onUpgrade={() => {}}
        onManage={() => {}}
      />
    ),
    host
  )
  await vi.waitFor(() => {
    expect(host.textContent).toContain('Ultimate')
  })
}

/** The CTA labels on the cards that have one, in catalogue order. */
const ctaLabels = () =>
  [...host.querySelectorAll('button')]
    .map((b) => b.textContent?.trim() ?? '')
    .filter((t) => t === 'Upgrade' || t === 'Downgrade')

beforeEach(() => {
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

describe('the direction each paid card points', () => {
  it('is all upgrades from the bottom', async () => {
    await mount('free')
    // basic, advanced, ultimate — everything is above Free.
    expect(ctaLabels()).toEqual(['Upgrade', 'Upgrade', 'Upgrade'])
  })

  it('points down at the cheaper tiers and up at the dearer ones', async () => {
    await mount('advanced')
    // basic is below, advanced is yours (no CTA), ultimate is above.
    expect(ctaLabels()).toEqual(['Downgrade', 'Upgrade'])
  })

  it('is all downgrades from the top', async () => {
    await mount('ultimate')
    expect(ctaLabels()).toEqual(['Downgrade', 'Downgrade'])
  })

  it('reads the legacy "premium" value as Advanced', async () => {
    // users.plan still stores 'premium' from the single-price era; currentId() maps it.
    await mount('premium')
    expect(ctaLabels()).toEqual(['Downgrade', 'Upgrade'])
  })

  it('falls back to Upgrade when the current plan is not in the catalogue', async () => {
    // A value granted out of band, or one retired from plans.ts, says nothing about direction.
    // Guessing "Downgrade" from an unknown place would be worse than the old, honest default.
    await mount('something-else')
    expect(ctaLabels()).toEqual(['Upgrade', 'Upgrade', 'Upgrade'])
  })

  it('leaves a tier with no price wired alone', async () => {
    await mount('advanced', ['ultimate'])
    // Basic has no Stripe price, so it keeps saying "Coming soon" rather than becoming a
    // Downgrade button that cannot be clicked.
    expect(host.textContent).toContain('Coming soon')
    expect(ctaLabels()).toEqual(['Upgrade'])
  })

  it('never puts a CTA on the plan you are already on', async () => {
    await mount('advanced')
    // Three paid tiers, one of them yours: two CTAs, and Manage instead of the third.
    expect(ctaLabels()).toHaveLength(2)
    expect(host.querySelector('[data-testid="manage-subscription"]')).not.toBeNull()
  })

  it('leaves the Free card without a CTA either way', async () => {
    await mount('advanced')
    // Free is below Advanced, but it gets no button — cancelling is the portal's job, and a
    // "Downgrade" button that opened a Stripe checkout for a 0 EUR plan would be a trap.
    expect(ctaLabels()).toHaveLength(2)
    await mount('free')
    expect(host.textContent).toContain('Free forever')
  })
})
