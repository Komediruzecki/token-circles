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

async function mount(
  opts: { blocked?: string | null; currentPlan?: string; comped?: boolean } = {}
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
        upgradeBlockedReason={() => opts.blocked ?? null}
        comped={() => opts.comped ?? false}
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
  host.querySelector<HTMLButtonElement>('[data-testid="manage-subscription"]')
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

  it('leaves Manage subscription alone, so a subscriber can still cancel', async () => {
    await mount({ blocked: 'nope', currentPlan: 'advanced' })

    expect(manageButton()).toBeDefined()
    expect(manageButton()!.disabled).toBe(false)
  })
})

/**
 * Which card is mine.
 *
 * The grid used to give its only coloured border and its only badge to RECOMMENDED, so the first
 * subscriber could not tell which plan they were on: theirs looked like every other card, and if
 * theirs happened to BE the recommended one, the highlight it carried said "Recommended" rather
 * than "yours". The plan you are on has to outrank the plan we would like to sell you.
 */
describe('the plan you are on', () => {
  const currentCard = () => host.querySelector('[data-testid="plan-card-current"]')

  it('is the marked card, and it is the right one', async () => {
    await mount({ currentPlan: 'advanced' })

    expect(currentCard()?.textContent).toContain('Your plan')
    expect(currentCard()?.textContent).toContain('Advanced')
  })

  it('carries a border of its own, not only a word', async () => {
    await mount({ currentPlan: 'advanced' })

    // The badge is small and sits at the card's edge; the border is what makes the card read as
    // selected at a glance, which is the complaint this fixes. Asserted on the inline style
    // because that is where the component puts it.
    const style = currentCard()?.getAttribute('style') ?? ''
    expect(style).toContain('--success')
    expect(style).toContain('2px solid')
  })

  it('is marked on Free too, where there is no button to infer it from', async () => {
    await mount({ currentPlan: 'free' })

    expect(currentCard()?.textContent).toContain('Free')
    // Nothing else on a Free row says "this is you" — no Manage button, no price.
    expect(currentCard()?.textContent).toContain('Your plan')
  })

  it('takes the badge back from Recommended when they are the same card', async () => {
    // 'advanced' is RECOMMENDED. A subscriber on it must be told it is theirs, not sold it.
    await mount({ currentPlan: 'advanced' })

    expect(currentCard()?.textContent).toContain('Your plan')
    expect(currentCard()?.textContent).not.toContain('Recommended')
  })

  it('still recommends the upgrade to someone who does not have it', async () => {
    await mount({ currentPlan: 'free' })

    expect(host.textContent).toContain('Recommended')
  })

  it("maps the legacy 'premium' status onto the tier it is", async () => {
    // Billing stores 'premium' from the single-price era; the grid has no such card.
    await mount({ currentPlan: 'premium' })

    expect(currentCard()?.textContent).toContain('Advanced')
  })

  it('says what Manage actually does, since cancelling is the thing people look for', async () => {
    await mount({ currentPlan: 'advanced' })

    expect(manageButton()?.textContent).toContain('Manage subscription')
    expect(currentCard()?.textContent).toContain('cancel')
  })
})

/**
 * A granted plan has no Stripe subscription behind it, so the portal route answers 400. Offering
 * the button anyway teaches someone to press it and read an error; say what they have instead.
 */
describe('when the plan was granted rather than bought', () => {
  it('replaces Manage billing with what the account actually has', async () => {
    await mount({ currentPlan: 'advanced', comped: true })

    // toBeNull, not toBeUndefined: manageButton() is a querySelector, which misses as null.
    expect(manageButton()).toBeNull()
    expect(host.textContent).toContain('Granted — nothing to manage')
  })

  it('still shows Manage billing for a real subscription', async () => {
    await mount({ currentPlan: 'advanced' })

    expect(manageButton()).toBeDefined()
    expect(host.textContent).not.toContain('nothing to manage')
  })
})
